# Phase 2: team tasks

Review meeting: **Wednesday 30 September 2026**. Phase 2 needs design documents, the UI design, and the research part (algorithm study and results).

## Who does what

| Person | Task | Brief | Output |
|---|---|---|---|
| Core developer | All code: GiST index, search benchmark, Merkle tree, benchmark numbers, building the new UI | — | code, CSV result files |
| Teammate 1 | UI design in Google Stitch, finished in Figma | [`ui-design-brief.md`](ui-design-brief.md) | Stitch/Figma project link, PNG of every screen |
| Teammate 2 | Design diagrams in Mermaid | [`diagrams-brief.md`](diagrams-brief.md) | `.md` files with Mermaid code, PNG of each diagram |
| Teammate 3 | Research write-up: GiST index and Merkle tree | [`research-brief.md`](research-brief.md) | one document, with space kept for graphs |

## How to use these files with an AI tool

Every task needs the same background, so it is in one file: [`system-brief.md`](system-brief.md).

1. Open your AI tool (ChatGPT, Gemini, Claude, or any other).
2. Paste the whole of `system-brief.md` first.
3. Then paste your own brief.
4. Then ask for one piece at a time, for example "the ER diagram only", not "all the diagrams".

The AI does not know this project. If it invents a screen, a table, a field or a feature that is not in the briefs, remove it. When you are not sure, ask the core developer. Do not guess.

## Dates

| When | What |
|---|---|
| Sunday 27 | First draft of your part, shared with the team |
| Monday 28 | Review each other's parts and fix mistakes |
| Tuesday 29 morning | Core developer shares the benchmark numbers (CSV) |
| Tuesday 29 evening | Everything final. Slides ready. One full practice run together |
| Wednesday 30 | Meeting |


## Rules

- Do not change the code. Files go in `docs/design/` (diagrams), `docs/research/` (write-up) and `docs/ui-design/` (screen PNGs), or send them to the core developer.
- Use only the example data in the briefs. Never use a real person's phone number.
- Lead with the wage, not the hashing. The product is "a worker can prove what he was promised and what he was paid". Hashing is how we make that proof hold.
