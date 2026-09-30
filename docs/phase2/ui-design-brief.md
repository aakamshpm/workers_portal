# Brief: UI design (Google Stitch, then Figma)

For: Teammate 1. First paste [`system-brief.md`](system-brief.md) into your AI tool or into Stitch, then use the prompts here.

## Goal

Design every screen of the three apps plus the sign-in page, in one modern and consistent style. The core developer will build the new design in code, so **only design what is listed here**. A screen or button that is not in this brief has no working code behind it.

## Tools

1. **Google Stitch** (stitch.withgoogle.com, free, Google account). Use it to make a first draft of each screen from a text prompt. Choose **Mobile** for the worker, contractor and sign-in screens, and **Web** for the officer.
2. **Figma** (free plan). In Stitch, use "Copy to Figma", then paste into Figma. In Figma, fix the spacing, make the colours and text styles match the tokens below, and turn repeated parts into components.
3. Export a PNG of every screen into `docs/ui-design/` (for example `worker-01-my-work.png`), and share the Figma link with view access.

Stitch follows your words literally. Give it one screen per prompt, with the exact content. Afterwards, check that it has not added extra features.

## Who the design is for

- **Worker:** a construction worker who is new to smartphones. He may read Bengali, Hindi or Odia better than English, and some workers read very little. He uses a cheap Android phone, often outdoors in sunlight. Think of PhonePe or Google Pay: large text, one clear action, and an icon next to every label.
- **Contractor:** busy on site and using a phone. He needs to see more on one screen than the worker does, but the screens should still be simple.
- **Labour officer:** at a desk, on a laptop. He reads many cases, so use tables, filters and a side menu.

## Design direction

**"Calm, official, trustworthy"**, a mix of a payments app and a government service. It should not look like a startup landing page.

- **Money first.** On the worker's home screen, the biggest element is how much he is still owed. Show the ₹ amount in large numbers.
- **One primary action per card.** Show "Yes, I accept" as a large filled button, with "No" as an outline button next to it.
- **Status uses colour, an icon and a word together**, never colour alone:
  - green with a tick = agreed
  - amber with a clock = waiting
  - red with a warning sign = disputed
- **Cards on a light grey background**, with soft corners (16 px) and very light shadows.
- **Bottom navigation** on the worker and contractor apps (3 or 4 tabs, each with an icon and a label). A **left sidebar** on the officer website.
- **The language button is always at the top right** of the worker and sign-in screens. Show a globe icon and the current language name in its own script (বাংলা, हिन्दी, മലയാളം, ଓଡ଼ିଆ, English).
- Every screen has **four states**: loading (grey skeleton blocks), empty (an icon with one line of text), error (red text with a "Try again" button), and normal.

## Design tokens (use these exact values)

> **Superseded by the built design system (ADR-0019).** The table below is what the designer was asked for. The finished Stitch design carries a fuller Material 3 palette grown from the same seed colour `#0F766E`, and that palette is now the source of truth, in `client/src/shared/theme.css`. Two differences matter when reading the screens: the design's `primary` is the darker `#005c55` (icons, links, active text) and `#0F766E` is its `primary-container` (filled buttons); its page background is `#f8f9ff` and its card radius is 12px.

| Token | Value | Use |
|---|---|---|
| Primary | `#0F766E` (teal 700) | main buttons, active tab |
| Primary dark | `#115E59` | pressed button |
| Ink | `#0F172A` | main text |
| Muted text | `#64748B` | secondary text |
| Background | `#F1F5F9` | page background |
| Surface | `#FFFFFF` | cards |
| Border | `#E2E8F0` | card and input borders |
| Success | `#059669` on `#ECFDF5` | agreed, paid |
| Warning | `#B45309` on `#FFFBEB` | waiting for an answer |
| Danger | `#BE123C` on `#FFF1F2` | disputed, changed record, errors |
| Info | `#0369A1` on `#F0F9FF` | notes |
| Font | **Noto Sans** (and Noto Sans Bengali, Devanagari, Malayalam and Oriya) | It covers all five scripts with one look. Do not use Inter, because it has no Indian scripts |
| Text sizes | 28 amount / 20 title / 16 body / 14 small | worker body text is never smaller than 16 |
| Radius | 16 cards, 12 buttons and inputs, 999 badges | |
| Spacing | multiples of 4 (8, 12, 16, 24) | |
| Touch target | at least 48 × 48 px | every button and each PIN box |
| Focus | 2 px ring in Primary, no browser outline | |

Contrast must be at least 4.5:1 for text. Check it with the Figma plugin "Stark", or at webaim.org/resources/contrastchecker.

## Screens

Numbering: S = sign-in, W = worker, C = contractor, O = officer.

### Sign-in (mobile, `/`)

| # | Screen | Content |
|---|---|---|
| S1 | Phone number | App name, the language button, the title "Sign in", a phone number input (numeric keypad), a "Next" button. Links: "New worker? Make an account", "Forgot PIN?". A small note: "Contractors and labour officers: ask the labour office for an account." |
| S2 | PIN | "Type your 4-number PIN", **4 separate large boxes**, which sign the user in when the fourth digit is typed. There is no Sign-in button. Link: "Start again" |
| S3 | SMS code | "We sent a 6-number code to 98800 30001", **6 boxes** |
| S4 | Your name | one text input, "Next" |
| S5 | Home state | a grid of large buttons: West Bengal, Bihar, Uttar Pradesh, Jharkhand, Assam, Odisha, Kerala |
| S6 | Choose PIN / PIN again | 4 boxes and "Never tell your PIN to anyone." |
| S7 | Error state | S2 with the red message "Wrong phone number or PIN", and with "Too many wrong PINs. Wait 15 minutes." |

### Worker app (mobile, `/worker/`). Bottom tabs: My work · Find work · Ask for help · Records

| # | Screen | Content |
|---|---|---|
| W1 | My work (home) | **Large card at the top: "Bijoy, you are still owed ₹6,300"**. Then "A contractor is offering you work" (card: work type, site, contractor, ₹900 a day, 20 days, "You should get ₹18,000 in total", buttons Yes / No, small text "Or send YES 4821 by SMS"). Then "Please check these" (card: "He says you worked 6 days, 19–24 Sep, worth ₹5,400", buttons "Yes, correct" / "No, not correct", small "Or send OK 7314 or WRONG 7314"). Then "Your work": one card per job |
| W2 | Job card (detail) | Agreed rate (with a lock icon, "fixed"), days recorded (agreed / waiting / disputed), earned, paid, **still owed**, payments list with a proof badge each |
| W3 | Say "not correct" | "How many days did you really work?" (number input), "Anything to add? (optional)", button "Send my answer", note "The labour office will see both numbers." |
| W4 | Accept confirmation | bottom sheet: "You said yes to ₹900 a day at Kakkanad Phase 2. This pay is now fixed." |
| W5 | Find work | "Where are you?" with a town search box and a "Use my location" button. A switch "Contractors can see me" with a one-line explanation. A map (OpenStreetMap style) with pins. A list "Contractors hiring" (name, company, "4.2 km away", call button), and a separate list "Public business listings — these are businesses, not job offers" |
| W6 | Ask for help | form: which job, what is wrong (6 large choices: Not paid, Paid less, Rate is wrong, Days are wrong, Bad conditions, Other), amount owed, language, "Tell the officer what happened" (large text area). Below: "Complaints you have made" with a status badge (Waiting for the officer, Contractor asked to answer, Worker was right, Records do not agree, Sent to a higher office, Nobody could prove it) |
| W7 | Records | a filter row (All, Work offered, Said yes, Work done, Money paid, Agreed, Said wrong), a list of records (type badge, one-line summary, date). At the top: a card **"Has anyone changed anything?" with the button "Check all records"**. Result: a green "Nothing has been changed" or a red "1 record was changed" with the row marked in red and "Rate was ₹900, now shows ₹700" |
| W8 | Language menu | a bottom sheet with 5 large rows, each language in its own script |

Make **W1 in Bengali as well**, so the design is checked with real Indian script lengths. Ask Stitch or the AI for the Bengali text, or take it from the running app.

### Contractor app (mobile, `/contractor/`). Bottom tabs: My workers · Pay · Records

| # | Screen | Content |
|---|---|---|
| C1 | My workers (home) | 3 small stat cards: Workers hired, Awaiting a reply, Wages outstanding (₹). An alert card if present: "The labour office has asked you to respond". "Offers awaiting a reply". "Your workers": one card per worker (name, site, rate, days, paid, owed, "Write down work done" button). "Complaints made against you" |
| C2 | Offer work form | worker's phone number, pay for one day (₹), expected days, type of work, work site, start date, anything else promised. Note: "The worker gets this on his phone and must accept it. After he accepts, the rate cannot be changed." |
| C3 | Write down work done | **first a small balance table** (rate, days so far, earned, paid, owed), then from date, to date, days, note |
| C4 | Pay a worker | choose a worker, then 3 large choice cards: **"Worker reads a code"** (recommended), **"UPI / bank"**, **"Cash, no proof"** (with a warning that this is weakest) |
| C5 | Code payment | amount, "Send code to worker", then "Ask the worker for the code. It is on his phone.", **4 boxes** (`generateHandoverCode` makes a 4-digit code), a 15-minute countdown. The code is **never shown** on this screen |
| C6 | UPI / bank payment | amount, method, transaction number, date |
| C7 | Payments already recorded | a list with proof badges: Bank has a record / Code used when paid / Worker agreed later / Nothing to show / Worker says he got nothing |
| C8 | Records | same as W7 |
| C9 | Answer a disputed record | the worker's number and the contractor's number side by side, "What actually happened?", one answer only (it cannot be edited later) |

### Officer website (desktop 1440 px, `/officer/`). Left sidebar: Complaints · Disputed records · All records · Accounts

| # | Screen | Content |
|---|---|---|
| O1 | Complaints | 3 stat cards (Open cases, Disputes waiting, Closed). A table: worker, contractor, category, amount claimed, status, days open. Filters by status |
| O2 | Case detail | left: the complaint and a timeline of actions. Right: the contract figures (Agreed daily rate, Days recorded, Wages earned, Wages paid), and the contractor's track record. Action buttons: Ask the contractor, Record a phone call, Decide (Upheld / Rejected / Closed, unproven, with a reason), Forward (Labour Commissioner / Police, with grounds) |
| O3 | Disputed records | records the worker rejected without a complaint: both numbers, the employer's answer, "Mark reviewed" (reason: settled outside / decided / no action / unprovable, plus a note) |
| O4 | All records | a full-width table (index, type, summary, date) and the "Check all records" panel. When a record fails: the row is red, and the changed field shows before and after |
| O5 | Accounts | a form: role (Contractor / Labour officer), name, phone, company (contractor only). **No PIN field.** Success message: "Account made. Ask them to open the sign-in page, tap Forgot PIN and type the code sent to their phone." A table of accounts with a badge "Can sign in" or "No PIN yet" |

The officer website must **not** show an "Install app" prompt, a map or a hiring screen.

## Prompts for Stitch

Start with the style prompt, then one prompt per screen in the same project, so the style stays the same.

**Style (first prompt):**

> Design system for a mobile wage-record app for migrant construction workers in India. Calm, official, trustworthy, like Google Pay or PhonePe. Primary teal #0F766E, page background #F1F5F9, white cards with 16px radius and very light shadow, text #0F172A. Font Noto Sans. Large text (body 16px), buttons at least 48px tall, icons next to every label. Status badges use colour plus icon plus word: green tick "Agreed", amber clock "Waiting", red warning "Disputed". Bottom navigation with 4 tabs. Language button with a globe icon at the top right.

**Example screen prompt (W1):**

> Worker home screen "My work". Top bar: app name "Worker Pay Record" on the left, a globe icon with "বাংলা" on the right. A large teal card: "Bijoy, you are still owed" with "₹6,300" in very large numbers. Section "A contractor is offering you work": a card with "Steel binding at Kakkanad Phase 2", "Ramesh Pillai · Ramesh Builders", "₹900 a day", "About 20 days, starts 1 Oct", a light box "You should get ₹18,000 in total", a big green button "Yes, I will take this work", an outline button "No", small grey text "Or send YES 4821 by SMS". Section "Please check these": a card "He says you worked 6 days", "19 Sep to 24 Sep · worth ₹5,400", buttons "Yes, correct" and "No, not correct". Bottom navigation: My work (active), Find work, Ask for help, Records. No other features.

Write the other screen prompts the same way, from the tables above. Always end with "No other features."

## Checklist before you share

- [ ] Every screen in the tables exists, and nothing else.
- [ ] The colours, font and radius match the tokens.
- [ ] Every status shows colour, an icon and a word.
- [ ] Every button is at least 48 px tall, and the worker's text is at least 16 px.
- [ ] W1 also exists in Bengali, and nothing breaks with the longer text.
- [ ] Each main screen also has its loading, empty and error states.
- [ ] No PIN field on O5. No code shown on C5.
- [ ] PNGs are in `docs/ui-design/`, and the Figma link can be opened by anyone with the link.
