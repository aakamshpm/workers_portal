# ADR-0019: One design system for the three apps

## Status

Accepted.

## Context

The three apps (ADR-0012) were built screen by screen with Tailwind classes written in place. Colours, radii and text sizes are repeated in every file, the primary colour is `slate-900`, and text is as small as 11px. A worker reads the app outdoors, on a cheap screen, in one of five scripts.

A teammate then designed all 29 screens in Google Stitch (`docs/phase2/ui-design-brief.md`). That design carries a complete Material 3 palette derived from the seed colour `#0F766E`, a named text scale, a spacing scale and one page skeleton used by every screen. It is more complete than the token table in the brief, and it is the design we are adopting.

The design's HTML also contains text and controls the product does not have, so the design cannot be copied as it is.

## Decision

- **The design's tokens are the source of truth for appearance**, and they live in one file, `client/src/shared/theme.css`, as Tailwind 4 `@theme` variables. Every app imports it. No component writes a hex colour, a pixel radius or a font size.
  - The seed colour is `#0F766E`. In Material 3 that seed gives `primary` `#005c55` (icons, links, active text) and `primary-container` `#0F766E` (filled buttons). The brief's single "primary" row is therefore replaced by the fuller palette, and the brief is corrected.
  - Text scale: `stat-callout` 28/700, `headline-lg` 24/700, `headline-md` 20/700, `headline-sm` 18/600, `body-lg` 16/400 (with medium and bold), `label-md` and `label-sm` 14. Nothing below 14, and nothing below 16 for body text a worker reads.
  - Radius: cards and fields `xl` = 12px, pills `full`. Spacing: `space-xs` 4px to `space-2xl` 32px.
  - Touch targets are at least 48px, and the design's own sizes are kept: 52px buttons, 56px digit boxes, 56px header.
- **Shared components carry the design, not the pages.** `client/src/shared/components/` holds the header, card, button, text field, note, badge, choice row, sheet, skeleton, empty state and icon. A page composes them and never repeats their classes.
- **Text comes from the language files (ADR-0015), never from the design.** The design's words are English mock-ups; ours are already translated and are what the server sends.
- **Data comes from the API contracts.** Any field, figure, button or status in the design with no route behind it is dropped, and this ADR names three examples that must never be built, because each contradicts a principle: a control that edits or deletes a record, anything that changes an agreed rate, and the officer's dispute review described as sealing or correcting a record.
- **No claim of a government link.** The design's "National Public Labour Register", "Kerala Labour Welfare Board", Aadhaar checks, wage slips, Acts, docket numbers and "legally protected" lines are removed. What we may say is what is true: a record is sealed when it is written, and a change to it is detected. A worker acting on a false promise of official backing is worse off than one who was told plainly what the app does.
- **The system keyboard, not a drawn keypad.** The design draws a 3×4 numeric keypad on four screens. Numeric inputs keep `inputMode="numeric"`, because the phone's own keyboard opens anyway, it is the keyboard the worker already knows, and Android's SMS-code autofill needs a real input.
- **Icons are inline SVG** in one `Icon` component, not the Material Symbols web font the design links. A font from a CDN does not load offline, and ADR-0018 requires the app to open offline.
- **Fonts are served from the repo, not a CDN**, for the same reason: Noto Sans plus Devanagari, Bengali, Malayalam and Odia, from the pinned `@fontsource-variable` packages (SIL Open Font License 1.1). One variable file per script covers every weight, and each face declares its own `unicode-range`, so the browser fetches a script's file only when that script is drawn.

## Consequences

- Every existing page is restyled. The work is client only: no route, no schema and no contract changes.
- Page tests keep passing, because they find text and roles, not classes. Each rebuilt screen keeps its tests and gains the loading, empty and error states the design shows.
- A colour or size change is one edit in `theme.css`.
- The four Indic files are about 420 KB together. The contractor and officer apps, which are English with no language menu, never fetch them. The sign-in page and the worker app do, because the language menu names each language in its own script.
- The officer website gets one smaller control size, 40px, for dense tables read with a mouse. The worker and contractor apps never use it, since they are used with a finger outdoors.
- The design files stay outside the repository, and the PNG and HTML for each screen are reference only.
- Measured on a 320px phone, the narrowest Android screen still sold, in all five languages:
  - The six code boxes are about 41px wide and keep their 56px height. Six 48px boxes with their gaps need 328px, and the screen has 288px inside its margins. WCAG 2.2 asks 24px for a target, and the height is the side a thumb lands on.
  - Below 400px the header name drops its icon and is 16px. Below 420px the worker header shows the language list as a globe alone, because "പണിക്കൂലി കണക്ക്" and "മലയാളം" do not fit beside the account button.
- The worker app has the design's phone frame (W1): the app name, the language list and one account button in the header, with name, phone, home state and "Sign out" in a small panel behind that button, and the four sections as a bar fixed at the foot of the screen. The contractor and officer apps keep their older header until their own screens are rebuilt.
