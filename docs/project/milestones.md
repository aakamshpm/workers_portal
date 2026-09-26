# Milestones

Status only. The ordered build is [`plan.md`](plan.md).

| Milestone | Intent | Status |
|---|---|---|
| Structure | Docs, ADRs, OpenCode agents and skills | Done |
| Platform | Postgres + PostGIS, HMAC, Textbee provider, poll inbound SMS | Done |
| Worker | PWA on worker routes, Find Work, SMS as second client | Not started |
| Contractor | PWA on contractor routes, website, Find Workers | Not started |
| Labour office | Website only. No install prompt, no hiring map | Not started |
| Close | Docs rewrite, deploy, webhook instead of poll | Not started |

Already in the codebase and must keep working:

- Offer → accept → locked terms
- Work periods, payments, worker OK/WRONG
- Employer statement, officer dispute review
- Complaints, four outcomes, two escalation destinations
- Hash chain that rebuilds from the live row (`rebuildPayload`)
- Server tests in `server/test/`
