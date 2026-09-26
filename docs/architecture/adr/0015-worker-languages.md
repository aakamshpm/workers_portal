# ADR-0015: Worker text in five languages, without a library

## Status

Accepted.

## Context

Workers come from West Bengal, Assam, Bihar, Jharkhand, Uttar Pradesh and Odisha. Many read little English, and some read little at all. The SMS messages are already in the worker's language (`User.language`, chosen from the home state). The sign-in page and the worker app were English only, so a worker could get an offer in Bengali and then open an app he cannot read.

Contractors and labour officers work in Kerala and use English. Their apps are not part of this decision.

## Decision

- The sign-in page and the worker app show text in English, Hindi, Bengali, Malayalam or Odia: `en`, `hi`, `bn`, `ml`, `or`, the same codes as `User.language`.
- A language button is at the top of every screen of both. Each language is named in its own script, so a worker finds his language without reading English.
- **No i18n library.** The text is one TypeScript dictionary per language under `client/src/shared/i18n/`. `en.ts` is the source. Each other file has the type of `en.ts`, so `tsc` fails when a key is missing or extra. A test checks that every translation has the same `{placeholders}` as English.
- On the sign-in page the choice is stored in the browser, and it is sent with the registration, so a new worker gets his SMS in the language he read the page in. When a worker has no choice yet, the page uses the language of the home state he picks.
- In the worker app the language starts from `User.language`. Changing it calls `PATCH /api/auth/language`, so later SMS use it too.
- The contractor and officer apps have no language button and stay English. Shared components use English when no language is chosen.
- Numbers, money and dates stay in Western digits (₹1,200), because that is what the SMS, wage slips and phone keypads use.

## Consequences

- The translations were written by a model, not by a native speaker. Each language must be checked by a native speaker before real workers use it.
- Error messages from the server stay in English for now. The worker sees them only when something goes wrong.
- A new English string needs a key in all five files, or `tsc` fails.
