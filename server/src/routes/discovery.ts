import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../lib/auth";
import { nearestPlace, searchPlaces } from "../lib/places";

export const discoveryRouter = Router();

discoveryRouter.use(requireAuth);

/** The fields /toggle and /me return, and nothing else, so no id or phone leaks. */
const profileSelect = {
  looking: true,
  latitude: true,
  longitude: true,
  locationName: true,
  preferredWorkType: true,
} as const;

const toggleSchema = z.object({
  looking: z.boolean({ error: "Say whether you are looking" }),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  locationName: z.string().trim().min(1).max(120).optional(),
  preferredWorkType: z.string().max(120).optional(),
});

/**
 * POST /api/discovery/toggle
 * Worker or contractor turns visibility on or off. The location is a chosen
 * town (ADR-0011), never the phone's exact position.
 */
discoveryRouter.post("/toggle", requireRole("WORKER", "CONTRACTOR"), async (req, res) => {
  const parsed = toggleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const { looking, latitude, longitude, locationName, preferredWorkType } = parsed.data;

  if (looking && (latitude === undefined || longitude === undefined || !locationName)) {
    return res.status(400).json({ error: "Choose the town where you are first" });
  }

  const updated = await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      looking,
      latitude: looking ? latitude! : null,
      longitude: looking ? longitude! : null,
      locationName: looking ? locationName! : null,
      // Left out means keep it, so turning visibility off does not erase it.
      ...(preferredWorkType !== undefined
        ? { preferredWorkType: preferredWorkType.trim() || null }
        : {}),
    },
    select: profileSelect,
  });

  return res.json(updated);
});

/**
 * GET /api/discovery/me
 * The caller's own saved visibility, so Find Work / Find Workers can open with
 * the current state instead of an empty form. Same fields as /toggle.
 */
discoveryRouter.get("/me", requireRole("WORKER", "CONTRACTOR"), async (req, res) => {
  const me = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: profileSelect,
  });
  if (!me) return res.status(404).json({ error: "Account not found" });
  return res.json(me);
});

const placeQuery = z.object({
  q: z.string().trim().min(2, "Type at least 2 letters").max(60),
});

/**
 * GET /api/discovery/places?q=perum
 * Kerala towns matching what the worker typed (ADR-0010). Photon first, the
 * district towns when Photon fails.
 */
discoveryRouter.get("/places", requireRole("WORKER", "CONTRACTOR"), async (req, res) => {
  const parsed = placeQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid search" });
  }
  return res.json(await searchPlaces(parsed.data.q));
});

const pointQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

/**
 * GET /api/discovery/places/nearest?lat=..&lng=..
 * The town nearest a one-time "Use my location" reading (ADR-0011). The
 * reading is rounded before Photon sees it, and it is never stored.
 */
discoveryRouter.get("/places/nearest", requireRole("WORKER", "CONTRACTOR"), async (req, res) => {
  const parsed = pointQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Give lat and lng" });
  }
  return res.json(await nearestPlace(parsed.data.lat, parsed.data.lng));
});

const nearbyQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(1).max(50).default(25),
});

function parseNearby(query: unknown) {
  return nearbyQuery.safeParse(query);
}

type ContractorRow = {
  id: string;
  name: string;
  phone: string;
  company: string | null;
  preferredWorkType: string | null;
  distanceKm: number;
};

type PlaceRow = {
  id: string;
  name: string;
  category: string;
  phone: string | null;
  source: string;
  distanceKm: number;
};

type WorkerRow = {
  id: string;
  name: string;
  phone: string;
  homeState: string | null;
  preferredWorkType: string | null;
  distanceKm: number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * GET /api/discovery/nearby-work (worker)
 * Two groups: opted-in contractors + public business listings.
 * Businesses are not jobs. Only distanceKm, never live coordinates.
 */
discoveryRouter.get("/nearby-work", requireRole("WORKER"), async (req, res) => {
  const parsed = parseNearby(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Give lat, lng and optional radiusKm (max 50)" });
  }
  const { lat, lng, radiusKm } = parsed.data;
  const radiusM = Math.round(radiusKm * 1000);

  const contractors = (await prisma.$queryRaw`
    SELECT id, name, phone, company, "preferredWorkType",
      ST_Distance(
        ST_MakePoint(longitude, latitude)::geography,
        ST_MakePoint(${lng}, ${lat})::geography
      ) / 1000.0 AS "distanceKm"
    FROM "User"
    WHERE role = 'CONTRACTOR'
      AND looking = true
      AND latitude IS NOT NULL
      AND longitude IS NOT NULL
      AND ST_DWithin(
        ST_MakePoint(longitude, latitude)::geography,
        ST_MakePoint(${lng}, ${lat})::geography,
        ${radiusM}
      )
    ORDER BY ST_MakePoint(longitude, latitude)::geography <-> ST_MakePoint(${lng}, ${lat})::geography
    LIMIT 50
  `) as ContractorRow[];

  const businesses = (await prisma.$queryRaw`
    SELECT id, name, category, phone, source,
      ST_Distance(
        ST_MakePoint(longitude, latitude)::geography,
        ST_MakePoint(${lng}, ${lat})::geography
      ) / 1000.0 AS "distanceKm"
    FROM "Place"
    WHERE ST_DWithin(
        ST_MakePoint(longitude, latitude)::geography,
        ST_MakePoint(${lng}, ${lat})::geography,
        ${radiusM}
      )
    ORDER BY ST_MakePoint(longitude, latitude)::geography <-> ST_MakePoint(${lng}, ${lat})::geography
    LIMIT 50
  `) as PlaceRow[];

  return res.json({
    contractors: contractors.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      company: c.company,
      preferredWorkType: c.preferredWorkType,
      distanceKm: round1(Number(c.distanceKm)),
    })),
    businesses: businesses.map((b) => ({
      id: b.id,
      name: b.name,
      category: b.category,
      phone: b.phone,
      distanceKm: round1(Number(b.distanceKm)),
      source: "public_listing",
    })),
  });
});

const nearbyWorkersQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(1).max(50).default(25),
  workType: z.string().max(120).optional(),
});

/**
 * GET /api/discovery/nearby-workers (contractor)
 * Opted-in workers only. No live coordinates, only distanceKm.
 */
discoveryRouter.get("/nearby-workers", requireRole("CONTRACTOR"), async (req, res) => {
  const parsed = nearbyWorkersQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Give lat, lng and optional radiusKm (max 50)" });
  }
  const { lat, lng, radiusKm, workType } = parsed.data;
  const radiusM = Math.round(radiusKm * 1000);

  const workers = workType
    ? ((await prisma.$queryRaw`
        SELECT id, name, phone, "homeState", "preferredWorkType",
          ST_Distance(
            ST_MakePoint(longitude, latitude)::geography,
            ST_MakePoint(${lng}, ${lat})::geography
          ) / 1000.0 AS "distanceKm"
        FROM "User"
        WHERE role = 'WORKER'
          AND looking = true
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
          AND "preferredWorkType" ILIKE ${`%${workType}%`}
          AND ST_DWithin(
            ST_MakePoint(longitude, latitude)::geography,
            ST_MakePoint(${lng}, ${lat})::geography,
            ${radiusM}
          )
        ORDER BY ST_MakePoint(longitude, latitude)::geography <-> ST_MakePoint(${lng}, ${lat})::geography
        LIMIT 50
      `) as WorkerRow[])
    : ((await prisma.$queryRaw`
        SELECT id, name, phone, "homeState", "preferredWorkType",
          ST_Distance(
            ST_MakePoint(longitude, latitude)::geography,
            ST_MakePoint(${lng}, ${lat})::geography
          ) / 1000.0 AS "distanceKm"
        FROM "User"
        WHERE role = 'WORKER'
          AND looking = true
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
          AND ST_DWithin(
            ST_MakePoint(longitude, latitude)::geography,
            ST_MakePoint(${lng}, ${lat})::geography,
            ${radiusM}
          )
        ORDER BY ST_MakePoint(longitude, latitude)::geography <-> ST_MakePoint(${lng}, ${lat})::geography
        LIMIT 50
      `) as WorkerRow[]);

  return res.json({
    workers: workers.map((w) => ({
      id: w.id,
      name: w.name,
      phone: w.phone,
      homeState: w.homeState,
      preferredWorkType: w.preferredWorkType,
      distanceKm: round1(Number(w.distanceKm)),
    })),
  });
});
