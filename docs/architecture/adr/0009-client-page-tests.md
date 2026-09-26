# ADR-0009: Client page tests with Vitest and Testing Library

## Status

Accepted.

## Context

The workflow requires a failing test before code, and lists page tests (loading, empty, error, happy path). The client had no test runner, so a page rule such as "public listings are labelled as businesses, not jobs" (ADR-0006) could disappear with nothing to notice.

## Decision

- Vitest as the runner, because it reads the existing `vite.config.ts` and needs no second build setup.
- `@testing-library/react` to render a page and find text the way a reader sees it.
- `jsdom` as the browser DOM inside Node.
- Exact versions, dev dependencies only. Nothing ships to the browser.
- Page tests mock `client/src/api.ts`. They never call the API or textbee.dev.

## Consequences

- Tests sit next to the page: `client/src/pages/*.test.tsx`. Run with `npm --prefix client test`.
- `npm test` at the root runs server and client suites.
- Teammates on the `ui` agent write page tests the same way.
