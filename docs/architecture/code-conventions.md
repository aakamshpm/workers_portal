# Code conventions

- TypeScript. One file, one concern. Split a page when it mixes fetch, form, and layout.
- Reuse components in `client/src/components/` before adding a new one.
- Tailwind utility classes. No new CSS file per component.
- Server routes stay thin: parse input, call a function, return JSON. Money and hashing do not live in React.
- SMS goes through `SmsProvider`. Tests inject a fake. Production uses Textbee.
- Do not hash `LedgerEntry.payload` to verify a row. Rebuild from the live table (`rebuildPayload` in `server/src/lib/ledger.ts`). That bug is documented in `docs/project/current-state.md`.
