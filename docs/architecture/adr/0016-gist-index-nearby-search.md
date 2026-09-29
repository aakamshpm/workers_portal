# ADR-0016: GiST index for nearby search

## Status

Accepted.

## Context

ADR-0002 chose PostGIS because it offers `ST_DWithin` and a GiST index. The index was never created. The nearby queries compute `ST_MakePoint(longitude, latitude)::geography` from two plain columns, so PostgreSQL computes the distance to every row of `User` or `Place` on every search. The time grows in a straight line with the number of rows.

## Decision

- Two expression indexes, `User_location_gist` and `Place_location_gist`, on `(ST_MakePoint(longitude, latitude)::geography)` using GiST. They are expression indexes, not a new column, so `User.latitude` and `User.longitude` stay as they are, and Prisma and every route that writes them are unchanged.
- The `User` index is partial: `WHERE looking = true AND latitude IS NOT NULL`. Only people who opted in are ever searched (ADR-0006), so the index holds only them.
- The query text lives in one place, `server/src/lib/nearby.ts`, and the routes call it. A GiST index is used only when the query uses exactly the indexed expression. One helper keeps the query and the index the same, and a test checks the plan uses the index.
- `ST_DWithin` stays as the filter, because it can use the index. `ST_Distance(...) < r` cannot.
- `haversineKm` in the same file is the brute-force baseline for the benchmark and for tests. The routes do not use it.
- Benchmark: `npm --prefix server run bench:search` writes `docs/research/results/search_bench.csv`.

## Consequences

- Each insert or change of a searchable location also updates the index. Locations change far less often than people search, so this is worth it.
- The discovery contract (`docs/contracts/discovery.md`) is unchanged: same routes, same fields.
- No new service and no new dependency.
