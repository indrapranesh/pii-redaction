/**
 * Download a slice of the ai4privacy PII-masking dataset and convert it into the
 * eval harness format. Reproducible: run this, then point `npm run eval` at the
 * emitted JSON.
 *
 *   node eval/datasets/fetch-ai4privacy.mjs --n=5000
 *
 * Writes two files under eval/data/:
 *   ai4privacy-structured.json  — only the deterministic-target types (the core
 *                                 thesis: structured PII at high recall).
 *   ai4privacy-all.json         — the above plus PERSON/ORG/LOCATION, for the
 *                                 NER pass (`npm run eval -- <file> --ner`).
 *
 * Source: https://huggingface.co/datasets/ai4privacy/pii-masking-200k
 * The dataset's `privacy_mask` already carries exact char offsets, so gold spans
 * are used verbatim — no fuzzy value-locating.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'data');

/** ai4privacy label -> our PIIType. Unlisted labels are dropped from gold. */
const LABEL_MAP = {
  // structured (deterministic layer)
  EMAIL: 'EMAIL',
  URL: 'URL',
  CREDITCARDNUMBER: 'CREDIT_CARD',
  IP: 'IP',
  IPV4: 'IP',
  IPV6: 'IP',
  PHONENUMBER: 'PHONE',
  SSN: 'SSN',
  IBAN: 'IBAN',
  VEHICLEVIN: 'VIN',
  DOB: 'DATE_OF_BIRTH',
  ACCOUNTNUMBER: 'ACCOUNT_NUMBER',
  // contextual (NER layer)
  FIRSTNAME: 'PERSON',
  LASTNAME: 'PERSON',
  MIDDLENAME: 'PERSON',
  COMPANYNAME: 'ORG',
  CITY: 'LOCATION',
  STREET: 'LOCATION',
  COUNTY: 'LOCATION',
  ZIPCODE: 'LOCATION',
  SECONDARYADDRESS: 'LOCATION',
};

const STRUCTURED = new Set([
  'EMAIL', 'URL', 'CREDIT_CARD', 'IP', 'PHONE', 'SSN', 'IBAN', 'VIN',
  'DATE_OF_BIRTH', 'ACCOUNT_NUMBER',
]);

const args = process.argv.slice(2);
const n = Number((args.find((a) => a.startsWith('--n=')) ?? '--n=5000').slice(4));
const split = (args.find((a) => a.startsWith('--split=')) ?? '--split=train').slice(8);
const DATASET = 'ai4privacy/pii-masking-200k';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRows(offset, length, attempt = 0) {
  const url =
    `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(DATASET)}` +
    `&config=default&split=${split}&offset=${offset}&length=${length}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HF API ${res.status}`);
    return (await res.json()).rows.map((r) => r.row);
  } catch (err) {
    if (attempt >= 8) throw new Error(`${err.message} at offset ${offset}`);
    // exponential backoff (capped) on transient 429/502 errors
    await sleep(Math.min(30000, 1500 * 2 ** attempt));
    return fetchRows(offset, length, attempt + 1);
  }
}

function convert(row, keep) {
  const text = row.source_text;
  const gold = [];
  for (const m of row.privacy_mask ?? []) {
    const type = LABEL_MAP[m.label];
    if (!type || !keep.has(type)) continue;
    gold.push({ type, value: m.value, start: m.start, end: m.end });
  }
  return { text, gold };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Fetching ${n} rows from ${DATASET} [${split}]...`);
  const rows = [];
  for (let off = 0; off < n; off += 100) {
    const batch = await fetchRows(off, Math.min(100, n - off));
    rows.push(...batch);
    process.stdout.write(`\r  ${rows.length} rows`);
    await sleep(400); // be polite to the shared HF API to avoid rate limits
  }
  process.stdout.write(`\r  ${rows.length} rows\n`);

  const all = rows.map((r) => convert(r, new Set(Object.values(LABEL_MAP))));
  const structured = rows.map((r) => convert(r, STRUCTURED));

  const allPath = join(OUT_DIR, 'ai4privacy-all.json');
  const structPath = join(OUT_DIR, 'ai4privacy-structured.json');
  writeFileSync(allPath, JSON.stringify(all));
  writeFileSync(structPath, JSON.stringify(structured));

  const goldCount = (set) =>
    set.reduce((acc, e) => acc + e.gold.length, 0);
  console.log(`Wrote ${structPath} (${structured.length} ex, ${goldCount(structured)} gold spans)`);
  console.log(`Wrote ${allPath} (${all.length} ex, ${goldCount(all)} gold spans)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
