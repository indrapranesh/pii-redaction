import type { DictionaryTerm, PIIEntity } from '../types.js';
import { runRecognizers } from './recognizers.js';

export { runRecognizers, RECOGNIZERS } from './recognizers.js';
export type { Recognizer } from './recognizers.js';
export * from './validators.js';

/** Escape a string for safe insertion into a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Match user/org dictionary terms (client names, project codenames, internal
 * identifiers) as whole words. These close NER recall gaps cheaply and are
 * treated as the highest-precedence deterministic hits.
 */
export function runDictionary(
  text: string,
  terms: DictionaryTerm[],
): PIIEntity[] {
  const out: PIIEntity[] = [];
  for (const t of terms) {
    if (!t.term) continue;
    const flags = t.caseSensitive ? 'g' : 'gi';
    // \b works for alphanumeric terms; for terms starting/ending with
    // punctuation we fall back to a plain global match.
    const boundaried = /^[A-Za-z0-9].*[A-Za-z0-9]$|^[A-Za-z0-9]$/.test(t.term);
    const body = escapeRegExp(t.term);
    const pattern = new RegExp(boundaried ? `\\b${body}\\b` : body, flags);
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      if (m[0].length === 0) {
        pattern.lastIndex++;
        continue;
      }
      out.push({
        type: t.type,
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        source: 'dictionary',
        confidence: 1,
      });
    }
  }
  return out;
}

/**
 * Full deterministic pass: built-in recognizers plus any dictionary terms.
 */
export function detectDeterministic(
  text: string,
  dictionary: DictionaryTerm[] = [],
): PIIEntity[] {
  const entities = runRecognizers(text);
  if (dictionary.length > 0) entities.push(...runDictionary(text, dictionary));
  return entities;
}
