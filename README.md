# @pii-redaction/core

A PII and PHI redaction engine that runs where your text is, not on someone
else's server. You hand it a string, it finds the sensitive spans, replaces them
with stable placeholders, and hands back the redacted text plus a mapping from
placeholder to original value. That mapping — the *vault* — stays in memory on
the client. You send only the redacted text to a cloud LLM, and when the reply
comes back you swap the real values in locally.

```
Your text  →  redact()  →  "[[PERSON_1]] can't access [[ACCOUNT_1]]"
                                  │  only the redacted text leaves the machine
                                  ▼
                            Cloud LLM (GPT / Claude / ...)
                                  │  reply still refers to [[PERSON_1]]
                                  ▼
Your text  ←  rehydrate()  ←  placeholders swapped back to real values
```

Nothing else in the pipeline ever sees the raw values. That's the whole point:
the compliance boundary is a function call, not a network hop.

The engine has no runtime dependencies. The optional NER layer (for names and
other fuzzy entities) is the only thing that pulls in a model runtime, and it's
lazy-loaded, so if you never call it you never pay for it.

## The idea behind the design

Most of the PII that actually gets people fined is *structured*. Social security
numbers, credit cards, IBANs, routing numbers, national provider identifiers —
these have formats, and most of them have checksums. You don't need a model to
find them, and you shouldn't use one: a regex plus a checksum catches them at
close to 100% recall, deterministically, and rejects look-alikes for free. A
number that passes the Luhn check is a card; one that doesn't isn't, and no
amount of model confidence changes that.

So the engine is built in two tiers. The bottom tier is deterministic and
handles everything with a structure to it. The top tier is a named-entity model
that handles the genuinely fuzzy things — people, organizations, places — where
there's no format to match on. The reliability is highest exactly where the
stakes are highest, and the expensive, less-predictable component only runs on
the part of the problem that actually needs it.

This split is the same one [Microsoft Presidio](https://github.com/microsoft/presidio)
makes on the server. The difference here is that the whole thing is small enough
and dependency-free enough to run in a browser tab, so the raw data never has to
leave the client to be redacted.

One more deliberate choice: this is a round-trip, not a scrubber. Because every
occurrence of a value maps to the *same* placeholder, the model can still reason
about "the same person" across a document. When the answer comes back you undo
the substitution and the user never sees the placeholders at all.

## Install

```bash
npm install @pii-redaction/core

# only if you want the contextual NER layer:
npm install @huggingface/transformers
```

## Quick start

Deterministic only — no dependencies, runs in microseconds:

```ts
import { redact, rehydrate } from '@pii-redaction/core';

const { redactedText, vault } = await redact(
  'Email jane@example.com about card 4111 1111 1111 1111.',
);
// redactedText → "Email [[EMAIL_1]] about card [[CREDIT_CARD_1]]."

// send redactedText to your LLM, get `response` back, then:
const answer = rehydrate(response, vault); // real values restored, locally
```

With the NER layer for names, organizations, and locations:

```ts
import { redact } from '@pii-redaction/core';
import { createTransformersNer } from '@pii-redaction/core/ner/transformers';

const ner = createTransformersNer({
  model: 'Xenova/bert-base-NER', // a fine-tuned model does much better — see below
  quantized: true,               // ~30–65 MB int8 weights
  // device: 'webgpu',           // auto-detected, falls back to WASM
});

const { redactedText, vault } = await redact(text, {
  ner,
  policy: {
    minConfidence: 0.5,          // below this, drop the NER hit
    dictionary: [                // things the model won't know are sensitive
      { term: 'Project Bluebird', type: 'MISC' },
      { term: 'Acme Corp', type: 'ORG' },
    ],
  },
});
```

## How it works

`redact()` runs three stages and then assigns placeholders.

**1. Deterministic detectors** (`src/deterministic/`). Each detector is a regex
that finds candidates plus an optional validator that throws out the false
positives. The validators are where the precision comes from:

| Type | What guards it |
|---|---|
| SSN / ITIN | area/group/serial rules; separators must be consistent (so ZIP+4 isn't an SSN) |
| Credit card | Luhn (mod-10) checksum |
| IBAN | ISO 7064 mod-97 checksum |
| Routing number | ABA 3-7-1 weighted checksum |
| NPI | 10-digit Luhn over the `80840`-prefixed value |
| DEA | registrant-type letter + the DEA check digit |
| MBI (Medicare) | 11-position format rules over the non-ambiguous alphabet |
| VIN | ISO-3779 mod-11 check digit |
| Email / URL | domain and TLD sanity |
| Phone / Fax | require separators or a country code |
| IPv4 / IPv6 | octet ranges, `::` compression, embedded-IPv4 tails |
| Passport / license / MRN / account / health-plan ID | keyword-gated near a matching label |
| Date of birth / clinical date | only next to a DOB or admission/discharge keyword |

On top of the built-ins there's a user dictionary for the things no detector or
model could know about — client names, internal codenames, project IDs.

**2. Contextual NER** (`src/ner/`). A token-classification model (via
Transformers.js and ONNX Runtime) tags people, organizations, and locations.
Long inputs are cut into overlapping windows so an entity sitting on a chunk
boundary doesn't get sliced in half; the duplicate hits from the overlap are
dropped during reconciliation. The model runs behind the `NerProvider`
interface, so the core never imports it directly — you inject a provider, or a
stub in tests.

**3. Reconciliation** (`src/reconcile.ts`). The two tiers produce overlapping
spans, and reconciliation resolves them by precedence: dictionary beats
deterministic beats NER. A string that is both "an org name" and a valid IBAN is
the IBAN. Among deterministic detectors, the checksum-verified type wins.

After that, `src/placeholders.ts` walks the surviving spans and assigns tokens.
The same value always gets the same `[[TYPE_N]]`, numbered per type in the order
they appear, and the vault (placeholder → value) is built alongside.

### Placeholders and rehydration

Placeholders look like `[[PERSON_1]]`. The double brackets are chosen because
they read cleanly, almost never collide with real text, and survive tokenization
through an LLM round-trip better than more exotic delimiters. Rehydration only
swaps back keys that are actually in the vault, so if the model mangles a token
or invents one, it's left alone rather than turned into the wrong value.

## Plugging in a different NER model

`createTransformersNer` defaults to `Xenova/bert-base-NER`, which is a
general-purpose CoNLL-2003 model. It's fine for a demo and it's what the
validation numbers below were measured against, but it isn't tuned for PII — it
over-tags organizations and emits a `MISC` class you probably don't want. For
anything real you'll want to swap it.

Any Hugging Face token-classification model with an ONNX export works. Point the
adapter at it:

```ts
const ner = createTransformersNer({
  model: 'your-org/distilbert-pii-ner-onnx', // a PII-fine-tuned encoder
  quantized: true,
  device: 'webgpu',
});
```

The adapter maps common label schemes (`PER`/`PERSON`, `ORG`, `LOC`/`GPE`/
`LOCATION`, `MISC`, with or without `B-`/`I-` prefixes) onto the engine's types.
If your model uses a different label set, that mapping lives in one small
function (`mapLabel` in `src/ner/transformers.ts`).

If you don't want Transformers.js at all — say you already run NER on a server,
or you want spaCy, or a hosted API — implement the interface directly. It's one
method:

```ts
import type { NerProvider, PIIEntity } from '@pii-redaction/core';

const myNer: NerProvider = {
  async detect(text): Promise<PIIEntity[]> {
    // call whatever you like, return spans with char offsets:
    return [
      { type: 'PERSON', start: 0, end: 9, text: text.slice(0, 9),
        source: 'ner', confidence: 0.98 },
    ];
  },
};

await redact(text, { ner: myNer });
```

Because the core only knows about the interface, the model is genuinely
swappable — including for a fake in unit tests, which is how the engine is tested
without ever downloading weights.

## Healthcare: PHI and FHIR

The deterministic detectors cover most of the HIPAA Safe Harbor identifiers that
have a structure — NPI, DEA, MBI, VIN, fax, URL, health-plan/beneficiary IDs,
and clinical dates — on top of the SSN, MRN, email, phone, and address pieces
that were already there. Names, which are Safe Harbor identifier #1, come from
the NER layer.

Clinical data usually doesn't arrive as free text, though. It arrives as FHIR,
HL7 v2, or C-CDA, where the PHI sits in known fields. There's a redactor for each,
and they all reuse the same vault and placeholders as `redact()`, so
`rehydrate()` reconstructs the original document exactly.

```ts
import { redactFhir, redactHl7, redactCcda, rehydrate } from '@pii-redaction/core';

const { redactedText, vault } = await redactFhir(patientResource, { ner });
// same shape for redactHl7(message, { ner }) and redactCcda(xml, { ner })
// send redactedText to the LLM, then rehydrate(reply, vault) as usual
```

**FHIR** recognizes the shared datatypes — `HumanName`, `ContactPoint`,
`Address`, `Identifier`, `Narrative` — by shape rather than matching field paths
per resource, so it handles a `Patient`, a `Practitioner`, or a whole `Bundle`
the same way. An `Identifier` is typed by its `type` coding, or by the value
itself if it's a recognizable ID like an SSN or NPI; narrative blocks get the
full detector sweep.

**HL7 v2** reads the delimiters from `MSH-1`/`MSH-2` rather than assuming them,
then redacts the known PHI fields — patient name, DOB, address, phone, account,
SSN, license, and identifiers in `PID`, plus `NK1`, `GT1`, `IN1`/`IN2` — sweeps
`NTE` notes and `OBX` values, and reassembles with the original separators.

**C-CDA** redacts person-name elements anywhere in the document, scopes address,
telephone, id, and birth-time redaction to the `recordTarget` block (so
facility and author addresses are left alone), and sweeps the section `<text>`
narratives.

In all three, state and country are left in the clear, since Safe Harbor allows
geography down to the state level. The format layer lives behind one seam
(`src/formats/`), so adding another standard means writing one walker, not
touching the engine.

## Policy

```ts
interface Policy {
  allow?: PIIType[];        // if set, redact only these types
  deny?: PIIType[];         // never redact these, even when detected
  minConfidence?: number;   // NER threshold; deterministic hits are always 1.0
  dictionary?: DictionaryTerm[];
}
```

The bias throughout is toward recall. Over-redaction is an annoyance you can undo
with the vault; under-redaction is a leak you can't take back. So when the engine
is unsure, it redacts.

## Validation

There's a real eval harness, because "it has good regexes" isn't a claim you get
to make without numbers. It reports per-type precision, recall, and F1.

```bash
npm run eval                                            # built-in fixtures
node eval/datasets/fetch-ai4privacy.mjs --n=5000        # pull real public data
npm run eval -- eval/data/ai4privacy-structured.json    # deterministic layer
npm run eval -- eval/data/ai4privacy-all.json --ner     # add names/orgs/locations
```

Measured on 5,000 examples from the public
[ai4privacy](https://huggingface.co/datasets/ai4privacy/pii-masking-200k) set:
on values that are actually valid instances, recall is 100% on credit cards,
100% on VINs, 98.1% on SSNs, and 99.6% on IBANs, at 99.6%+ precision; email, IP,
and URL land near 100% on both. Where the headline recall looks low, it's because
the corpus generates most of its "cards" and "VINs" without valid checksums — the
engine is correctly refusing to call an invalid number a credit card. Running the
eval is also what caught two real bugs (an IPv6 at the end of a sentence, and
ZIP+4 codes matching as SSNs), both now fixed. The full write-up, including the
NER numbers and the methodology, is in [`eval/RESULTS.md`](eval/RESULTS.md).

## Repository layout

The repo is the engine plus a few things built on top of it.

| Path | What it is |
|---|---|
| `src/` | the engine (this package) |
| `src/deterministic/` | regex detectors and their checksum validators |
| `src/ner/` | the Transformers.js NER adapter and chunking |
| `src/formats/` | structure-aware redaction (FHIR, HL7 v2, C-CDA) |
| `eval/` | the precision/recall harness and dataset tooling |
| `demo/` | a single-page, client-side round-trip playground (`demo/README.md`) |
| `extension/` | a Manifest V3 browser extension for ChatGPT/Claude (`extension/README.md`) |
| `gateway/` | a redacted-only proxy with an audit trail (`gateway/README.md`) |
| `e2e/` | headless-Chromium checks for the demo and extension |

## Scripts

| Script | What it does |
|---|---|
| `npm test` | run the vitest suite |
| `npm run typecheck` | strict TypeScript check |
| `npm run build` | emit `dist/` (ESM + `.d.ts`) |
| `npm run build:browser` | bundle the engine for the demo and extension |
| `npm run test:e2e` | build bundles and run the demo + extension checks |
| `npm run eval` | per-type precision/recall report (`-- --ner` to score names) |

## One rule about the vault

The vault must never be serialized to the network. It's a `Map` held in memory
on purpose. Send only `redactedText`; rehydrate only on the client. If a vault
ends up in a log, a request body, or local storage that syncs, the whole design
is defeated.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for
how to get set up and what the bar is (tests pass, types check, new detectors
come with fixtures). Please read the [Code of Conduct](CODE_OF_CONDUCT.md), and
if you think you've found a security issue, follow [SECURITY.md](SECURITY.md)
rather than opening a public issue.

## Status and roadmap

- **Engine** — deterministic detectors, NER layer, reconciliation, and the
  format layer (FHIR, HL7 v2, C-CDA) are in place and tested; validated on real
  ai4privacy data.
- **Surfaces** — the browser extension, demo playground, and redacted-only
  gateway all work end-to-end.
- **Next** — a PII-tuned NER model to replace the generic default, in-extension
  NER, and more format coverage (NCPDP, X12) as it's needed.

## License

[MIT](LICENSE)
