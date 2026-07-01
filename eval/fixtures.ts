import type { PIIType } from '../src/types.js';

/**
 * A labeled eval example. Gold entities are given as (type, value) pairs; the
 * harness locates their character offsets by first occurrence in `text`.
 *
 * These are synthetic and structured-PII-focused, matching what the
 * deterministic layer targets. Swap/extend with the ai4privacy PII-masking sets
 * (or your own vertical data) for a fuller name/org/location picture.
 */
export interface EvalExample {
  text: string;
  gold: Array<{ type: PIIType; value: string }>;
}

export const FIXTURES: EvalExample[] = [
  {
    text: 'Please reset the account for jane.doe@example.com, SSN 123-45-6789.',
    gold: [
      { type: 'EMAIL', value: 'jane.doe@example.com' },
      { type: 'SSN', value: '123-45-6789' },
    ],
  },
  {
    text: 'Charge card 4111 1111 1111 1111 and call me at (415) 555-0132.',
    gold: [
      { type: 'CREDIT_CARD', value: '4111 1111 1111 1111' },
      { type: 'PHONE', value: '(415) 555-0132' },
    ],
  },
  {
    text: 'The server at 192.168.10.5 was accessed; backup routing 021000021.',
    gold: [
      { type: 'IP', value: '192.168.10.5' },
      { type: 'ROUTING_NUMBER', value: '021000021' },
    ],
  },
  {
    text: 'Wire the retainer to GB82WEST12345698765432 before Friday.',
    gold: [{ type: 'IBAN', value: 'GB82WEST12345698765432' }],
  },
  {
    text: 'Patient DOB: 05/14/1990, contact carlos@clinic.org.',
    gold: [
      { type: 'DATE_OF_BIRTH', value: '05/14/1990' },
      { type: 'EMAIL', value: 'carlos@clinic.org' },
    ],
  },
  {
    text: 'No sensitive data here, just a friendly note about lunch at noon.',
    gold: [],
  },
  {
    text: 'Reference number 1234567890 is not an SSN and card 4111 1111 1111 1112 is invalid.',
    // The 10-digit ref is not a valid SSN/routing; the card fails Luhn. Both
    // should be left alone — this example guards against false positives.
    gold: [],
  },
];
