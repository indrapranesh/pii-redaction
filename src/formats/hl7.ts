import { runRecognizers } from '../deterministic/recognizers.js';
import type { PIIType } from '../types.js';
import { createRedactor, type FormatRedactOptions } from './shared.js';

/**
 * Structure-aware PHI redaction for HL7 v2.x messages.
 *
 * An HL7 v2 message is segments (separated by a carriage return) of
 * pipe-delimited fields, each field further split into components (`^`) and
 * repetitions (`~`). The actual delimiters are declared in MSH-1/MSH-2, so we
 * read them rather than assume. PHI lives in known fields of known segments —
 * PID, NK1, GT1, IN1/IN2 — plus free-text notes (NTE) and observation values
 * (OBX-5). We redact those and reassemble with the original delimiters, so
 * `rehydrate()` reconstructs the message exactly.
 */

export interface Hl7RedactionResult {
  /** The redacted message, safe to send to a cloud LLM. */
  redactedText: string;
  /** placeholder -> original value. Never serialize to the network. */
  vault: Map<string, string>;
  /** original value -> placeholder. */
  placeholders: Map<string, string>;
  /** Every value that was redacted, with its type. */
  redactions: Array<{ type: PIIType; value: string; token: string }>;
}

/** How a given segment field should be treated. */
type FieldRule =
  | 'name'
  | 'address'
  | 'phone'
  | 'dob'
  | 'ssn'
  | 'license'
  | 'account'
  | 'healthplan'
  | 'id'
  | 'freetext';

/**
 * Field-level PHI map, by segment. Field numbers are the HL7 1-based positions
 * (PID-5 is the fifth field after the segment name).
 */
const SEGMENT_RULES: Record<string, Record<number, FieldRule>> = {
  PID: {
    3: 'id', 4: 'id', 5: 'name', 6: 'name', 7: 'dob', 9: 'name', 11: 'address',
    13: 'phone', 14: 'phone', 18: 'account', 19: 'ssn', 20: 'license',
  },
  NK1: { 2: 'name', 4: 'address', 5: 'phone', 6: 'phone' },
  GT1: { 3: 'name', 5: 'address', 6: 'phone', 7: 'phone', 11: 'dob', 12: 'ssn' },
  IN1: { 16: 'name', 19: 'address', 36: 'healthplan' },
  IN2: { 2: 'ssn', 6: 'healthplan', 8: 'healthplan' },
  NK2: { 2: 'name' },
  NTE: { 3: 'freetext' },
  OBX: { 5: 'freetext' },
};

/** CX (identifier) type codes → our types, for PID-3/PID-4 identifier lists. */
const CX_CODE_TYPE: Record<string, PIIType> = {
  MR: 'MRN', SS: 'SSN', SB: 'SSN', DL: 'DRIVERS_LICENSE', PPN: 'PASSPORT',
  MB: 'HEALTH_PLAN_ID', MA: 'HEALTH_PLAN_ID', MC: 'HEALTH_PLAN_ID',
  NPI: 'NPI', AN: 'ACCOUNT_NUMBER',
};

interface Delimiters {
  field: string;
  component: string;
  repetition: string;
}

/** Read the delimiters from the MSH segment, falling back to the defaults. */
function readDelimiters(message: string): Delimiters {
  const mshAt = message.indexOf('MSH');
  if (mshAt >= 0 && message.length > mshAt + 4) {
    const field = message[mshAt + 3];
    const enc = message.slice(mshAt + 4, mshAt + 8); // MSH-2 encoding chars
    return {
      field,
      component: enc[0] || '^',
      repetition: enc[1] || '~',
    };
  }
  return { field: '|', component: '^', repetition: '~' };
}

export async function redactHl7(
  message: string,
  options: FormatRedactOptions = {},
): Promise<Hl7RedactionResult> {
  const R = createRedactor(options);
  const d = readDelimiters(message);

  /** Redact selected components of one repetition; returns rebuilt repetition. */
  const redactRepetition = (rep: string, rule: FieldRule): string => {
    const comps = rep.split(d.component);
    const set = (i: number, type: PIIType) => {
      if (comps[i]) comps[i] = R.redactValue(comps[i], type);
    };
    switch (rule) {
      case 'name': // XPN: family^given^middle^suffix^prefix
        for (let i = 0; i <= 4; i++) set(i, 'PERSON');
        break;
      case 'address': // XAD: street^other^city^state^zip^country (state/country kept)
        set(0, 'LOCATION'); set(1, 'LOCATION'); set(2, 'LOCATION'); set(4, 'LOCATION');
        break;
      case 'phone': // XTN: the number/email can sit in several components
        comps.forEach((c, i) => {
          if (!c) return;
          if (c.includes('@')) comps[i] = R.redactValue(c, 'EMAIL');
          else if ((c.match(/\d/g) ?? []).length >= 7)
            comps[i] = R.redactValue(c, 'PHONE');
        });
        break;
      case 'dob': set(0, 'DATE_OF_BIRTH'); break;
      case 'ssn': set(0, 'SSN'); break;
      case 'license': set(0, 'DRIVERS_LICENSE'); break;
      case 'account': set(0, 'ACCOUNT_NUMBER'); break;
      case 'healthplan': set(0, 'HEALTH_PLAN_ID'); break;
      case 'id': { // CX: id^checkdigit^scheme^authority^typecode
        const value = comps[0];
        if (value) {
          const code = comps[4]?.toUpperCase();
          const whole = runRecognizers(value).find(
            (h) => h.start === 0 && h.end === value.length,
          );
          const type: PIIType =
            (code && CX_CODE_TYPE[code]) || whole?.type || 'MRN';
          comps[0] = R.redactValue(value, type);
        }
        break;
      }
    }
    return comps.join(d.component);
  };

  const redactField = async (field: string, rule: FieldRule): Promise<string> => {
    if (rule === 'freetext') return R.redactFreeText(field);
    return field
      .split(d.repetition)
      .map((rep) => redactRepetition(rep, rule))
      .join(d.repetition);
  };

  // Split into segments while preserving the exact line separators.
  const parts = message.split(/(\r\n|\r|\n)/);
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || /^(\r\n|\r|\n)$/.test(part)) {
      out.push(part); // a separator (or empty) — pass through untouched
      continue;
    }
    const fields = part.split(d.field);
    const rules = SEGMENT_RULES[fields[0]];
    if (rules) {
      for (const [n, rule] of Object.entries(rules)) {
        const idx = Number(n);
        if (fields[idx]) fields[idx] = await redactField(fields[idx], rule);
      }
    }
    out.push(fields.join(d.field));
  }

  return {
    redactedText: out.join(''),
    vault: R.vault,
    placeholders: R.placeholders,
    redactions: R.redactions,
  };
}
