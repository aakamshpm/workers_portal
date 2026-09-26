import { prisma } from "./prisma";

/**
 * ===========================================================================
 * Place search (ADR-0010, ADR-0011).
 * ===========================================================================
 *
 * A worker chooses a town by name, or by one tap on "Use my location". He never
 * types coordinates. Photon, an OpenStreetMap geocoder built for
 * search-as-you-type, turns the name or the reading into a town.
 *
 * Three rules shape this file:
 *
 *   - Only the server talks to Photon, so a worker's IP never reaches it.
 *   - Answers are cached, so repeated searches do not use up Photon's fair-use
 *     allowance.
 *   - When Photon fails, the 14 district towns in the `Town` table answer
 *     instead, so the page is never left with nothing to choose.
 *
 * Tests install a fake with `setPlaceProvider` and never call photon.komoot.io.
 */

export interface Place {
  name: string;
  /** Taluk or district, to tell two towns with the same name apart. */
  area: string | null;
  latitude: number;
  longitude: number;
}

export type PlaceSource = "photon" | "fallback";

export interface PlaceProvider {
  search(q: string): Promise<Place[]>;
  nearest(lat: number, lng: number): Promise<Place | null>;
}

/** Kerala's bounding box: west, south, east, north. */
export const KERALA_BBOX = "74.8,8.1,77.5,12.9";

/** Town-level results only. Streets and shops are not places a worker chooses. */
const TOWN_LAYERS = ["city", "locality", "district"] as const;

const MAX_PLACES = 8;

/** Photon's policy asks every client to identify itself. */
const USER_AGENT = "workers-portal/1.0 (+https://github.com/aakamshpm/workers_portal)";

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    state?: string;
    county?: string;
    district?: string;
    city?: string;
    /** "place" for towns and neighbourhoods, other values for buildings and land. */
    osm_key?: string;
    /** For a place: city, town, suburb, village, neighbourhood, and so on. */
    osm_value?: string;
  };
}

/** The production provider. Tests point `baseUrl` at a local fake server. */
export class PhotonPlaceProvider implements PlaceProvider {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: { baseUrl?: string; timeoutMs?: number } = {}) {
    this.baseUrl = options.baseUrl ?? process.env.PHOTON_BASE_URL ?? "https://photon.komoot.io";
    this.timeoutMs = options.timeoutMs ?? 4000;
  }

  async search(q: string): Promise<Place[]> {
    const params = new URLSearchParams({ q, bbox: KERALA_BBOX, limit: "15" });
    return keralaPlaces(await this.ask("/api", params));
  }

  /**
   * The town a worker is in, for "Use my location".
   *
   * Photon's reverse answer is ordered by distance, and the closest thing is
   * often a building. Checked on the live service: 9.9816, 76.2999 answers
   * "Zostel", a hostel, first. A worker told "You are near Zostel" cannot
   * confirm that, so buildings are skipped and a town is preferred over a
   * closer neighbourhood.
   */
  async nearest(lat: number, lng: number): Promise<Place | null> {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lng),
      limit: "15",
      radius: "5",
    });
    const features = (await this.ask("/reverse", params)).filter(inKerala);

    for (const kinds of PLACE_PREFERENCE) {
      const hit = features.find(
        (f) => f.properties?.osm_key === "place" && kinds.includes(f.properties.osm_value ?? ""),
      );
      if (hit) return toPhotonPlace(hit, hit.properties!.name!);
    }

    // Only buildings nearby. Photon still says which area each one is in, and
    // that area is a name the worker can recognise.
    const first = features[0];
    const areaName = first?.properties?.district ?? first?.properties?.city;
    return first && areaName ? toPhotonPlace(first, areaName) : null;
  }

  private async ask(path: string, params: URLSearchParams): Promise<PhotonFeature[]> {
    for (const layer of TOWN_LAYERS) params.append("layer", layer);

    // A worker's page waits on this answer, so a slow Photon must fail quickly
    // and let the fallback answer instead.
    const res = await fetch(`${this.baseUrl}${path}?${params}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Photon answered HTTP ${res.status}`);

    const body = (await res.json()) as { features?: PhotonFeature[] };
    return body.features ?? [];
  }
}

/**
 * Which OpenStreetMap `place` kinds name a location a worker can confirm,
 * best first. A town is what a worker says ("I am in Perumbavoor"). A suburb
 * or neighbourhood is used only when no town is within the reverse radius.
 */
const PLACE_PREFERENCE: string[][] = [
  ["city", "town"],
  ["suburb", "village"],
  ["neighbourhood", "quarter", "hamlet"],
];

function inKerala(f: PhotonFeature): boolean {
  return f.properties?.state?.trim().toLowerCase() === "kerala";
}

function toPhotonPlace(f: PhotonFeature, name: string): Place {
  const [lng, lat] = f.geometry!.coordinates!;
  const p = f.properties!;
  return { name, area: p.county ?? p.district ?? p.city ?? null, latitude: lat, longitude: lng };
}

/**
 * Keep towns in Kerala, once each.
 *
 * The bounding box also covers parts of Tamil Nadu and Karnataka, so the state
 * is checked on every result. Photon writes it as "Kerala" for most towns and
 * "kerala" for some, which is why the comparison ignores case.
 */
function keralaPlaces(features: PhotonFeature[]): Place[] {
  const seen = new Set<string>();
  const places: Place[] = [];

  for (const f of features) {
    const name = f.properties?.name;
    const coords = f.geometry?.coordinates;
    if (!name || !coords || !inKerala(f)) continue;

    // Two rows with the same name in the same taluk are the same place to a
    // worker, even when Photon gives them slightly different coordinates, as it
    // does for "Munnar Colony" and "Alumkadavu".
    const area = f.properties?.county ?? f.properties?.district ?? "";
    const key = `${name.toLowerCase()}|${area.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    places.push(toPhotonPlace(f, name));
    if (places.length === MAX_PLACES) break;
  }

  return places;
}

// ---------------------------------------------------------------------------
// Provider and cache
// ---------------------------------------------------------------------------

let installed: PlaceProvider | null = null;

/**
 * Tests install a fake here. Installing a provider also empties the cache,
 * because answers from one provider must never be served for another.
 */
export function setPlaceProvider(p: PlaceProvider | null) {
  installed = p;
  cache.clear();
}

function provider(): PlaceProvider {
  return (installed ??= new PhotonPlaceProvider());
}

/** 24 hours. Town names and positions do not change within a day. */
const CACHE_MS = 24 * 60 * 60 * 1000;
/** Enough for every search a demo produces, small enough that memory stays trivial. */
const CACHE_MAX = 500;

const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;

  const value = await load();
  // Oldest entry first out. A Map keeps insertion order, so the first key is
  // the oldest.
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), value });
  return value;
}

// ---------------------------------------------------------------------------
// What the routes call
// ---------------------------------------------------------------------------

/**
 * Towns matching what the worker typed.
 *
 * Only a successful Photon answer is cached. A fallback answer is not, so the
 * next search tries Photon again instead of serving the smaller list for a day.
 */
export async function searchPlaces(q: string): Promise<{ places: Place[]; source: PlaceSource }> {
  const query = q.trim().toLowerCase();
  try {
    const places = await cached(`search:${query}`, () => provider().search(query));
    return { places, source: "photon" };
  } catch (e) {
    console.warn("[places] Photon search failed, using the district towns:", String(e));
    return { places: await fallbackSearch(query), source: "fallback" };
  }
}

/**
 * The town nearest a one-time device reading.
 *
 * The reading is rounded to 3 decimals, about 100 metres, before it reaches
 * Photon or the cache. The worker's exact position therefore never leaves this
 * server, and it is never stored.
 */
export async function nearestPlace(
  lat: number,
  lng: number,
): Promise<{ place: Place | null; source: PlaceSource }> {
  const rLat = Math.round(lat * 1000) / 1000;
  const rLng = Math.round(lng * 1000) / 1000;
  try {
    const place = await cached(`nearest:${rLat},${rLng}`, () => provider().nearest(rLat, rLng));
    return { place, source: "photon" };
  } catch (e) {
    console.warn("[places] Photon reverse lookup failed, using the district towns:", String(e));
    return { place: await fallbackNearest(rLat, rLng), source: "fallback" };
  }
}

// ---------------------------------------------------------------------------
// Fallback: the district towns in the database
// ---------------------------------------------------------------------------

/**
 * No district town is farther than about 50 km from any point in Kerala, so 80
 * km leaves room at the borders. Beyond that the point is outside Kerala, and
 * calling it "Palakkad" would tell the worker something false.
 */
const FALLBACK_MAX_KM = 80;

async function fallbackSearch(query: string): Promise<Place[]> {
  const towns = await prisma.town.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { area: { contains: query, mode: "insensitive" } },
      ],
    },
    orderBy: { name: "asc" },
    take: MAX_PLACES,
  });
  return towns.map(toPlace);
}

async function fallbackNearest(lat: number, lng: number): Promise<Place | null> {
  const towns = await prisma.town.findMany();
  let best: (typeof towns)[number] | null = null;
  let bestKm = Infinity;
  for (const t of towns) {
    const km = distanceKm(lat, lng, t.latitude, t.longitude);
    if (km < bestKm) {
      best = t;
      bestKm = km;
    }
  }
  return best && bestKm <= FALLBACK_MAX_KM ? toPlace(best) : null;
}

function toPlace(t: { name: string; area: string; latitude: number; longitude: number }): Place {
  return { name: t.name, area: t.area, latitude: t.latitude, longitude: t.longitude };
}

/**
 * Great-circle distance in km. Used only to pick among 14 fallback towns.
 * Nearby search itself uses PostGIS `ST_DWithin`.
 */
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
