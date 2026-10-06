# ADR-0021: The officer website has a sidebar, and Disputed records is its own page

## Status

Accepted. Refines ADR-0012 (three apps) and ADR-0019 (one design system) for the officer website. ADR-0019 kept the officer website on its old header "until its sidebar ADR"; this is that ADR.

## Context

The design (O1 to O5) draws the officer app as a desktop page with a left sidebar of four sections: Complaints, Disputed records, All records, Accounts.

The running app has three tabs along the top, and the disputes are a second tab inside the Complaints page. An officer who wants the records that workers rejected has to open Complaints first, although the two queues come from different sources: a written complaint, and a record the worker rejected without writing anything.

The design also draws things we do not have or must not say. Most are already excluded by ADR-0019 (a link to a government portal, Act and Rule numbers, form numbers, licence and registration numbers, a "compliance rating"). Others have no route behind them: hearing notices, hearing dates, a "days open" column, search, export, pages, "settled this quarter" totals, a jurisdiction, and a Hindi and English switch.

## Decision

- **Four sections in a sidebar**, in a `nav` named "Sections": Complaints, Disputed records, All records, Accounts. The address of each is `/officer/complaints`, `/officer/disputes`, `/officer/records`, `/officer/accounts`.
- **Width.** From 1024px up, the sidebar is a 256px column at the left that stays in place while the page scrolls. Below 1024px (a tablet), the same four links are one row under the top bar. It is one `nav` in both cases, not two copies.
- **The top bar** holds the app name on the left, and on the right the officer's name, his office and a visible "Sign out". The officer uses a mouse and has the room, so his account is not hidden behind a button as it is on the phone apps.
- **Disputed records is a page of its own.** The list of records the worker rejected, the officer's review form, and the list of those already dealt with move out of the Complaints page. The Complaints page keeps its three counts, and the "Disputes waiting" count is a link to the new page.
- **The review keeps its words.** An officer marks a disputed record as reviewed, with one of four reasons and a note. The design's description of "Decided" as "issued binding ledger correction" is not used, because a review changes no record (ADR-0019, ADR-0007). The wording stays as it is today.
- **Not built, with the reason:** hearing notices, hearing dates and the statuses that come from them (we have the six complaint statuses); the "days open" column, search, export and pages (no route, and the lists are short; a contract comes first if the caseload grows); the language switch (the officer app is English, ADR-0015); jurisdiction, registration and licence numbers (not in our data).
- **The complaint case stays an expanding card.** The design's separate case page with "Back to Complaints" is not part of this decision.
- **Still a website only** (ADR-0012): no manifest, no service worker, no install button.
- **Colours and sizes come from the theme** (ADR-0019). The 40px control size is for the officer website only, since a table is read with a mouse.

## Consequences

- The officer app has four tabs, not three. The test that lists each app's tabs changes with it.
- `AuthorityDashboard.tsx` becomes two pages, one for complaints and one for disputed records. No route, schema or contract changes; the API is the same.
- The older header in `AppShell.tsx` is used by the officer app only, so it is renamed and rebuilt as the officer frame. The phone frame is unchanged.
- An officer who had `/officer/complaints` saved finds it still works. The first section stays Complaints.
- Checked in a browser at 768, 1024 and 1280px, as the phone apps were at 320, 360 and 390px.
