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
  /**
   * Gold entities. `value` alone lets the harness locate the span by first
   * occurrence; when `start`/`end` are supplied (e.g. from a dataset that ships
   * offsets) they are used verbatim, which is exact even for repeated values.
   */
  gold: Array<{ type: PIIType; value: string; start?: number; end?: number }>;
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
  {
    text: 'ITIN 900-70-1234 on file; MRN: A55231 for the visit.',
    gold: [
      { type: 'ITIN', value: '900-70-1234' },
      { type: 'MRN', value: 'A55231' },
    ],
  },
  {
    text: "Passport No: X12345678 and driver's license D9988776 attached.",
    gold: [
      { type: 'PASSPORT', value: 'X12345678' },
      { type: 'DRIVERS_LICENSE', value: 'D9988776' },
    ],
  },
  {
    text: 'IPv6 host 2001:db8::8a2e:370:7334 responded; account no. 100200300400.',
    gold: [
      { type: 'IP', value: '2001:db8::8a2e:370:7334' },
      { type: 'ACCOUNT_NUMBER', value: '100200300400' },
    ],
  },
  {
    text: 'The hex color #cafe12 and the word decade are not identifiers.',
    // Guards against IPv6/hex false positives on ordinary hex-looking text.
    gold: [],
  },
  // ---- PHI (HIPAA) fixtures ----
  {
    text: 'Referring provider NPI 1234567893 prescribed under DEA AZ1234563.',
    gold: [
      { type: 'NPI', value: '1234567893' },
      { type: 'DEA', value: 'AZ1234563' },
    ],
  },
  {
    text: 'Medicare MBI 1EG4-TE5-MK73; discharged 03/22/2024 in stable condition.',
    gold: [
      { type: 'MBI', value: '1EG4-TE5-MK73' },
      { type: 'CLINICAL_DATE', value: '03/22/2024' },
    ],
  },
  {
    text: 'Member ID HP99881234 on file; records at https://portal.clinic.org/patient/42.',
    gold: [
      { type: 'HEALTH_PLAN_ID', value: 'HP99881234' },
      { type: 'URL', value: 'https://portal.clinic.org/patient/42' },
    ],
  },
  {
    text: 'Transport unit VIN 1HGCM82633A004352; fax records to fax: 415-555-0199.',
    gold: [
      { type: 'VIN', value: '1HGCM82633A004352' },
      { type: 'FAX', value: '415-555-0199' },
    ],
  },
];
