import "./setup";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Place, PlaceProvider } from "../src/lib/places.js";

/**
 * Place search. Contract: docs/contracts/discovery.md "Places". ADR-0010, ADR-0011.
 *
 * What these tests guarantee:
 * - a worker finds Kerala towns by name, through the server, never the browser;
 * - a repeated search is answered from the cache, so Photon's fair-use limit holds;
 * - when Photon fails, the district towns in the database still answer;
 * - a "Use my location" reading is rounded before it leaves the server, and is
 *   never turned into a Kerala town name for a point outside Kerala;
 * - the Photon client keeps only Kerala towns and gives up instead of hanging.
 *
 * No test calls photon.komoot.io. Route tests inject a fake provider, and the
 * Photon client is pointed at a local fake server.
 */

function listen(app: express.Express): Promise<{ base: string; server: Server }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ base: `http://127.0.0.1:${port}`, server });
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

const PERUMBAVOOR: Place = {
  name: "Perumbavoor",
  area: "Kunnathunad",
  latitude: 10.1148,
  longitude: 76.4778,
};

const WORKER_PHONE = "9999999931";

describe("place search routes", () => {
  let base = "";
  let server: Server;
  let workerToken = "";
  let officerToken = "";
  let workerId = "";

  before(async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    const { signToken } = await import("../src/lib/auth.js");
    const { discoveryRouter } = await import("../src/routes/discovery.js");

    await prisma.user.deleteMany({ where: { phone: WORKER_PHONE } });
    const worker = await prisma.user.create({
      data: { phone: WORKER_PHONE, name: "Place Search Worker", role: "WORKER", pin: "hashed" },
    });
    workerId = worker.id;
    workerToken = signToken({ id: worker.id, name: worker.name, phone: worker.phone, role: "WORKER" });
    officerToken = signToken({
      id: "officer-no-row",
      name: "Officer",
      phone: "9999999932",
      role: "AUTHORITY",
    });

    const app = express();
    app.use(express.json());
    app.use("/api/discovery", discoveryRouter);
    ({ base, server } = await listen(app));
  });

  after(async () => {
    // Close the server first, so a failing import below cannot leave the
    // process running.
    await close(server);
    const { prisma } = await import("../src/lib/prisma.js");
    await prisma.user.deleteMany({ where: { id: workerId } });
    await prisma.$disconnect();
    const { setPlaceProvider } = await import("../src/lib/places.js");
    setPlaceProvider(null);
  });

  beforeEach(async () => {
    // Installing a provider also empties the cache, so no test sees another's answer.
    const { setPlaceProvider } = await import("../src/lib/places.js");
    setPlaceProvider(null);
  });

  async function get(path: string, token = workerToken) {
    const res = await fetch(`${base}/api/discovery${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { status: res.status, body: (await res.json()) as unknown };
  }

  function failingProvider(): PlaceProvider {
    return {
      async search() {
        throw new Error("Photon is down");
      },
      async nearest() {
        throw new Error("Photon is down");
      },
    };
  }

  it("returns Photon's places and says they came from Photon", async () => {
    const { setPlaceProvider } = await import("../src/lib/places.js");
    setPlaceProvider({ search: async () => [PERUMBAVOOR], nearest: async () => null });

    const r = await get("/places?q=perum");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { places: [PERUMBAVOOR], source: "photon" });
  });

  it("refuses a query shorter than 2 characters", async () => {
    const r = await get("/places?q=%20a%20");
    assert.equal(r.status, 400);
  });

  it("asks Photon once for a repeated search, whatever the letter case", async () => {
    const { setPlaceProvider } = await import("../src/lib/places.js");
    const asked: string[] = [];
    setPlaceProvider({
      async search(q) {
        asked.push(q);
        return [PERUMBAVOOR];
      },
      nearest: async () => null,
    });

    await get("/places?q=perum");
    await get("/places?q=Perum");
    assert.deepEqual(asked, ["perum"], "the second search must come from the cache");
  });

  it("falls back to the district towns when Photon fails", async () => {
    const { setPlaceProvider } = await import("../src/lib/places.js");
    setPlaceProvider(failingProvider());

    const r = await get("/places?q=koz");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, {
      places: [{ name: "Kozhikode", area: "Kozhikode", latitude: 11.2451, longitude: 75.7755 }],
      source: "fallback",
    });
  });

  it("gives an empty fallback list, not an error, when no district town matches", async () => {
    const { setPlaceProvider } = await import("../src/lib/places.js");
    setPlaceProvider(failingProvider());

    const r = await get("/places?q=zzzz");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { places: [], source: "fallback" });
  });

  it("rounds a device reading to 3 decimals before asking Photon", async () => {
    const { setPlaceProvider } = await import("../src/lib/places.js");
    const asked: number[][] = [];
    setPlaceProvider({
      search: async () => [],
      async nearest(lat, lng) {
        asked.push([lat, lng]);
        return PERUMBAVOOR;
      },
    });

    const r = await get("/places/nearest?lat=10.115049&lng=76.478049");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { place: PERUMBAVOOR, source: "photon" });
    assert.deepEqual(asked, [[10.115, 76.478]]);
  });

  it("names the closest district town when Photon fails", async () => {
    const { setPlaceProvider } = await import("../src/lib/places.js");
    setPlaceProvider(failingProvider());

    const r = await get("/places/nearest?lat=11.25&lng=75.78");
    assert.deepEqual(r.body, {
      place: { name: "Kozhikode", area: "Kozhikode", latitude: 11.2451, longitude: 75.7755 },
      source: "fallback",
    });
  });

  it("names no Kerala town for a point far outside Kerala", async () => {
    const { setPlaceProvider } = await import("../src/lib/places.js");
    setPlaceProvider(failingProvider());

    // Chennai. The closest district town is hundreds of km away, and calling
    // this "Palakkad" would tell the worker something false.
    const r = await get("/places/nearest?lat=13.0827&lng=80.2707");
    assert.deepEqual(r.body, { place: null, source: "fallback" });
  });

  it("refuses a labour officer, who has no directory entry", async () => {
    const r = await get("/places?q=perum", officerToken);
    assert.equal(r.status, 403);
  });

  it("has the 14 district towns in the database, written by the migration", async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    assert.equal(await prisma.town.count(), 14);
  });
});

describe("PhotonPlaceProvider", () => {
  let base = "";
  let server: Server;
  let lastQuery: Record<string, unknown> = {};
  let mode: "normal" | "hang" = "normal";
  let reverseFeatures: unknown[] = [];
  /** When set, the fake search answers with these instead of the default list. */
  let searchFeatures: unknown[] | null = null;

  type Extra = { osm_key?: string; osm_value?: string; district?: string; city?: string };

  const feature = (
    name: string,
    state: string,
    county: string,
    lat: number,
    lng: number,
    extra: Extra = { osm_key: "place", osm_value: "town" },
  ) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: { name, state, county, ...extra },
  });

  before(async () => {
    const app = express();
    app.get("/api", (req, res) => {
      lastQuery = req.query;
      if (mode === "hang") return; // never responds
      if (searchFeatures) return res.json({ type: "FeatureCollection", features: searchFeatures });
      res.json({
        type: "FeatureCollection",
        features: [
          // Photon writes the state in lower case for some towns.
          feature("Perumbavoor", "kerala", "Kunnathunad", 10.1148, 76.4778),
          feature("Perumbavoor", "Kerala", "Kunnathunad", 10.1148, 76.4778),
          feature("Kadanad", "Tamil Nadu", "Udhagamandalam", 11.4607, 76.7183),
          feature("Perumkavu", "Kerala", "Kottayam", 9.5676, 76.5747),
        ],
      });
    });
    app.get("/reverse", (req, res) => {
      lastQuery = req.query;
      res.json({ type: "FeatureCollection", features: reverseFeatures });
    });
    ({ base, server } = await listen(app));
  });

  // Reset the fake server's answers before every test. A test that fails its
  // assertion never reaches its own clean-up line, and must not hand its
  // answers to the next test.
  beforeEach(() => {
    mode = "normal";
    searchFeatures = null;
    reverseFeatures = [];
  });

  after(async () => {
    server.closeAllConnections();
    await close(server);
  });

  it("shows a name only once per taluk, even at slightly different coordinates", async () => {
    // Live Photon returns "Munnar Colony" twice, 300 m apart. A worker sees two
    // identical buttons and cannot tell which one to tap.
    const { PhotonPlaceProvider } = await import("../src/lib/places.js");
    mode = "normal";
    searchFeatures = [
      feature("Munnar Colony", "Kerala", "Devikulam", 10.0895, 77.0683),
      feature("Munnar Colony", "Kerala", "Devikulam", 10.0921, 77.0661),
      feature("Munnar", "Kerala", "Devikulam", 10.087, 77.0601),
    ];
    const places = await new PhotonPlaceProvider({ baseUrl: base }).search("munnar");
    assert.deepEqual(
      places.map((p) => p.name),
      ["Munnar Colony", "Munnar"],
    );
  });

  it("keeps only Kerala towns, reads a lower-case state, and drops duplicates", async () => {
    const { PhotonPlaceProvider } = await import("../src/lib/places.js");
    mode = "normal";
    const places = await new PhotonPlaceProvider({ baseUrl: base }).search("perum");

    assert.deepEqual(places, [
      PERUMBAVOOR,
      { name: "Perumkavu", area: "Kottayam", latitude: 9.5676, longitude: 76.5747 },
    ]);
  });

  it("asks only inside Kerala's box and only for town-level places", async () => {
    const { PhotonPlaceProvider } = await import("../src/lib/places.js");
    mode = "normal";
    await new PhotonPlaceProvider({ baseUrl: base }).search("perum");

    assert.equal(lastQuery["bbox"], "74.8,8.1,77.5,12.9");
    assert.deepEqual(lastQuery["layer"], ["city", "locality", "district"]);
  });

  /**
   * Photon's reverse answer is ordered by distance, and the closest thing is
   * often a building. Checked on the live service: 9.9816, 76.2999 answers
   * "Zostel" first, 11.25, 75.78 answers a neighbourhood before "Kozhikode".
   * A worker told "You are near Zostel" cannot confirm it, so the provider
   * must skip buildings and prefer a town over a neighbourhood.
   */
  it("prefers a town over a closer neighbourhood or building", async () => {
    const { PhotonPlaceProvider } = await import("../src/lib/places.js");
    reverseFeatures = [
      feature("Zostel", "Kerala", "Kozhikode", 11.2501, 75.7801, {
        osm_key: "landuse",
        osm_value: "commercial",
      }),
      feature("Mittayi Theruvu", "Kerala", "Kozhikode", 11.2502, 75.7802, {
        osm_key: "place",
        osm_value: "neighbourhood",
      }),
      feature("Kozhikode", "Kerala", "Kozhikode", 11.2451, 75.7755, {
        osm_key: "place",
        osm_value: "city",
      }),
    ];

    const place = await new PhotonPlaceProvider({ baseUrl: base }).nearest(11.25, 75.78);
    assert.deepEqual(place, {
      name: "Kozhikode",
      area: "Kozhikode",
      latitude: 11.2451,
      longitude: 75.7755,
    });
  });

  it("uses a closer neighbourhood when no town is near", async () => {
    const { PhotonPlaceProvider } = await import("../src/lib/places.js");
    reverseFeatures = [
      feature("KSINC House", "Kerala", "Kanayannur", 9.975, 76.29, {
        osm_key: "landuse",
        osm_value: "commercial",
      }),
      feature("Gandhi Nagar", "Kerala", "Kanayannur", 9.976, 76.291, {
        osm_key: "place",
        osm_value: "neighbourhood",
      }),
    ];

    const place = await new PhotonPlaceProvider({ baseUrl: base }).nearest(9.975, 76.29);
    assert.equal(place?.name, "Gandhi Nagar");
  });

  it("names the area a building sits in when no place is near at all", async () => {
    const { PhotonPlaceProvider } = await import("../src/lib/places.js");
    reverseFeatures = [
      feature("Zostel", "Kerala", "Kanayannur", 9.9817, 76.3, {
        osm_key: "landuse",
        osm_value: "commercial",
        district: "Elamkulam",
        city: "Ernakulam",
      }),
    ];

    const place = await new PhotonPlaceProvider({ baseUrl: base }).nearest(9.9816, 76.2999);
    assert.deepEqual(place, {
      name: "Elamkulam",
      area: "Kanayannur",
      latitude: 9.9817,
      longitude: 76.3,
    });
  });

  it("names no place when Photon finds nothing in Kerala", async () => {
    const { PhotonPlaceProvider } = await import("../src/lib/places.js");
    reverseFeatures = [
      feature("Chennai", "Tamil Nadu", "Chennai", 13.08, 80.27, {
        osm_key: "place",
        osm_value: "city",
      }),
    ];

    const place = await new PhotonPlaceProvider({ baseUrl: base }).nearest(13.08, 80.27);
    assert.equal(place, null);
  });

  it("gives up after the timeout instead of hanging the worker's page", async () => {
    const { PhotonPlaceProvider } = await import("../src/lib/places.js");
    mode = "hang";
    await assert.rejects(new PhotonPlaceProvider({ baseUrl: base, timeoutMs: 100 }).search("perum"));
  });
});
