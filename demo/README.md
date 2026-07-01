# Demo playground

A single-page, client-side demo of the redaction round-trip. It loads the
engine from `vendor/pii-core.mjs` (built from `src/`) and, when you enable the
NER toggle, fetches a Transformers.js model from a CDN with a progress bar.

## Run

ES module imports require an HTTP origin (not `file://`), so serve the folder:

```bash
npm run build:browser        # regenerate vendor/pii-core.mjs from src/
npx http-server demo -p 8080 # or: python3 -m http.server 8080 -d demo
# open http://localhost:8080
```

## What it shows

1. **Your text** — editable, pre-seeded with mixed PII and dictionary terms.
2. **Redacted text** — what would actually be sent to a cloud LLM; placeholders
   highlighted.
3. **Review before send** — every detected entity with its type, source
   (deterministic / ner / dictionary), and confidence.
4. **Round-trip & rehydrate** — paste a mock LLM response referencing the
   placeholders; rehydration restores real values locally. Unknown/hallucinated
   placeholders are left untouched.
5. **Vault** — the placeholder → value map that never leaves the page.

The NER toggle is off by default so the demo works fully offline; turning it on
downloads `Xenova/bert-base-NER` (~30–65 MB, cached after first load) to also
catch names, organizations, and locations.
