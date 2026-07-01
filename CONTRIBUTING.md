# Contributing

Thanks for wanting to help. This is a small, focused library, and the goal is to
keep it that way: correct, fast, and dependency-free at the core.

## Getting set up

```bash
git clone https://github.com/indrapranesh/pii-redaction.git
cd pii-redaction
npm install
npm test
```

That's it — the core and its tests have no external model dependency. The NER
layer needs `@huggingface/transformers`, but the unit tests inject a fake, so you
only need the real thing if you're working on the model adapter or running the
NER eval.

Before opening a pull request, make sure both of these pass:

```bash
npm test          # vitest
npm run typecheck # strict tsc
```

## What a good change looks like

- **New detectors come with fixtures.** If you add a recognizer or validator,
  add cases to the relevant test in `test/` and, where it makes sense, an example
  to `eval/fixtures.ts`. A detector without a test isn't finished.
- **Precision matters as much as recall.** A validator that rejects false
  positives (a checksum, a structural rule) is worth more than a broader regex.
  If you're adding a numeric identifier, look for its check digit first.
- **Keep the core dependency-free.** Anything that needs a heavy runtime belongs
  behind an interface (like `NerProvider`), not imported directly by the engine.
- **Match the surrounding style.** Comments explain *why*, not *what*. The
  existing files are the style guide.

## Where things live

- `src/deterministic/` — regex detectors and their validators
- `src/ner/` — the Transformers.js adapter and chunking
- `src/formats/` — structure-aware redaction (FHIR; HL7/C-CDA welcome)
- `src/reconcile.ts`, `src/placeholders.ts` — overlap resolution and tokens
- `eval/` — the accuracy harness and dataset tooling
- `test/` — vitest unit tests

## Reporting bugs

Open an issue with a minimal reproduction — the input text (or a redacted stand-in
if it contains real data) and what you expected versus what you got. If it's a
detector missing or over-firing, the exact string helps most.

If you think you've found a security problem, please don't open a public issue;
see [SECURITY.md](SECURITY.md).

## Commit and PR notes

- Keep pull requests focused on one thing.
- Reference the issue you're closing.
- By contributing, you agree your work is licensed under the project's
  [MIT license](LICENSE).
