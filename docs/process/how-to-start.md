# How to start

Skill: `repo-onboarding`.

```bash
cp server/.env.example server/.env
# add TEXTBEE_API_KEY when you have one
npm install
npm run db:up
npm run setup
npm run seed
npm run dev
```

API: `http://localhost:4000`. Web: `http://localhost:5173`.

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
