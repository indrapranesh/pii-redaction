import { describe, expect, it } from 'vitest';
import { chunkText } from '../src/ner/chunk.js';
import {
  TransformersNerProvider,
  type PipelineFactory,
} from '../src/ner/transformers.js';

describe('chunkText', () => {
  it('returns a single chunk when text fits the window', () => {
    const chunks = chunkText('short text', 100, 10);
    expect(chunks).toEqual([{ text: 'short text', offset: 0 }]);
  });

  it('produces overlapping windows that cover the whole text', () => {
    const text = 'abcdefghij'.repeat(10); // 100 chars
    const chunks = chunkText(text, 40, 10); // stride 30
    // Windows [0,40) [30,70) [60,100); the third reaches the end, so we stop.
    expect(chunks.map((c) => c.offset)).toEqual([0, 30, 60]);
    // Every chunk slices back to the original text at its offset.
    for (const c of chunks) {
      expect(text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
    }
    // Consecutive windows overlap by 10 chars.
    expect(text.slice(30, 40)).toBe(chunks[0].text.slice(30, 40));
  });

  it('rejects invalid overlap', () => {
    expect(() => chunkText('x'.repeat(50), 10, 10)).toThrow();
    expect(() => chunkText('x'.repeat(50), 10, -1)).toThrow();
  });
});

describe('TransformersNerProvider (with injected pipeline)', () => {
  // A fake pipeline that "recognizes" the name "Ada Lovelace" wherever it
  // appears in a chunk, returning char offsets relative to that chunk.
  const fakeFactory: PipelineFactory = async () => {
    return async (text: string) => {
      const results = [];
      const needle = 'Ada Lovelace';
      let idx = text.indexOf(needle);
      while (idx !== -1) {
        results.push({
          entity_group: 'PER',
          score: 0.99,
          word: needle,
          start: idx,
          end: idx + needle.length,
        });
        idx = text.indexOf(needle, idx + needle.length);
      }
      return results;
    };
  };

  it('maps model labels to PIIType and yields absolute offsets', async () => {
    const provider = new TransformersNerProvider({ pipelineFactory: fakeFactory });
    const text = 'The engineer Ada Lovelace wrote the first algorithm.';
    const entities = await provider.detect(text);
    expect(entities).toHaveLength(1);
    const e = entities[0];
    expect(e.type).toBe('PERSON');
    expect(e.source).toBe('ner');
    expect(text.slice(e.start, e.end)).toBe('Ada Lovelace');
    expect(e.confidence).toBeCloseTo(0.99);
  });

  it('handles long input across chunk boundaries with absolute offsets', async () => {
    const provider = new TransformersNerProvider({
      pipelineFactory: fakeFactory,
      windowChars: 40,
      overlapChars: 20,
    });
    const filler = 'word '.repeat(20); // 100 chars
    const text = `${filler}Ada Lovelace ${filler}`;
    const entities = await provider.detect(text);
    expect(entities.length).toBeGreaterThanOrEqual(1);
    for (const e of entities) {
      expect(text.slice(e.start, e.end)).toBe('Ada Lovelace');
    }
  });

  it('returns nothing for empty input without building a pipeline', async () => {
    let built = false;
    const provider = new TransformersNerProvider({
      pipelineFactory: async () => {
        built = true;
        return async () => [];
      },
    });
    expect(await provider.detect('')).toEqual([]);
    expect(built).toBe(false);
  });
});
