import { describe, expect, it } from 'vitest';
import {
  detectDeterministic,
  runDictionary,
  runRecognizers,
} from '../src/deterministic/index.js';
import type { PIIType } from '../src/types.js';

/** Helper: collect (type, text) pairs for concise assertions. */
function pairs(text: string): Array<[PIIType, string]> {
  return runRecognizers(text).map((e) => [e.type, e.text]);
}

describe('runRecognizers', () => {
  it('detects an email', () => {
    expect(pairs('reach me at Jane.Doe@example.com please')).toContainEqual([
      'EMAIL',
      'Jane.Doe@example.com',
    ]);
  });

  it('detects a valid SSN but not an invalid one', () => {
    expect(pairs('ssn 123-45-6789')).toContainEqual(['SSN', '123-45-6789']);
    expect(pairs('ssn 000-45-6789').some(([t]) => t === 'SSN')).toBe(false);
  });

  it('detects a Luhn-valid credit card, ignores a Luhn-invalid one', () => {
    expect(pairs('card 4111 1111 1111 1111')).toContainEqual([
      'CREDIT_CARD',
      '4111 1111 1111 1111',
    ]);
    expect(
      pairs('card 4111 1111 1111 1112').some(([t]) => t === 'CREDIT_CARD'),
    ).toBe(false);
  });

  it('detects an IPv4 address but rejects an out-of-range one', () => {
    expect(pairs('host 192.168.1.10')).toContainEqual(['IP', '192.168.1.10']);
    expect(pairs('host 999.1.1.1').some(([t]) => t === 'IP')).toBe(false);
  });

  it('detects phone numbers with separators', () => {
    const found = pairs('call (415) 555-0132 or 212.555.0148');
    expect(found).toContainEqual(['PHONE', '(415) 555-0132']);
    expect(found).toContainEqual(['PHONE', '212.555.0148']);
  });

  it('detects a date of birth only with a DOB keyword', () => {
    expect(pairs('DOB: 05/14/1990')).toContainEqual([
      'DATE_OF_BIRTH',
      '05/14/1990',
    ]);
    expect(
      pairs('the meeting is on 05/14/1990').some(
        ([t]) => t === 'DATE_OF_BIRTH',
      ),
    ).toBe(false);
  });

  it('detects a valid IBAN', () => {
    expect(pairs('wire to GB82WEST12345698765432 today')).toContainEqual([
      'IBAN',
      'GB82WEST12345698765432',
    ]);
  });

  it('records offsets that slice back to the original text', () => {
    const text = 'email jane@example.com now';
    const e = runRecognizers(text).find((x) => x.type === 'EMAIL')!;
    expect(text.slice(e.start, e.end)).toBe('jane@example.com');
    expect(e.source).toBe('deterministic');
    expect(e.confidence).toBe(1);
  });
});

describe('runDictionary', () => {
  it('matches whole-word terms case-insensitively by default', () => {
    const hits = runDictionary('Project Bluebird ships Q3', [
      { term: 'Bluebird', type: 'MISC' },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ type: 'MISC', text: 'Bluebird', source: 'dictionary' });
  });

  it('respects case sensitivity when requested', () => {
    const hits = runDictionary('bluebird and Bluebird', [
      { term: 'Bluebird', type: 'MISC', caseSensitive: true },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe('Bluebird');
  });

  it('does not match substrings inside larger words', () => {
    const hits = runDictionary('Bluebirds are birds', [
      { term: 'Bluebird', type: 'MISC' },
    ]);
    expect(hits).toHaveLength(0);
  });
});

describe('detectDeterministic', () => {
  it('combines recognizers and dictionary terms', () => {
    const found = detectDeterministic('Acme Corp email a@acme.com', [
      { term: 'Acme Corp', type: 'ORG' },
    ]);
    expect(found.some((e) => e.type === 'ORG' && e.text === 'Acme Corp')).toBe(
      true,
    );
    expect(found.some((e) => e.type === 'EMAIL')).toBe(true);
  });
});
