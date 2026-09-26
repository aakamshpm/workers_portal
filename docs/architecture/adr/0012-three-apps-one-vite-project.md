# ADR-0012: Three apps from one Vite project

## Status

Accepted. Changes the "one client, chosen by role" design in `plan.md`.

## Context

Each role reaches the product differently: the worker through an installed app and SMS, the contractor through an installed app and a website, the labour officer through a website only.

One web app cannot keep those rules once it is installable. A web app manifest has one name, one start page and one scope. Chrome offers its own install button for any page inside that scope, even when the page shows no prompt, so the officer's pages would become installable too. One app also sends every role's screens to every phone.

## Decision

- One Vite project with three entry points, built as three apps:

  | Address | App | Installable |
  |---|---|---|
  | `/` | Sign-in and worker registration | No |
  | `/worker/` | Worker | Yes, own manifest |
  | `/contractor/` | Contractor | Yes, own manifest |
  | `/officer/` | Labour officer | No, never a manifest |

- Code any two apps use lives in `client/src/shared/`: `api.ts`, `types.ts`, the components, the records page. A change there reaches every app.
- Each app opens only for its own role. A signed-in user who opens another role's app is sent to their own. Signed-out users go to `/`.
- Sign-in stays at `/`, one page for everyone, because the phone number already decides the role. After sign-in it sends each role to its own app.
- The API does not change. The server's `requireRole` checks remain the control. Splitting the frontend hides screens, it does not secure them.

## Consequences

- One dev server, one build, one set of client tests. The build produces three bundles, so the officer bundle carries no hiring or pay screens.
- Manifests and the service worker are written per app in the PWA step, scoped to `/worker/` and `/contractor/`.
- A future page belongs to one app folder, or to `shared/` when more than one app needs it.
- The phone simulator pages (`/phone`, `/messages`) were removed with this change. The worker reads SMS on his own phone. `SmsMessage` stays as the record of what was sent and received, which the officer will read.
