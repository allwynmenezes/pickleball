# Assistant examples ("training set")

Example messages and the exact JSON the assistant's model should return,
reviewed and approved by the app's owner before use.

- `examples.source.mjs` — the examples, the interpretation rules (C1–C10)
  they follow, and the made-up player group and base event they use.
- `build.mjs` — fills in each example's full model JSON and works out what
  the app would do with it using the live code (`buildDraft` /
  `buildEdit`), then writes `examples.json`. Run `node training/build.mjs`
  after changing the source; an example that doesn't come out as intended
  shows up in its output.
- `examples.json` — the generated set (committed, so reviews and tests use
  exactly what was reviewed).

## How approved examples are used

The model (`@cf/meta/llama-3.3-70b-instruct-fp8-fast` on Workers AI) can't
be fine-tuned — Workers AI only takes LoRA adapters on unquantized models —
so approved examples are used in two ways instead:

1. **In the prompt** — a few of the most instructive approved examples go
   into the system prompt, showing the model the exact JSON expected for
   tricky phrasing (per-court modes, repeating breaks, spoken descriptions).
2. **As an accuracy gate** — every approved example is run against the real
   model before a deploy; anything that no longer comes out as approved
   blocks the change.

Examples marked "needs change" are fixed and re-reviewed; rejected ones are
left out of both.
