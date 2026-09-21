---
name: setup-postgres
description: Configure Prisma for PostgreSQL + PostGIS, including User location fields and Place listings. Use when setting up the database. Core agent only.
---

# setup-postgres

ADR-0002.

1. Compose file is `compose/docker-compose.yml`. Start with `npm run db:up`.
2. Prisma provider is `postgresql`.
3. Enable PostGIS (`CREATE EXTENSION IF NOT EXISTS postgis`) in a migration.
4. Add `latitude`, `longitude`, looking/hiring flag, `preferredWorkType` on `User`, and a `Place` model for public listings.
5. Seed coordinates around Ernakulam. Keep the seven people and the existing wage stories.
6. `DATABASE_URL` is `postgresql://wage:wage@localhost:5432/wage`.
7. Existing server tests must pass against Postgres.
8. Do not implement discovery routes here. That is `discovery-api`.
