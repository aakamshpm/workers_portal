# ADR-0001: TypeScript, Express, React, Vite

## Status

Accepted.

## Context

The team is small. The API and the web client share types more easily in one language. Express and Vite are enough for one backend and one SPA.

## Decision

TypeScript, Express, Prisma, React, and Vite.

## Consequences

- Application code lives in `server/` and `client/`.
- No NestJS, no Next.js, no Flutter, no React Native.
