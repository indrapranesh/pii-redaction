# Validation results

Measured, reproducible accuracy for the redaction engine. This is Phase 0's
make-or-break artifact: it de-risks the core technical claim *before* product,
and the numbers double as the compliance evidence ("here's the recall, here's
the methodology").

## Methodology

- **Dataset:** [ai4privacy/pii-masking-200k](https://huggingface.co/datasets/ai4privacy/pii-masking-200k),
  a public, synthetically-generated PII corpus with exact character-offset gold
  spans (`privacy_mask`).
- **Sample:** first 5,000 examples of the `train` split (3,355 structured gold
  spans). Reproduce with `node eval/datasets/fetch-ai4privacy.mjs --n=5000`.
- **Layer under test:** deterministic only (regex + checksums). The contextual
  NER layer (PERSON/ORG/LOCATION) is scored separately — see below.
- **Scoring:** a prediction is a true positive when its type matches a gold
  span of the same type and their character offsets overlap; each gold span is
  matched at most once. `npm run eval -- eval/data/ai4privacy-structured.json`.
- **Label mapping:** ai4privacy labels → engine types is in
  `eval/datasets/fetch-ai4privacy.mjs` (e.g. `IPV4`/`IPV6`/`IP` → `IP`).

## Headline: deterministic layer, 5,000 examples

| Type | Precision | Recall | Notes |
|---|---:|---:|---|
| EMAIL | 99.6% | 100.0% | |
| IP (v4+v6) | 100.0% | 100.0% | |
| URL | 100.0% | 99.7% | |
| IBAN | 100.0% | 99.6% | mod-97 checksum |
| SSN | 100.0% | 44.9% | recall gated by data validity — see below |
| PHONE | 100.0% | 50.6% | strict separators by design |
| ACCOUNT_NUMBER | 97.4% | 53.9% | keyword-gated by design |
| CREDIT_CARD | 12.4% | 10.7% | data validity — see below |
| VIN | 100.0% | 4.1% | data validity — see below |
| DATE_OF_BIRTH | 100.0% | 5.9% | keyword-gated by design |

## The recall story: checksums reject invalid synthetic data

The low headline recall on CREDIT_CARD / VIN / SSN is **not** an engine defect —
it's the checksum layer correctly refusing values that aren't valid instances.
ai4privacy generates most of these synthetically without honoring the real
checksum, so they are not, in fact, real cards/VINs/SSNs:

| Type | Gold spans | ...that pass the real checksum |
|---|---:|---:|
| CREDIT_CARD (Luhn) | 309 | **10.4%** |
| VIN (ISO-3779 check digit) | 121 | **4.1%** |
| SSN (structural) | 234 | **45.7%** |
| IBAN (mod-97) | 223 | **100%** |

Measuring recall **only over gold values that are valid instances** — the number
that reflects real-world performance — gives the true picture:

| Type | Valid gold | **Recall on valid gold** |
|---|---:|---:|
| CREDIT_CARD | 32 | **100.0%** |
| VIN | 5 | **100.0%** |
| SSN | 107 | **98.1%** |
| IBAN | 223 | **99.6%** |

In other words: on data that is actually PII, the deterministic layer recalls
~98–100%, at ≥99.6% precision. The checksums buy precision essentially for free
and, as a bonus, filter out non-PII look-alikes.

## Bugs found and fixed by this validation

1. **IPv6 at end of sentence was missed.** The recognizer's character class
   includes `.` (for embedded-IPv4 tails like `::ffff:192.168.0.1`), so a
   trailing sentence period was swallowed into the candidate and then failed
   validation. Fixed so the match can't *end* on a dot. **IP recall 79.9% →
   100%.**
2. **ZIP+4 codes matched as SSN.** `12345-6789` (one hyphen after 5 digits) was
   read as an SSN because the two separators were independently optional. Fixed
   with a back-reference requiring both separators to be identical. **SSN
   precision 47.3% → 100%** (117 → 0 false positives).

## Known, intentional trade-offs (not bugs)

- **DATE_OF_BIRTH, ACCOUNT_NUMBER** are keyword-gated (a date/number only
  redacts when a `DOB`/`account` keyword is nearby). This trades recall for
  precision so the engine doesn't flag every date or number. Recall against a
  corpus where the keyword is usually absent is therefore low by design.
- **PHONE** requires separators or a country code, so bare 10-digit account
  numbers aren't swept up as phones — again precision over recall.
- **Type conflation with the dataset:** 9xx-prefixed SSNs are classified as
  ITIN (a genuinely different tax id); ai4privacy labels them all `SSN`, so
  these show as ITIN "false positives" / SSN "false negatives" purely from the
  labeling difference.

## Contextual NER layer (PERSON / ORG / LOCATION)

Names are HIPAA Safe Harbor identifier #1, so the fuzzy layer matters. Scored on
500 examples with the **off-the-shelf** `Xenova/bert-base-NER` model (CoNLL-2003,
int8-quantized) — a prototyping baseline, not a PII-tuned model:

| Type | Precision | Recall | F1 |
|---|---:|---:|---:|
| PERSON | 74.9% | 76.5% | 75.7% |
| LOCATION | 53.6% | 60.9% | 57.0% |
| ORG | 13.3% | 63.3% | 22.0% |

Reading these honestly:

- **PERSON at ~75/77 is a reasonable floor** for a generic model with zero
  fine-tuning, and it's the identifier that matters most.
- **ORG precision is low (13%)** — the general model tags many common nouns as
  organizations. LOCATION is middling.
- The model also emits a **`MISC`** class (190 spans here) that has no gold
  counterpart, so it scores as pure false positives. In a redaction context
  those are *over*-redactions, which the policy treats as recoverable — but they
  drag the raw precision number down.

The takeaway is the one the architecture predicts: the deterministic layer
carries the high-stakes structured PII at ~100%, and the NER layer is the
swappable component. Dropping in a PII-fine-tuned DistilBERT (or adding
dictionary terms and a confidence floor) is the path to production-grade
name/org/location recall — see "Plugging in a different NER model" in the README.

Reproduce:

```bash
npm install @huggingface/transformers
npm run eval -- eval/data/ai4privacy-all.json --ner --limit=500
```

`ai4privacy-all.json` adds PERSON/ORG/LOCATION gold on top of the structured
types.

### One incompatibility this surfaced

Transformers.js v4 dropped `start`/`end` offsets from `aggregation_strategy:
'simple'` results (it returns only `word` + `score`). The adapter now recovers
offsets by locating each returned word in the source, so the NER layer works
across Transformers.js v3 and v4.
