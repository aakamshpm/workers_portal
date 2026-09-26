# ADR-0011: One-time device location, saved as the nearest town

## Status

Accepted. Amends ADR-0006.

## Context

ADR-0006 says location is typed, never a live GPS stream. Typing is hard for a worker who is not comfortable with technology, and a worker from Bihar or West Bengal may not know how to spell a Kerala town in English letters.

## Decision

- Find Work offers a "Use my location" button. It reads the phone's position once, only when the worker taps it. There is no background tracking and no repeated reading.
- The position is rounded to three decimals (about 100 metres) and sent to the server, which asks Photon (ADR-0010) for the nearest town.
- The worker sees "You are near <town>" and must confirm before anything happens.
- Only the town is used and stored: its name and its coordinates. The phone's exact position is never saved and never shown to contractors.
- Searching, by button or by typing, never makes a worker visible. Being visible stays a separate button, as ADR-0006 requires.

## Consequences

- Browsers allow location only on `localhost` or HTTPS. Opening the site on a plain `http://` network address during a demo will make the button fail, and the page falls back to the search box.
- ADR-0006 still holds: there is no continuous GPS stream, and the directory stays opt-in.
