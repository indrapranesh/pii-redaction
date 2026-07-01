import { describe, expect, it } from 'vitest';
import { redact, rehydrate } from '../src/engine.js';
import type { NerProvider, PIIEntity } from '../src/types.js';

/** A stub NER provider that returns pre-programmed spans by substring search. */
function stubNer(spans: Array<{ text: string; type: PIIEntity['type']; confidence?: number }>): NerProvider {
  return {
    async detect(text: string): Promise<PIIEntity[]> {
      const out: PIIEntity[] = [];
      for (const s of spans) {
        let from = 0;
        let idx: number;
        while ((idx = text.indexOf(s.text, from)) !== -1) {
          out.push({
            type: s.type,
            start: idx,
            end: idx + s.text.length,
            text: s.text,
            source: 'ner',
            confidence: s.confidence ?? 0.95,
          });
          from = idx + s.text.length;
        }
      }
      return out;
    },
  };
}

describe('redact (deterministic only)', () => {
  it('replaces structured PII with stable placeholders', async () => {
    const text = 'Email jane@example.com or card 4111 1111 1111 1111.';
    const { redactedText, vault } = await redact(text);
    expect(redactedText).toBe('Email [[EMAIL_1]] or card [[CREDIT_CARD_1]].');
    expect(vault.get('[[EMAIL_1]]')).toBe('jane@example.com');
    expect(vault.get('[[CREDIT_CARD_1]]')).toBe('4111 1111 1111 1111');
  });

  it('gives the same real value the same placeholder everywhere', async () => {
    const text = 'a@b.com then a@b.com again';
    const { redactedText, vault } = await redact(text);
    expect(redactedText).toBe('[[EMAIL_1]] then [[EMAIL_1]] again');
    expect(vault.size).toBe(1);
  });

  it('numbers distinct values incrementally per type', async () => {
    const { redactedText } = await redact('a@b.com and c@d.com');
    expect(redactedText).toBe('[[EMAIL_1]] and [[EMAIL_2]]');
  });
});

describe('redact (with NER layer)', () => {
  it('merges NER entities and lets deterministic win overlaps', async () => {
    const text = 'Jane Doe emailed jane@example.com';
    const ner = stubNer([
      { text: 'Jane Doe', type: 'PERSON' },
      // Overlaps the email; deterministic must win.
      { text: 'jane@example.com', type: 'PERSON' },
    ]);
    const { redactedText, vault } = await redact(text, { ner });
    expect(redactedText).toBe('[[PERSON_1]] emailed [[EMAIL_1]]');
    expect(vault.get('[[PERSON_1]]')).toBe('Jane Doe');
    expect(vault.get('[[EMAIL_1]]')).toBe('jane@example.com');
  });

  it('applies the minConfidence threshold to NER only', async () => {
    const text = 'Maybe Bob';
    const ner = stubNer([{ text: 'Bob', type: 'PERSON', confidence: 0.4 }]);
    const high = await redact(text, { ner, policy: { minConfidence: 0.8 } });
    expect(high.entities).toHaveLength(0);
    const low = await redact(text, { ner, policy: { minConfidence: 0.3 } });
    expect(low.entities).toHaveLength(1);
  });
});

describe('redact (policy)', () => {
  it('allow-lists types', async () => {
    const text = 'jane@example.com 123-45-6789';
    const { entities } = await redact(text, { policy: { allow: ['EMAIL'] } });
    expect(entities.map((e) => e.type)).toEqual(['EMAIL']);
  });

  it('deny-lists types', async () => {
    const text = 'jane@example.com 123-45-6789';
    const { entities } = await redact(text, { policy: { deny: ['SSN'] } });
    expect(entities.some((e) => e.type === 'SSN')).toBe(false);
    expect(entities.some((e) => e.type === 'EMAIL')).toBe(true);
  });

  it('redacts dictionary terms', async () => {
    const text = 'Project Bluebird is internal';
    const { redactedText, vault } = await redact(text, {
      policy: { dictionary: [{ term: 'Bluebird', type: 'MISC' }] },
    });
    expect(redactedText).toBe('Project [[MISC_1]] is internal');
    expect(vault.get('[[MISC_1]]')).toBe('Bluebird');
  });
});

describe('rehydrate', () => {
  it('restores original values from the vault', async () => {
    const original = 'Contact jane@example.com about card 4111 1111 1111 1111.';
    const { vault } = await redact(original);
    // Simulate an LLM response that references the placeholders.
    const modelResponse = `I will email [[EMAIL_1]] regarding [[CREDIT_CARD_1]].`;
    expect(rehydrate(modelResponse, vault)).toBe(
      'I will email jane@example.com regarding 4111 1111 1111 1111.',
    );
  });

  it('leaves unknown/hallucinated placeholders untouched', () => {
    const vault = new Map([['[[EMAIL_1]]', 'jane@example.com']]);
    const resp = 'Emailed [[EMAIL_1]] and [[PERSON_9]] (unknown).';
    expect(rehydrate(resp, vault)).toBe(
      'Emailed jane@example.com and [[PERSON_9]] (unknown).',
    );
  });

  it('round-trips: redact then rehydrate recovers the redacted originals', async () => {
    const text = 'SSN 123-45-6789, IP 192.168.0.1, email x@y.com.';
    const { redactedText, vault } = await redact(text);
    expect(redactedText).not.toContain('123-45-6789');
    expect(rehydrate(redactedText, vault)).toBe(text);
  });

  it('is a no-op with an empty vault', () => {
    expect(rehydrate('nothing here', new Map())).toBe('nothing here');
  });
});
