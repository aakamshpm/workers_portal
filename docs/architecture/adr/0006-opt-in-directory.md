# ADR-0006: Opt-in directory, typed location

## Status

Accepted. Amended by [ADR-0011](0011-one-time-device-location.md): a worker may also set the location with a one-time device reading, saved only as the nearest town.

## Context

A live map of every worker’s phone number is unsafe. OpenStreetMap does not know who is hiring.

## Decision

- A worker or contractor appears in nearby search only after they turn “looking for work / hiring” on and type a location.
- No continuous GPS share.
- Two result groups: people in this database, and public OSM-style business listings. The second group is labelled as businesses, never as jobs.
- Phone numbers of opted-in people are visible because they consented. That is enough for this product. Masking until offer-accept is a later ADR if needed.

## Consequences

- Contract: `docs/contracts/discovery.md`.
- Skill: `discovery-api`.
