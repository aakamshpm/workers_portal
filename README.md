# Worker Pay Record

A wage and complaint record for inter-state migrant workers in Kerala. A worker can prove the daily pay he was promised, the days he worked and the money he was paid, and nobody can change those records afterwards. See [`docs/project/purpose.md`](docs/project/purpose.md).

## You need

- **Node.js 20.19 or newer**, 22 or 24 recommended (`node -v`). Vite 8 and Prisma 7 do not run on older versions.
- **Docker** with Compose, for the database (`docker compose version`).
- Git.

## Run it

```bash
git clone https://github.com/aakamshpm/workers_portal.git
cd workers_portal

npm install          # root tools
npm run db:up        # start Postgres + PostGIS in Docker
npm run setup        # install server and client, create server/.env, generate Prisma
npm run db:migrate   # create the tables
npm run seed         # add example users and records
npm run dev          # start the API and the web apps
```

If `db:migrate` says it cannot reach the database, wait 10 seconds and run it again. Postgres needs a moment after `db:up` the first time.

Open **http://localhost:5173/** and sign in with one of these (PIN **1234** for all of them):

| Phone | Name | Opens |
|---|---|---|
| 9880030001 | Bijoy Das | worker app (Bengali) |
| 9880030002 | Sanjay Kumar | worker app (Hindi) |
| 9000010001 | Ramesh Pillai | contractor app |
| 9000020001 | Anita Joseph | labour officer website |

These are example accounts for your own computer only. The seed refuses to run against any database that is not on `localhost`.

## SMS

Without a Textbee key, the app works, but nothing is sent by SMS, so registering a new worker and "Forgot PIN" cannot finish. Sign in with the accounts above. Setting up Textbee: [`docs/process/how-to-start.md`](docs/process/how-to-start.md).

## Stop, reset, test

```bash
npm run db:down      # stop the database (data is kept)
npm run seed         # put the example data back (deletes all users and records first)
npm test             # needs the test database once, see docs/process/development-workflow.md
npm run typecheck
```

## More

- Phase 2 team tasks: [`docs/phase2/README.md`](docs/phase2/README.md)
- Agents: [`AGENTS.md`](AGENTS.md). People: [`docs/process/how-to-start.md`](docs/process/how-to-start.md)
