import { describe, expect, it } from 'vitest';
import { reconcile } from '../src/reconcile.js';
import type { PIIEntity } from '../src/types.js';

function ent(p: Partial<PIIEntity> & Pick<PIIEntity, 'start' | 'end'>): PIIEntity {
  return {
    type: 'PERSON',
    text: 'x',
    source: 'ner',
    confidence: 0.9,
    ...p,
  };
}

describe('reconcile', () => {
  it('keeps non-overlapping entities, sorted by start', () => {
    const out = reconcile([
      ent({ start: 10, end: 14 }),
      ent({ start: 0, end: 4 }),
    ]);
    expect(out.map((e) => e.start)).toEqual([0, 10]);
  });

  it('lets deterministic win over overlapping NER', () => {
    const out = reconcile([
      ent({ start: 0, end: 22, type: 'ORG', source: 'ner' }),
      ent({ start: 0, end: 22, type: 'IBAN', source: 'deterministic', confidence: 1 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('IBAN');
  });

  it('lets dictionary win over overlapping deterministic', () => {
    const out = reconcile([
      ent({ start: 0, end: 8, type: 'ORG', source: 'dictionary', confidence: 1 }),
      ent({ start: 0, end: 8, type: 'PHONE', source: 'deterministic', confidence: 1 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('dictionary');
  });

  it('resolves same-source type ties by TYPE_RANK (SSN over routing)', () => {
    const out = reconcile([
      ent({ start: 0, end: 9, type: 'ROUTING_NUMBER', source: 'deterministic', confidence: 1 }),
      ent({ start: 0, end: 9, type: 'SSN', source: 'deterministic', confidence: 1 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('SSN');
  });

  it('de-duplicates identical spans found in overlapping NER windows', () => {
    const out = reconcile([
      ent({ start: 5, end: 12, text: 'Jane Doe' }),
      ent({ start: 5, end: 12, text: 'Jane Doe' }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('prefers the longer span on equal precedence', () => {
    const out = reconcile([
      ent({ start: 0, end: 4, confidence: 0.9 }),
      ent({ start: 0, end: 8, confidence: 0.9 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].end).toBe(8);
  });

  it('drops degenerate empty spans', () => {
    const out = reconcile([ent({ start: 5, end: 5 })]);
    expect(out).toHaveLength(0);
  });
});
