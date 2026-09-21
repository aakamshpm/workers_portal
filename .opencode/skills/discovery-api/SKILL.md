---
name: discovery-api
description: Implement POST /api/discovery/toggle and the two nearby GET routes. Use only for that server work. Core agent. Not for building the React pages.
---

# discovery-api

Contract: `docs/contracts/discovery.md`. ADR-0006.

1. Schema fields must already exist (`setup-postgres`). If not, stop and run that skill first.
2. Write failing route tests from the contract JSON. Fake auth. Use the test database, not production.
3. Implement the three routes. Distance: PostGIS `ST_DWithin`. Do not return live coordinates, only `distanceKm`.
4. Seed enough rows with Ernakulam-area coordinates that a 25 km query returns both a contractor and a public listing.
5. Pages are `build-screen`, not this skill.
