# Wage ledger

Product for inter-state migrant workers in Kerala. See [`docs/project/purpose.md`](docs/project/purpose.md).

## Start

```bash
cp server/.env.example server/.env
npm install
npm run db:up
npm run setup
npm run dev
```

API on `:4000`. Web on `:5173`.

Agents: [`AGENTS.md`](AGENTS.md). Humans: [`docs/process/how-to-start.md`](docs/process/how-to-start.md).
