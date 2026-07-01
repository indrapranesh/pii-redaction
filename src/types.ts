/**
 * Core type definitions for the PII redaction engine.
 *
 * The engine detects PII spans in text, replaces them with stable placeholders,
 * and keeps a placeholder -> original-value mapping (the "vault") that NEVER
 * leaves the client. Only the redacted text is safe to send to a cloud LLM;
 * the model's response is then rehydrated locally using the vault.
 */

/**
 * The category of a detected entity. Structured types (SSN, CREDIT_CARD, ...)
 * are caught deterministically; contextual types (PERSON, ORG, LOCATION) come
 * from the NER layer. `MISC` is a catch-all for model labels that don't map
 * cleanly onto a known category.
 */
export type PIIType =
  | 'SSN'
  | 'ITIN'
  | 'CREDIT_CARD'
  | 'EMAIL'
  | 'PHONE'
  | 'IP'
  | 'IBAN'
  | 'ROUTING_NUMBER'
  | 'ACCOUNT_NUMBER'
  | 'PASSPORT'
  | 'DRIVERS_LICENSE'
  | 'MRN'
  | 'DATE_OF_BIRTH'
  // PHI (HIPAA Safe Harbor) structured identifiers
  | 'NPI'
  | 'DEA'
  | 'MBI'
  | 'VIN'
  | 'FAX'
  | 'URL'
  | 'HEALTH_PLAN_ID'
  | 'CLINICAL_DATE'
  /** Generic unique identifier (e.g. a FHIR Identifier.value of unknown kind). */
  | 'IDENTIFIER'
  | 'PERSON'
  | 'ORG'
  | 'LOCATION'
  | 'MISC';

/** Where a detection came from. Used for overlap resolution and auditing. */
export type EntitySource = 'deterministic' | 'ner' | 'dictionary';

/** A single detected PII span in the source text. */
export interface PIIEntity {
  type: PIIType;
  /** Inclusive character offset where the span starts. */
  start: number;
  /** Exclusive character offset where the span ends. */
  end: number;
  /** The original substring `text.slice(start, end)`. */
  text: string;
  source: EntitySource;
  /** 1.0 for deterministic/dictionary hits; model score in [0,1] for NER. */
  confidence: number;
}

/** The result of redacting a piece of text. */
export interface RedactionResult {
  /** Text with every detected entity replaced by its placeholder. */
  redactedText: string;
  /**
   * placeholder -> original value. This is the secret. It stays in memory and
   * MUST NOT be serialized to the network. `rehydrate` consumes it locally.
   */
  vault: Map<string, string>;
  /** All entities that were redacted, for the review-before-send UI. */
  entities: PIIEntity[];
  /** original value -> placeholder, so callers can inspect the mapping. */
  placeholders: Map<string, string>;
}

/**
 * A user/org-supplied term that should always be redacted (client names,
 * project codenames, internal identifiers). Matched deterministically and
 * treated with the highest precedence, closing NER recall gaps cheaply.
 */
export interface DictionaryTerm {
  term: string;
  type: PIIType;
  /** Case-insensitive whole-word match by default. */
  caseSensitive?: boolean;
}

/** Policy controlling what the engine detects and how confident it must be. */
export interface Policy {
  /** Only these types are redacted. Omit to allow every type. */
  allow?: PIIType[];
  /** These types are never redacted, even if detected. */
  deny?: PIIType[];
  /**
   * Minimum NER confidence to accept a contextual entity, in [0,1].
   * Deterministic and dictionary hits ignore this (they are always 1.0).
   * Bias low: over-redaction is a recoverable annoyance, under-redaction leaks.
   */
  minConfidence?: number;
  /** Extra org/user terms to always redact. */
  dictionary?: DictionaryTerm[];
}

/**
 * Pluggable contextual-entity detector. The Transformers.js adapter implements
 * this, but callers can inject any implementation (or a stub for tests) so the
 * core never hard-depends on a model runtime.
 */
export interface NerProvider {
  /**
   * Return contextual entities for `text` with char offsets relative to the
   * start of `text`. Must be safe to call with arbitrarily long input; the
   * adapter is responsible for chunking.
   */
  detect(text: string): Promise<PIIEntity[]>;
}

/** Options accepted by {@link redact}. */
export interface RedactOptions {
  policy?: Policy;
  /** Contextual NER layer. Omit to run deterministic-only redaction. */
  ner?: NerProvider;
}
