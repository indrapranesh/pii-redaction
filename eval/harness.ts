/**
 * Eval harness — Phase 0's make-or-break asset.
 *
 * Runs the redaction engine against labeled examples and reports per-entity-type
 * precision / recall / F1 plus overall. Build this first: it de-risks the core
 * technical question before any product UI, and the numbers double as the
 * compliance sales artifact ("99.9% recall on structured PII; here's the
 * methodology").
 *
 * Run: `npm run eval`  (optionally `npm run eval -- path/to/dataset.json`)
 *
 * A predicted entity counts as a true positive when it shares the same type as
 * a gold entity and their character spans overlap. Each gold entity is matched
 * at most once.
 */
import { readFileSync } from 'node:fs';
import { redact } from '../src/engine.js';
import { createTransformersNer } from '../src/ner/transformers.js';
import type { NerProvider, PIIEntity, PIIType } from '../src/types.js';
import { FIXTURES, type EvalExample } from './fixtures.js';

interface GoldSpan {
  type: PIIType;
  start: number;
  end: number;
}

interface Counts {
  tp: number;
  fp: number;
  fn: number;
}

function locateGold(example: EvalExample): GoldSpan[] {
  return example.gold.map((g) => {
    const start = example.text.indexOf(g.value);
    if (start < 0) {
      throw new Error(
        `Gold value ${JSON.stringify(g.value)} not found in example text`,
      );
    }
    return { type: g.type, start, end: start + g.value.length };
  });
}

function overlaps(a: { start: number; end: number }, b: GoldSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

function bump(map: Map<PIIType, Counts>, type: PIIType, key: keyof Counts): void {
  const c = map.get(type) ?? { tp: 0, fp: 0, fn: 0 };
  c[key] += 1;
  map.set(type, c);
}

async function scoreExample(
  example: EvalExample,
  counts: Map<PIIType, Counts>,
  ner?: NerProvider,
): Promise<void> {
  const gold = locateGold(example);
  const { entities } = await redact(example.text, ner ? { ner } : {});
  const goldMatched = new Array<boolean>(gold.length).fill(false);

  for (const pred of entities as PIIEntity[]) {
    const gi = gold.findIndex(
      (g, i) => !goldMatched[i] && g.type === pred.type && overlaps(pred, g),
    );
    if (gi >= 0) {
      goldMatched[gi] = true;
      bump(counts, pred.type, 'tp');
    } else {
      bump(counts, pred.type, 'fp');
    }
  }
  gold.forEach((g, i) => {
    if (!goldMatched[i]) bump(counts, g.type, 'fn');
  });
}

function prf({ tp, fp, fn }: Counts): {
  precision: number;
  recall: number;
  f1: number;
} {
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 =
    precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`.padStart(7);
}

function report(counts: Map<PIIType, Counts>): void {
  const total: Counts = { tp: 0, fp: 0, fn: 0 };
  const rows = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  console.log('\nPer-entity-type metrics');
  console.log('type              precision   recall       f1   tp  fp  fn');
  console.log('-------------------------------------------------------------');
  for (const [type, c] of rows) {
    const { precision, recall, f1 } = prf(c);
    total.tp += c.tp;
    total.fp += c.fp;
    total.fn += c.fn;
    console.log(
      `${type.padEnd(16)} ${pct(precision)} ${pct(recall)} ${pct(f1)}  ${String(
        c.tp,
      ).padStart(3)} ${String(c.fp).padStart(3)} ${String(c.fn).padStart(3)}`,
    );
  }
  const { precision, recall, f1 } = prf(total);
  console.log('-------------------------------------------------------------');
  console.log(
    `${'OVERALL (micro)'.padEnd(16)} ${pct(precision)} ${pct(recall)} ${pct(
      f1,
    )}  ${String(total.tp).padStart(3)} ${String(total.fp).padStart(3)} ${String(
      total.fn,
    ).padStart(3)}`,
  );
  console.log('');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // Optional `--ner` or `--ner=<model-id>` to also score PERSON/ORG/LOCATION
  // with a real Transformers.js model (downloads weights on first run).
  const nerArg = args.find((a) => a === '--ner' || a.startsWith('--ner='));
  const datasetPath = args.find((a) => !a.startsWith('--'));

  const examples: EvalExample[] = datasetPath
    ? (JSON.parse(readFileSync(datasetPath, 'utf8')) as EvalExample[])
    : FIXTURES;

  let ner: NerProvider | undefined;
  if (nerArg) {
    const model = nerArg.includes('=') ? nerArg.split('=')[1] : undefined;
    ner = createTransformersNer(model ? { model } : {});
    console.log(`NER layer enabled${model ? ` (model: ${model})` : ''}.`);
  }

  console.log(
    `Evaluating on ${examples.length} example(s)${
      datasetPath ? ` from ${datasetPath}` : ' (built-in fixtures)'
    }.`,
  );

  const counts = new Map<PIIType, Counts>();
  for (const example of examples) {
    await scoreExample(example, counts, ner);
  }
  report(counts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
