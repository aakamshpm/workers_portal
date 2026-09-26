# Tech stack

Locked. Change only with a new ADR.

| Piece | Choice | ADR |
|---|---|---|
| Language | TypeScript | 0001 |
| API | Express on Node | 0001 |
| Web | React + Vite, three apps from one project | 0001, 0012 |
| Database | PostgreSQL + PostGIS | 0002 |
| ORM | Prisma | 0002 |
| Integrity | Hash chain + HMAC | 0003, 0004 |
| Mobile | PWA | 0005 |
| SMS | Textbee hosted API + one Android SIM | 0008 |
| Maps | Leaflet + OpenStreetMap tiles | — |
| Page tests | Vitest + Testing Library + jsdom | 0009 |
| Place search | Photon (OpenStreetMap), called by the server, district-town fallback | 0010, 0011 |

Local run: API and Vite on the host. Postgres runs in Docker.
