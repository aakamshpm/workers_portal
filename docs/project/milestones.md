# Milestones

Status only. The ordered build is [`plan.md`](plan.md).

| Milestone | Intent | Status |
|---|---|---|
| Structure | Docs, ADRs, OpenCode agents and skills | Done |
| Platform | Postgres + PostGIS, HMAC, Textbee provider, poll inbound SMS | Done |
| Worker | Three apps, access rules, sign-in by phone code, accounts, languages, Find Work, SMS as second client | Done |
| Contractor | PWA on contractor routes, Find Workers | Not started |
| Labour office | Website only. No install prompt, no hiring map. Accounts page done; SMS log page not started | In progress |
| Close | Docs rewrite, deploy, webhook instead of poll | Not started |

Already in the codebase and must keep working:

- Offer → accept → locked terms
- Work periods, payments, worker OK/WRONG
- Employer statement, officer dispute review
- Complaints, four outcomes, two escalation destinations
- Hash chain that rebuilds from the live row (`rebuildPayload`)
- Three apps, each opening only for its own role (ADR-0012); access rules so each reader sees only his own records (ADR-0013)
- Sign-in by phone code: registration, forgot PIN, officer-made accounts with no PIN until the owner sets one (ADR-0014)
- Worker text in five languages, contractor and officer apps stay English (ADR-0015)
- Server tests in `server/test/`, client page tests in `client/src/**/*.test.tsx`
