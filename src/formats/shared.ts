import { detectDeterministic } from '../deterministic/index.js';
import { makePlaceholder } from '../placeholders.js';
import { reconcile } from '../reconcile.js';
import type { NerProvider, PIIEntity, PIIType, Policy } from '../types.js';

/**
 * Shared machinery for the structure-aware format redactors (FHIR, HL7 v2,
 * C-CDA). Each format walks its own structure but funnels every redaction
 * through one allocator, so a value seen in a structured field and again in a
 * free-text note maps to a single stable placeholder — and the resulting
 * `[[TYPE_N]]` tokens + vault are identical to what the core `redact()` emits,
 * so `rehydrate()` reconstructs the document without any format-specific logic.
 */

export interface FormatRedactOptions {
  policy?: Policy;
  /** Optional contextual NER, applied to free-text narrative / notes / OBX. */
  ner?: NerProvider;
}

export interface Redaction {
  type: PIIType;
  value: string;
  token: string;
}

export interface Redactor {
  policy: Policy;
  vault: Map<string, string>;
  placeholders: Map<string, string>;
  redactions: Redaction[];
  /** Allocate (or reuse) a stable placeholder for a (type, value). */
  allocate(type: PIIType, value: string): string | null;
  /** Redact a whole leaf string as one entity of `type`; returns the token or the value unchanged. */
  redactValue(value: string, type: PIIType): string;
  /** Run the free-text engine over a string and splice placeholders in. */
  redactFreeText(text: string): Promise<string>;
}

/** Build a redactor with a fresh vault. */
export function createRedactor(options: FormatRedactOptions = {}): Redactor {
  const policy = options.policy ?? {};
  const vault = new Map<string, string>();
  const placeholders = new Map<string, string>();
  const redactions: Redaction[] = [];
  const counters = new Map<PIIType, number>();

  const allowed = (type: PIIType): boolean => {
    if (policy.allow && !policy.allow.includes(type)) return false;
    if (policy.deny && policy.deny.includes(type)) return false;
    return true;
  };

  const allocate = (type: PIIType, value: string): string | null => {
    if (!allowed(type)) return null;
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

  const redactValue = (value: string, type: PIIType): string => {
    if (typeof value !== 'string' || value.length === 0) return value;
    return allocate(type, value) ?? value;
  };

  const applyPolicy = (entities: PIIEntity[]): PIIEntity[] => {
    const minConfidence = policy.minConfidence ?? 0;
    return entities.filter((e) => {
      if (!allowed(e.type)) return false;
      if (e.source === 'ner' && e.confidence < minConfidence) return false;
      return true;
    });
  };

  const redactFreeText = async (text: string): Promise<string> => {
    if (typeof text !== 'string' || text.length === 0) return text;
    const candidates = detectDeterministic(text, policy.dictionary ?? []);
    if (options.ner) candidates.push(...(await options.ner.detect(text)));
    const entities = reconcile(applyPolicy(candidates));
    // Splice right-to-left so earlier offsets stay valid.
    const ordered = [...entities].sort((a, b) => b.start - a.start);
    let out = text;
    for (const e of ordered) {
      const token = allocate(e.type, e.text);
      if (token) out = out.slice(0, e.start) + token + out.slice(e.end);
    }
    return out;
  };

  return {
    policy,
    vault,
    placeholders,
    redactions,
    allocate,
    redactValue,
    redactFreeText,
  };
}
