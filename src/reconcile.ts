import type { EntitySource, PIIEntity, PIIType } from './types.js';

/**
 * Relative precedence of an entity when two detections overlap. Higher wins.
 *
 * Structured, checksum-verified PII always beats fuzzy NER: a string that is
 * both "an org name" and "a valid IBAN" is the IBAN. Dictionary terms (explicit
 * org intent) beat everything.
 */
const SOURCE_RANK: Record<EntitySource, number> = {
  dictionary: 3000,
  deterministic: 2000,
  ner: 1000,
};

/**
 * Tie-break among deterministic detectors of different types on the same span,
 * mirroring the recognizer priorities (e.g. a 9-digit run that is both a valid
 * SSN and a valid routing number resolves to SSN).
 */
const TYPE_RANK: Partial<Record<PIIType, number>> = {
  EMAIL: 90,
  ITIN: 82,
  SSN: 80,
  IBAN: 75,
  CREDIT_CARD: 70,
  IP: 60,
  PASSPORT: 58,
  DRIVERS_LICENSE: 57,
  MRN: 56,
  DATE_OF_BIRTH: 55,
  PHONE: 50,
  ROUTING_NUMBER: 40,
  ACCOUNT_NUMBER: 30,
};

function precedence(e: PIIEntity): number {
  return SOURCE_RANK[e.source] + (TYPE_RANK[e.type] ?? 0) + e.confidence;
}

function overlaps(a: PIIEntity, b: PIIEntity): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Merge candidate spans from all layers into a consistent, non-overlapping set.
 *
 * Strategy: greedily accept entities in precedence order (highest first), each
 * claiming its character span; a lower-precedence entity overlapping an
 * already-claimed span is dropped. This also de-duplicates identical spans
 * found twice (e.g. an entity surfaced in two overlapping NER windows).
 *
 * @returns accepted entities sorted by start offset.
 */
export function reconcile(candidates: PIIEntity[]): PIIEntity[] {
  const ranked = [...candidates].sort((a, b) => {
    const pd = precedence(b) - precedence(a);
    if (pd !== 0) return pd;
    // Prefer the longer span on equal precedence, then earliest position.
    const ld = b.end - b.start - (a.end - a.start);
    if (ld !== 0) return ld;
    return a.start - b.start;
  });

  const accepted: PIIEntity[] = [];
  for (const cand of ranked) {
    if (cand.end <= cand.start) continue; // skip empty/degenerate spans
    if (accepted.some((a) => overlaps(a, cand))) continue;
    accepted.push(cand);
  }

  accepted.sort((a, b) => a.start - b.start);
  return accepted;
}
