# Changelog

All notable changes to this project are documented here. The format is loosely
based on [Keep a Changelog](https://keepachangelog.com/), and the project follows
[semantic versioning](https://semver.org/).

## [0.2.0]

### Added

- **PHI (HIPAA Safe Harbor) detectors** with real checksums where they exist:
  NPI (`80840`-prefixed Luhn), DEA, VIN (ISO-3779 check digit), plus MBI, fax,
  URL, health-plan/beneficiary ID, and clinical dates. New `IDENTIFIER` catch-all
  type.
- **FHIR support** via `redactFhir()` — structure-aware redaction that recognizes
  FHIR datatypes (`HumanName`, `ContactPoint`, `Address`, `Identifier`,
  `Narrative`) by shape and works across resources and `Bundle`s, reusing the
  same vault and rehydration.
- **Real-data validation.** The eval harness can pull the public ai4privacy set
  (`eval/datasets/fetch-ai4privacy.mjs`) and score against exact offsets;
  results and methodology in `eval/RESULTS.md`. Harness gained `--limit=N`.

### Fixed

- **IPv6 at the end of a sentence** was missed because a trailing period was
  swallowed into the candidate and then failed validation. IP recall on the
  ai4privacy sample went from 79.9% to 100%.
- **ZIP+4 codes matching as SSN** (`12345-6789`). SSN/ITIN patterns now require
  both separators to be identical. SSN precision went from 47% to 100%.
- **NER offsets on Transformers.js v4.** v4 stopped returning `start`/`end` from
  `aggregation_strategy: 'simple'`; the adapter now recovers offsets by locating
  each returned word, so it works across v3 and v4.

## [0.1.0]

- Initial engine: deterministic detectors (SSN, ITIN, credit card, email, phone,
  IPv4/IPv6, IBAN, routing number, passport, license, MRN, account, DOB), the
  Transformers.js NER layer, reconciliation, stable placeholders, and the vault.
- Eval harness with synthetic fixtures.
- Browser bundle, client-side demo, Manifest V3 extension, and a redacted-only
  gateway.
