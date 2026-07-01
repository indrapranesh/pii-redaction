import type { PIIEntity, PIIType } from '../types.js';
import {
  isLuhnValid,
  isPlausibleEmailDomain,
  isValidIBAN,
  isValidIPv4,
  isValidRoutingNumber,
  isValidSSN,
} from './validators.js';

/**
 * A deterministic recognizer: a regex to find candidates plus an optional
 * validator to reject false positives. `priority` breaks ties when two
 * deterministic recognizers claim the same span (higher wins) — e.g. a string
 * that is both a bare account number and a valid IBAN resolves to the IBAN.
 */
export interface Recognizer {
  type: PIIType;
  pattern: RegExp;
  /** Return true to keep the candidate. Receives the raw matched substring. */
  validate?: (match: string) => boolean;
  /** Higher priority wins overlap ties among deterministic recognizers. */
  priority: number;
}

/**
 * The recognizer set. Ordering does not matter for correctness (overlaps are
 * resolved by priority + validators in reconciliation), only the patterns and
 * guards do. Patterns use word boundaries to avoid slicing through longer runs.
 */
export const RECOGNIZERS: Recognizer[] = [
  {
    // Email — matched before phone/account so its digits aren't misread.
    type: 'EMAIL',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}\b/gi,
    validate: isPlausibleEmailDomain,
    priority: 90,
  },
  {
    // SSN — hyphenated, spaced, or 9 bare digits.
    type: 'SSN',
    pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    validate: isValidSSN,
    priority: 80,
  },
  {
    // Credit card — 13-19 digits, optionally grouped by spaces/hyphens.
    type: 'CREDIT_CARD',
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    validate: isLuhnValid,
    priority: 70,
  },
  {
    // IBAN — 2 letters, 2 check digits, then 10-30 alphanumerics.
    type: 'IBAN',
    pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{1,4}){2,8}\b/g,
    validate: isValidIBAN,
    priority: 75,
  },
  {
    // IPv4 dotted quad.
    type: 'IP',
    pattern: /\b\d{1,3}(?:\.\d{1,3}){3}\b/g,
    validate: isValidIPv4,
    priority: 60,
  },
  {
    // IPv6 — 8 hextets (does not attempt to cover every :: compression form).
    type: 'IP',
    pattern: /\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b/gi,
    priority: 60,
  },
  {
    // NANP + international phone numbers. Requires a separator or +country code
    // to avoid swallowing bare 10-digit account numbers.
    type: 'PHONE',
    pattern:
      /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/g,
    priority: 50,
  },
  {
    // ABA routing number, guarded by its checksum.
    type: 'ROUTING_NUMBER',
    pattern: /\b\d{9}\b/g,
    validate: isValidRoutingNumber,
    priority: 40,
  },
  {
    // Date of birth — only when a DOB keyword precedes the date. The lookbehind
    // keeps the match on the date itself (keyword stays in the clear).
    type: 'DATE_OF_BIRTH',
    pattern:
      /(?<=\b(?:dob|d\.o\.b\.|date of birth|born(?: on)?)\b[:\s]{0,3})\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/gi,
    priority: 55,
  },
];

/** Run every recognizer over `text`, returning validated candidate spans. */
export function runRecognizers(text: string): PIIEntity[] {
  const out: PIIEntity[] = [];
  for (const rec of RECOGNIZERS) {
    // Fresh lastIndex per pass; patterns are global.
    rec.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rec.pattern.exec(text)) !== null) {
      const matched = m[0];
      // Guard against zero-width matches causing an infinite loop.
      if (matched.length === 0) {
        rec.pattern.lastIndex++;
        continue;
      }
      if (rec.validate && !rec.validate(matched)) continue;
      out.push({
        type: rec.type,
        start: m.index,
        end: m.index + matched.length,
        text: matched,
        source: 'deterministic',
        confidence: 1,
      });
    }
  }
  return out;
}
