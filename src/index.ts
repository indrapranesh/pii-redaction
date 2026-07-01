/**
 * @pii-redaction/core
 *
 * Framework-agnostic, client-side PII redaction engine.
 *
 *   const { redactedText, vault } = await redact(text, { policy, ner });
 *   // ...send redactedText to a cloud LLM, get a response back...
 *   const answer = rehydrate(response, vault); // vault never left the client
 *
 * Layer 1 (deterministic regex + checksums) catches structured PII at near-100%
 * recall. Layer 2 (contextual NER, optional) catches names/orgs/locations.
 * Reconciliation merges them into stable placeholders backed by an in-memory
 * vault that MUST NOT be serialized to the network.
 */

export { redact, rehydrate } from './engine.js';
export { reconcile } from './reconcile.js';
export {
  assignPlaceholders,
  makePlaceholder,
  PLACEHOLDER_RE,
} from './placeholders.js';
export {
  detectDeterministic,
  runRecognizers,
  runDictionary,
  RECOGNIZERS,
  isLuhnValid,
  isValidSSN,
  isValidITIN,
  isValidIPv4,
  isValidIPv6,
  isValidIBAN,
  isValidRoutingNumber,
  isPlausibleEmailDomain,
} from './deterministic/index.js';
export type { Recognizer } from './deterministic/index.js';
export { chunkText } from './ner/chunk.js';
export {
  TransformersNerProvider,
  createTransformersNer,
} from './ner/transformers.js';
export type {
  TransformersNerOptions,
  TokenClassificationResult,
  TokenClassificationPipeline,
  PipelineFactory,
} from './ner/transformers.js';

export type {
  PIIType,
  PIIEntity,
  EntitySource,
  RedactionResult,
  DictionaryTerm,
  Policy,
  NerProvider,
  RedactOptions,
} from './types.js';
