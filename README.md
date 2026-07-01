# @pii-redaction/core

Framework-agnostic, **client-side** PII redaction engine. It detects PII in
text, swaps it for stable placeholders, and keeps the placeholder→value mapping
(the **vault**) in memory so it never leaves the browser. Only the redacted text
is sent to a cloud LLM; the model's response is **rehydrated** locally.

```
User text  →  REDACT (in browser)  →  "[[PERSON_1]] can't access [[ACCOUNT_1]]"
                                            ↓  send only redacted text
                                       Cloud LLM (GPT / Claude)
                                            ↓  response references [[PERSON_1]]
           ←  REHYDRATE (in browser) ←  swap placeholders back to real values
```

The only component that ever touches raw PII is this in-browser engine.

## Why this design

- **Deterministic layer under the ML layer.** The PII that causes real
  compliance damage — SSNs, cards, emails, phones, account IDs — is *structured*.
  It's caught with regex + checksums at near-100% recall, deterministically, with
  zero model dependency. The NER layer only handles fuzzy, contextual entities
  (names, orgs, locations). Reliability is highest exactly where stakes are.
  This mirrors [Microsoft Presidio](https://github.com/microsoft/presidio); the
  novelty is doing it client-side.
- **Dedicated NER, not a generative LLM.** Entity detection wants a
  token-classification encoder (BERT/DistilBERT), not a generative model:
  smaller (~30–65 MB quantized), faster (tens of ms), and more reliable at span
  extraction.
- **A round-trip, not a scrubber.** Stable placeholders preserve coreference so
  the LLM can still reason about "the same person," and the vault stays local.

## Install

```bash
npm install @pii-redaction/core
# optional: the contextual NER layer
npm install @huggingface/transformers
```

## Usage

### Deterministic-only (zero dependencies, microsecond latency)

```ts
import { redact, rehydrate } from '@pii-redaction/core';

const { redactedText, vault, entities } = await redact(
  'Email jane@example.com about card 4111 1111 1111 1111.',
);
// redactedText: "Email [[EMAIL_1]] about card [[CREDIT_CARD_1]]."

// ...send redactedText to your LLM, receive `response`...
const answer = rehydrate(response, vault); // real values restored, locally
```

### With the contextual NER layer (names / orgs / locations)

```ts
import { redact } from '@pii-redaction/core';
import { createTransformersNer } from '@pii-redaction/core/ner/transformers';

const ner = createTransformersNer({
  model: 'Xenova/bert-base-NER', // swap to a fine-tuned DistilBERT for production
  quantized: true,               // ~30–65 MB int8 weights
  // device: 'webgpu',           // auto-detected; falls back to WASM
});

const { redactedText, vault } = await redact(myText, {
  ner,
  policy: {
    minConfidence: 0.5,          // bias toward recall: when in doubt, redact
    dictionary: [                // close NER gaps with known terms
      { term: 'Project Bluebird', type: 'MISC' },
      { term: 'Acme Corp', type: 'ORG' },
    ],
  },
});
```

The heavy model dependency is **loaded lazily** on first `detect()`, and the
`NerProvider` interface is pluggable — inject any implementation (or a stub for
tests) so the core never hard-depends on a model runtime.

## Architecture

Three layers, orchestrated by `redact()`:

1. **Deterministic detectors** (`src/deterministic/`) — regex recognizers, each
   with an optional validator that kills false positives:

   | Type | Guard |
   |---|---|
   | SSN | invalid area (000 / 666 / 900+), group, serial |
   | Credit card | **Luhn** mod-10 checksum |
   | Email | domain / TLD sanity |
   | Phone | requires separators / country code |
   | IPv4 / IPv6 | octet range, no leading zeros |
   | IBAN | ISO 7064 **mod-97** checksum |
   | Routing number | ABA 3-7-1 checksum |
   | Date of birth | only with a DOB keyword |

   Plus a user/org **dictionary** for client names and codenames.

2. **Contextual NER** (`src/ner/`) — Transformers.js + ONNX Runtime Web
   token-classification. Long inputs are split with a **sliding window +
   overlap** so entities straddling a boundary aren't sliced; overlap duplicates
   are removed in reconciliation.

3. **Reconciliation** (`src/reconcile.ts`) — merges spans and resolves overlaps
   by precedence: **dictionary > deterministic > NER** (a string that's both an
   "org name" and a valid IBAN is the IBAN), with checksum-verified types
   winning ties among deterministic detectors.

Then stable placeholders are assigned (`src/placeholders.ts`): the same value
maps to the same `[[TYPE_N]]` token throughout, and the vault is built.

### Placeholders & rehydration

Tokens use the `[[TYPE_N]]` bracket format — readable, collision-resistant, and
robust across the LLM round-trip. **Rehydration only swaps back keys present in
the vault**, so a mangled or hallucinated token is left untouched rather than
wrongly substituted.

## Policy

```ts
interface Policy {
  allow?: PIIType[];        // only redact these types
  deny?: PIIType[];         // never redact these types
  minConfidence?: number;   // NER threshold (deterministic hits are always 1.0)
  dictionary?: DictionaryTerm[];
}
```

## Eval harness

Phase 0's make-or-break asset: measure **per-entity-type precision/recall**
before building product. The numbers double as the compliance sales artifact.

```bash
npm run eval                       # built-in synthetic fixtures
npm run eval -- path/to/dataset.json
```

A JSON dataset is an array of `{ text, gold: [{ type, value }] }`. Point it at
the [ai4privacy](https://huggingface.co/datasets/ai4privacy) PII-masking sets or
your own vertical data to measure name/org/location recall.

## Scripts

| Script | What it does |
|---|---|
| `npm test` | run the vitest suite |
| `npm run typecheck` | strict TypeScript check |
| `npm run build` | emit `dist/` (ESM + `.d.ts`) |
| `npm run eval` | per-type precision/recall report |

## Security note

The **vault must never be serialized to the network.** It is a `Map` held in
memory by design. Send only `redactedText`; rehydrate only locally.

## Roadmap

This package is the Phase 0 / Phase 1 core engine. Downstream surfaces build on
it: a Manifest V3 browser extension (redact-on-send for the ChatGPT/Claude web
UI), an SDK, and an optional redacted-only gateway that logs an audit trail
without ever seeing raw PII.

## License

MIT
