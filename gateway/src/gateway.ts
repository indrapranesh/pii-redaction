/**
 * Redacted-only LLM gateway (Phase 2).
 *
 * The SDK/extension redacts client-side and sends only redacted text here. The
 * gateway forwards to the upstream provider and returns the response. Because it
 * only ever handles redacted traffic, it can log an immutable audit trail
 * ("prove no PII left the building") without becoming a data liability.
 *
 * As defense-in-depth it re-scans every incoming request with the deterministic
 * engine: if raw structured PII somehow arrives, it is blocked (or flagged)
 * BEFORE reaching the provider. Anything written to the audit log is itself
 * re-redacted, so the log can never contain raw PII.
 *
 * Runtime-agnostic (Web Fetch API): runs on Cloudflare Workers, Deno, or Node.
 */
import { redact } from '../../src/index.js';
import type { PIIType } from '../../src/index.js';

export interface GatewayEnv {
  /** Comma-separated client API keys allowed to use the gateway. */
  GATEWAY_API_KEYS?: string;
  /** Upstream provider key, injected server-side and never exposed to clients. */
  UPSTREAM_API_KEY?: string;
  /** Upstream base URL. Defaults to the OpenAI API. */
  UPSTREAM_BASE_URL?: string;
}

export interface AuditRecord {
  id: string;
  timestamp: number;
  /** Non-reversible client identifier (last 4 chars of the presented key). */
  clientKeyId: string;
  path: string;
  model: string | null;
  /** The request text AFTER re-redaction — guaranteed free of raw PII. */
  redactedPreview: string;
  /** PII types detected in the incoming request (values are never stored). */
  leakedTypes: PIIType[];
  upstreamStatus: number | null;
  action: 'forwarded' | 'blocked';
}

export interface GatewayDeps {
  /** Upstream fetch (injectable for tests). Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Audit sink. Defaults to a no-op; wire to KV/D1/an object store in prod. */
  audit?: (record: AuditRecord) => void | Promise<void>;
  /** Injectable clock (keeps tests deterministic). */
  now?: () => number;
  /** Injectable id generator. */
  id?: () => string;
  /** What to do when raw PII is detected in an incoming request. */
  leakPolicy?: 'block' | 'flag';
}

const DEFAULT_BASE = 'https://api.openai.com';

/** Extract all user-authored text from an OpenAI- or Anthropic-shaped body. */
export function extractText(body: unknown): string {
  const parts: string[] = [];
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return '';

  if (typeof b.system === 'string') parts.push(b.system); // Anthropic system

  const messages = Array.isArray(b.messages) ? b.messages : [];
  for (const msg of messages) {
    const content = (msg as Record<string, unknown>)?.content;
    if (typeof content === 'string') {
      parts.push(content);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        const text = (part as Record<string, unknown>)?.text;
        if (typeof text === 'string') parts.push(text);
      }
    }
  }
  return parts.join('\n');
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function authorizedKey(request: Request, env: GatewayEnv): string | null {
  const header = request.headers.get('authorization') ?? '';
  const presented = header.replace(/^Bearer\s+/i, '').trim();
  if (!presented) return null;
  const allowed = (env.GATEWAY_API_KEYS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  return allowed.includes(presented) ? presented : null;
}

/** Build the gateway handler with its (optionally injected) dependencies. */
export function createGateway(deps: GatewayDeps = {}) {
  const upstreamFetch = deps.fetch ?? fetch;
  const audit = deps.audit ?? (() => {});
  const now = deps.now ?? (() => Date.now());
  const genId = deps.id ?? (() => `req_${now().toString(36)}`);
  const leakPolicy = deps.leakPolicy ?? 'block';

  async function handle(request: Request, env: GatewayEnv): Promise<Response> {
    if (request.method !== 'POST') {
      return jsonResponse(405, { error: 'method_not_allowed' });
    }

    const clientKey = authorizedKey(request, env);
    if (!clientKey) {
      return jsonResponse(401, { error: 'unauthorized' });
    }
    const clientKeyId = clientKey.slice(-4);

    const url = new URL(request.url);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { error: 'invalid_json' });
    }

    const model =
      (body as Record<string, unknown>)?.model != null
        ? String((body as Record<string, unknown>).model)
        : null;

    // Defense-in-depth: re-scan for structured PII. Re-redact for the audit log
    // so it can never store raw values.
    const text = extractText(body);
    const scan = await redact(text);
    const leakedTypes = [...new Set(scan.entities.map((e) => e.type))];
    const record: AuditRecord = {
      id: genId(),
      timestamp: now(),
      clientKeyId,
      path: url.pathname,
      model,
      redactedPreview: scan.redactedText.slice(0, 2000),
      leakedTypes,
      upstreamStatus: null,
      action: 'forwarded',
    };

    if (leakedTypes.length > 0 && leakPolicy === 'block') {
      record.action = 'blocked';
      await audit(record);
      return jsonResponse(422, {
        error: 'pii_detected',
        message:
          'Raw PII detected in request. Redact client-side before sending to the gateway.',
        types: leakedTypes,
      });
    }

    // Forward to the upstream provider with the server-held key.
    const base = env.UPSTREAM_BASE_URL ?? DEFAULT_BASE;
    const upstreamUrl = base.replace(/\/$/, '') + url.pathname + url.search;
    const upstream = await upstreamFetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.UPSTREAM_API_KEY ?? ''}`,
      },
      body: JSON.stringify(body),
    });

    record.upstreamStatus = upstream.status;
    await audit(record);

    // Pass the upstream response through (streaming bodies included).
    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    });
  }

  return { fetch: handle };
}
