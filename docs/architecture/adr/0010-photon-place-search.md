# ADR-0010: Place search through Photon, with a district-town fallback

## Status

Accepted.

## Context

Kerala has 14 districts and thousands of towns. A hard-coded list of places cannot cover them. A worker also cannot type coordinates, so the page needs place names.

Two free geocoders use OpenStreetMap data. Nominatim's usage policy forbids search-as-you-type and allows one request per second for the whole application. Photon is designed for search-as-you-type and allows reasonable use, with no guarantee that it stays available.

Checked against the live service: misspellings work (`perumbavur` finds Perumbavoor, `kakanad` finds Kakkanad), three letters are enough (`alu` finds Aluva), and a reverse lookup limited to town layers returns a town, not a street. Malayalam script returns nothing.

## Decision

- Place search uses Photon (`https://photon.komoot.io`, overridable with `PHOTON_BASE_URL`), limited to Kerala's bounding box and to town-level layers. Results whose `state` is not Kerala are dropped, because the box also covers parts of Tamil Nadu and Karnataka.
- The server calls Photon and the browser does not, so Photon never sees a worker's IP address. The server caches answers for 24 hours and gives up after 4 seconds.
- When Photon fails or times out, the server answers from the `Town` table: the 14 district towns, written by the migration, so every database has them. The response says `source: "fallback"` so the page can tell the worker.
- The chosen town's name is stored as `User.locationName`, so a saved location is shown by name without asking Photon again.
- Tests inject a fake provider and never call Photon.

## Consequences

- If Photon is down, a worker can still choose one of the 14 district towns, and a saved location still works because its coordinates are stored.
- A worker must spell a Kerala place in English letters. ADR-0011 adds a button that needs no typing.
- Contract: `docs/contracts/discovery.md`.
