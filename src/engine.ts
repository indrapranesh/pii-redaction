import { detectDeterministic } from './deterministic/index.js';
import { assignPlaceholders } from './placeholders.js';
import { reconcile } from './reconcile.js';
import type {
  PIIEntity,
  Policy,
  RedactionResult,
  RedactOptions,
} from './types.js';

/** Apply a policy's allow/deny/confidence filters to a candidate list. */
function applyPolicy(entities: PIIEntity[], policy: Policy): PIIEntity[] {
  const allow = policy.allow ? new Set(policy.allow) : null;
  const deny = policy.deny ? new Set(policy.deny) : null;
  const minConfidence = policy.minConfidence ?? 0;
  return entities.filter((e) => {
    if (allow && !allow.has(e.type)) return false;
    if (deny && deny.has(e.type)) return false;
    // Deterministic/dictionary hits are always confident; the threshold only
    // gates fuzzy NER output.
    if (e.source === 'ner' && e.confidence < minConfidence) return false;
    return true;
  });
}

/**
 * Rewrite `text`, replacing each accepted entity span with its placeholder.
 * Works right-to-left so earlier offsets stay valid as we splice.
 */
function applyPlaceholders(
  text: string,
  entities: PIIEntity[],
  byEntity: string[],
): string {
  const ordered = entities
    .map((e, i) => ({ e, token: byEntity[i] }))
    .sort((a, b) => b.e.start - a.e.start);
  let out = text;
  for (const { e, token } of ordered) {
    out = out.slice(0, e.start) + token + out.slice(e.end);
  }
  return out;
}

/**
 * Detect and redact PII in `text`.
 *
 * Runs the deterministic layer (always) and the contextual NER layer (if an
 * `ner` provider is supplied), reconciles overlaps, assigns stable
 * placeholders, and returns the redacted text plus the in-memory vault.
 *
 * The vault is the secret: keep it local, never serialize it to the network.
 */
export async function redact(
  text: string,
  options: RedactOptions = {},
): Promise<RedactionResult> {
  const policy = options.policy ?? {};

  const candidates = detectDeterministic(text, policy.dictionary ?? []);
  if (options.ner) {
    const nerEntities = await options.ner.detect(text);
    candidates.push(...nerEntities);
  }

  const filtered = applyPolicy(candidates, policy);
  const entities = reconcile(filtered);
  const { vault, placeholders, byEntity } = assignPlaceholders(entities);
  const redactedText = applyPlaceholders(text, entities, byEntity);

  return { redactedText, vault, entities, placeholders };
}

/**
 * Restore original values in `text` (typically a cloud-LLM response) by
 * swapping back every placeholder found in `vault`.
 *
 * Only known vault keys are replaced. If the model pluralized, re-cased, or
 * hallucinated a token, it simply won't match a key and is left as-is — never
 * wrongly substituted.
 */
export function rehydrate(text: string, vault: Map<string, string>): string {
  if (vault.size === 0) return text;
  // Replace longer keys first so no placeholder is a prefix of another.
  const keys = [...vault.keys()].sort((a, b) => b.length - a.length);
  let out = text;
  for (const key of keys) {
    out = out.split(key).join(vault.get(key)!);
  }
  return out;
}
