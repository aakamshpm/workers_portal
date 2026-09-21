# ADR-0002: PostgreSQL + PostGIS

## Status

Accepted.

## Context

Nearby search needs distance queries that stay fast as the table grows. PostGIS provides `ST_DWithin` and a `GiST` index.

## Decision

PostgreSQL 16 with the PostGIS extension. Local database runs in Docker (`postgis/postgis:16-3.4`). The API stays on the host.

## Consequences

- Prisma provider is `postgresql`.
- `DATABASE_URL` is a Postgres URL.
- Skill: `setup-postgres`.
