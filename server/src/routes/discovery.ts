import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../lib/auth";

export const discoveryRouter = Router();

discoveryRouter.use(requireAuth);

const toggleSchema = z.object({
  looking: z.boolean({ error: "Say whether you are looking" }),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  preferredWorkType: z.string().max(120).optional(),
});

/**
 * POST /api/discovery/toggle
 * Worker or contractor turns visibility on/off and stores a typed location.
 * Location is what they typed or confirmed, not a live stream.
 */
discoveryRouter.post("/toggle", requireRole("WORKER", "CONTRACTOR"), async (req, res) => {
  const parsed = toggleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const { looking, latitude, longitude, preferredWorkType } = parsed.data;

  if (looking && (latitude === undefined || longitude === undefined)) {
    return res.status(400).json({ error: "Latitude and longitude are required when looking is true" });
  }

  const updated = await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      looking,
      latitude: looking ? latitude! : null,
      longitude: looking ? longitude! : null,
      preferredWorkType: preferredWorkType?.trim() || null,
    },
    select: {
      looking: true,
      latitude: true,
      longitude: true,
      preferredWorkType: true,
    },
  });

  return res.json(updated);
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
