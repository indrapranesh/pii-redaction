import { detectDeterministic } from '../deterministic/index.js';
import { runRecognizers } from '../deterministic/recognizers.js';
import { makePlaceholder } from '../placeholders.js';
import { reconcile } from '../reconcile.js';
import type { PIIEntity, PIIType, Policy, NerProvider } from '../types.js';

/**
 * Structure-aware PHI redaction for FHIR resources (R4).
 *
 * FHIR reuses a small set of datatypes — HumanName, ContactPoint, Address,
 * Identifier, Narrative, Annotation — across every resource. So rather than
 * enumerate resource-specific paths, we recognize those datatypes *structurally*
 * and redact the PHI-bearing leaves inside them. This covers Patient,
 * Practitioner, RelatedPerson, Bundles, and any other resource uniformly, and
 * degrades gracefully on shapes it doesn't know (they're just recursed into).
 *
 * The redactor allocates the same `[[TYPE_N]]` placeholders as the free-text
 * engine into a shared vault, so a value that appears both in a structured field
 * and in narrative text maps to one stable placeholder — and `rehydrate()` from
 * the core works unchanged on the serialized output.
 */

/** Any JSON value. FHIR resources are plain JSON. */
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface FhirRedactOptions {
  policy?: Policy;
  /** Optional contextual NER, applied to free-text narrative/notes. */
  ner?: NerProvider;
  /** Indentation for the serialized output. Default 2; pass 0 for compact. */
  space?: number;
}

export interface FhirRedactionResult {
  /** The redacted resource, serialized. Safe to send to a cloud LLM. */
  redactedText: string;
  /** The redacted resource as an object. */
  redacted: Json;
  /** placeholder -> original value. The secret; never serialize to the network. */
  vault: Map<string, string>;
  /** original value -> placeholder. */
  placeholders: Map<string, string>;
  /** Every value that was redacted, with the type it was classified as. */
  redactions: Array<{ type: PIIType; value: string; token: string }>;
}

/** ContactPoint.system values and the PII type each implies. */
const CONTACT_SYSTEM_TYPE: Record<string, PIIType> = {
  phone: 'PHONE',
  sms: 'PHONE',
  pager: 'PHONE',
  fax: 'FAX',
  email: 'EMAIL',
  url: 'URL',
};

/** HL7 v2-0203 identifier-type codes FHIR reuses, mapped to our types. */
const IDENTIFIER_CODE_TYPE: Record<string, PIIType> = {
  MR: 'MRN',
  SS: 'SSN',
  SB: 'SSN',
  DL: 'DRIVERS_LICENSE',
  PPN: 'PASSPORT',
  MB: 'HEALTH_PLAN_ID',
  MA: 'HEALTH_PLAN_ID',
  MC: 'HEALTH_PLAN_ID',
  NPI: 'NPI',
  NP: 'NPI',
  DEA: 'DEA',
  MD: 'DEA',
};

function isObject(v: Json): v is { [k: string]: Json } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Apply a policy's allow/deny/confidence filter (mirrors the core engine). */
function applyPolicy(entities: PIIEntity[], policy: Policy): PIIEntity[] {
  const allow = policy.allow ? new Set(policy.allow) : null;
  const deny = policy.deny ? new Set(policy.deny) : null;
  const minConfidence = policy.minConfidence ?? 0;
  return entities.filter((e) => {
    if (allow && !allow.has(e.type)) return false;
    if (deny && deny.has(e.type)) return false;
    if (e.source === 'ner' && e.confidence < minConfidence) return false;
    return true;
  });
}

/**
 * Redact PHI in a FHIR resource. Accepts a resource object or a JSON string.
 */
export async function redactFhir(
  input: string | unknown,
  options: FhirRedactOptions = {},
): Promise<FhirRedactionResult> {
  const policy = options.policy ?? {};
  const root: Json =
    typeof input === 'string' ? (JSON.parse(input) as Json) : (input as Json);

  const vault = new Map<string, string>();
  const placeholders = new Map<string, string>();
  const redactions: FhirRedactionResult['redactions'] = [];
  const counters = new Map<PIIType, number>();

  /** Allocate (or reuse) a stable placeholder for a (type, value) pair. */
  const allocate = (type: PIIType, value: string): string | null => {
    // Respect policy allow/deny for structured fields too.
    if (policy.allow && !policy.allow.includes(type)) return null;
    if (policy.deny && policy.deny.includes(type)) return null;
    const existing = placeholders.get(`${type} ${value}`);
    if (existing) return existing;
    const next = (counters.get(type) ?? 0) + 1;
    counters.set(type, next);
    const token = makePlaceholder(type, next);
    placeholders.set(`${type} ${value}`, token);
    vault.set(token, value);
    redactions.push({ type, value, token });
    return token;
  };

  /** Redact a whole leaf value as a single entity of `type`. */
  const redactValue = (value: Json, type: PIIType): Json => {
    if (typeof value !== 'string' || value.length === 0) return value;
    return allocate(type, value) ?? value;
  };

  /** Run the free-text engine over a string and splice placeholders in. */
  const redactFreeText = async (text: string): Promise<string> => {
    if (typeof text !== 'string' || text.length === 0) return text;
    const candidates = detectDeterministic(text, policy.dictionary ?? []);
    if (options.ner) candidates.push(...(await options.ner.detect(text)));
    const entities = reconcile(applyPolicy(candidates, policy));
    // Splice right-to-left so earlier offsets stay valid.
    const ordered = [...entities].sort((a, b) => b.start - a.start);
    let out = text;
    for (const e of ordered) {
      const token = allocate(e.type, e.text);
      if (token) out = out.slice(0, e.start) + token + out.slice(e.end);
    }
    return out;
  };

  /** Classify a FHIR Identifier's value → most specific type we can prove. */
  const identifierType = (idObj: { [k: string]: Json }, value: string): PIIType => {
    // 1) Explicit type coding (HL7 v2-0203).
    const type = idObj['type'];
    if (isObject(type) && Array.isArray(type['coding'])) {
      for (const c of type['coding']) {
        if (isObject(c) && typeof c['code'] === 'string') {
          const mapped = IDENTIFIER_CODE_TYPE[c['code'].toUpperCase()];
          if (mapped) return mapped;
        }
      }
    }
    // 2) The value itself may be a checksum-verifiable id (SSN, NPI, ...).
    const hits = runRecognizers(value);
    const whole = hits.find((h) => h.start === 0 && h.end === value.length);
    if (whole) return whole.type;
    // 3) Fall back to a generic identifier.
    return 'IDENTIFIER';
  };

  // ---- structural datatype predicates ----
  const looksLikeHumanName = (o: { [k: string]: Json }): boolean =>
    'family' in o || 'given' in o;
  const looksLikeContactPoint = (o: { [k: string]: Json }): boolean =>
    'value' in o &&
    typeof o['system'] === 'string' &&
    o['system'] in CONTACT_SYSTEM_TYPE;
  const looksLikeAddress = (o: { [k: string]: Json }): boolean =>
    'line' in o || 'postalCode' in o || 'city' in o || 'district' in o;
  const looksLikeIdentifier = (o: { [k: string]: Json }): boolean =>
    'value' in o && ('system' in o || 'type' in o);
  const looksLikeNarrative = (o: { [k: string]: Json }): boolean =>
    typeof o['div'] === 'string' && 'status' in o;

  /** Recursively transform a node, redacting recognized PHI in place. */
  const transform = async (node: Json, keyHint?: string): Promise<Json> => {
    if (Array.isArray(node)) {
      const out: Json[] = [];
      for (const item of node) out.push(await transform(item, keyHint));
      return out;
    }
    if (!isObject(node)) {
      // A bare string reached under a PHI key hint (given[], line[], ...).
      return node;
    }

    // HumanName — redact all name-part strings as PERSON.
    if (looksLikeHumanName(node)) {
      const out: { [k: string]: Json } = { ...node };
      for (const k of ['family', 'text']) {
        if (typeof out[k] === 'string') out[k] = redactValue(out[k], 'PERSON');
      }
      for (const k of ['given', 'prefix', 'suffix']) {
        if (Array.isArray(out[k])) {
          out[k] = out[k].map((v) =>
            typeof v === 'string' ? redactValue(v, 'PERSON') : v,
          );
        }
      }
      return out;
    }

    // ContactPoint — redact `value` per its `system`.
    if (looksLikeContactPoint(node)) {
      const out = { ...node };
      const t = CONTACT_SYSTEM_TYPE[node['system'] as string];
      out['value'] = redactValue(out['value'], t);
      return out;
    }

    // Address — redact street/city/district/postalCode/text (state/country kept).
    if (looksLikeAddress(node)) {
      const out: { [k: string]: Json } = { ...node };
      for (const k of ['city', 'district', 'postalCode', 'text']) {
        if (typeof out[k] === 'string') out[k] = redactValue(out[k], 'LOCATION');
      }
      if (Array.isArray(out['line'])) {
        out['line'] = out['line'].map((v) =>
          typeof v === 'string' ? redactValue(v, 'LOCATION') : v,
        );
      }
      return out;
    }

    // Identifier — redact `value`, typed as precisely as we can.
    if (looksLikeIdentifier(node) && typeof node['value'] === 'string') {
      const out = { ...node };
      const t = identifierType(node, node['value']);
      out['value'] = redactValue(out['value'], t);
      return out;
    }

    // Narrative — free-text sweep over the XHTML `div`.
    if (looksLikeNarrative(node)) {
      const out = { ...node };
      out['div'] = await redactFreeText(node['div'] as string);
      return out;
    }

    // Generic object: handle known scalar PHI keys, otherwise recurse.
    const out: { [k: string]: Json } = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'birthDate' && typeof v === 'string') {
        out[k] = redactValue(v, 'DATE_OF_BIRTH');
      } else if (k === 'deceasedDateTime' && typeof v === 'string') {
        out[k] = redactValue(v, 'CLINICAL_DATE');
      } else if (
        (k === 'text' || k === 'authorString') &&
        typeof v === 'string'
      ) {
        // Annotation.text / .authorString free-text (only reached outside the
        // datatypes handled above, e.g. inside a `note`).
        out[k] =
          k === 'authorString'
            ? redactValue(v, 'PERSON')
            : await redactFreeText(v);
      } else {
        out[k] = await transform(v, k);
      }
    }
    return out;
  };

  const redacted = await transform(root);
  const redactedText = JSON.stringify(redacted, null, options.space ?? 2);

  return { redactedText, redacted, vault, placeholders, redactions };
}
