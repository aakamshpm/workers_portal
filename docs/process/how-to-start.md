# How to start

Skill: `repo-onboarding`.

Needs Node.js 20.19 or newer and Docker.

```bash
npm install
npm run db:up
npm run setup        # also creates server/.env from .env.example
npm run db:migrate
npm run seed
npm run dev
```

API: `http://localhost:4000`. Web: `http://localhost:5173`.

The seed makes worker, contractor and officer accounts with PIN `1234` (table in `docs/project/current-state.md`). This is for a development database only.

On a real database there is no seed. Make the first officer with:

```bash
npm --prefix server run create-officer -- --name "Your Name" --phone 9000020002
```

That account has no PIN. Its owner opens `http://localhost:5173/`, taps "Forgot PIN?", and types the code sent to his phone. This needs `TEXTBEE_API_KEY`, because without it no SMS is sent and `POST /api/auth/code` fails.

## Textbee (human, not an agent)

1. Account at [textbee.dev](https://textbee.dev)
2. Install the app on one Android phone from [textbee.dev/download](https://textbee.dev/download)
3. Grant SMS permission, register the device, copy the API key into `server/.env`
4. Leave that phone on and charged while sending SMS

## Agent to use

| Person | Agent | Switch |
|---|---|---|
| Core developer | `core` | default |
| Teammate | `ui` | Tab |
| Review a diff | `@review` | mention |

Teammates do not use `core`. File permissions on `ui` block the ledger, hash, offers, auth, payments, and schema files.
