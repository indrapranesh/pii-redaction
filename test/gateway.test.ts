import { describe, expect, it, vi } from 'vitest';
import {
  createGateway,
  extractText,
  type AuditRecord,
  type GatewayEnv,
} from '../gateway/src/gateway.js';

const ENV: GatewayEnv = {
  GATEWAY_API_KEYS: 'client-key-abcd',
  UPSTREAM_API_KEY: 'sk-upstream-secret',
  UPSTREAM_BASE_URL: 'https://upstream.test',
};

function req(body: unknown, key = 'client-key-abcd', method = 'POST'): Request {
  return new Request('https://gw.test/v1/chat/completions', {
    method,
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

describe('extractText', () => {
  it('reads string and array message content plus an Anthropic system prompt', () => {
    const text = extractText({
      system: 'You are helpful.',
      messages: [
        { role: 'user', content: 'plain string' },
        { role: 'user', content: [{ type: 'text', text: 'array part' }] },
      ],
    });
    expect(text).toContain('You are helpful.');
    expect(text).toContain('plain string');
    expect(text).toContain('array part');
  });
});

describe('gateway auth & method', () => {
  it('rejects non-POST', async () => {
    const gw = createGateway();
    const res = await gw.fetch(req({}, 'client-key-abcd', 'GET'), ENV);
    expect(res.status).toBe(405);
  });

  it('rejects missing/unknown client key', async () => {
    const gw = createGateway();
    expect((await gw.fetch(req({ messages: [] }, ''), ENV)).status).toBe(401);
    expect((await gw.fetch(req({ messages: [] }, 'wrong'), ENV)).status).toBe(401);
  });
});

describe('gateway leak guard (defense-in-depth)', () => {
  it('blocks a request containing raw PII and does not call upstream', async () => {
    const upstream = vi.fn();
    const records: AuditRecord[] = [];
    const gw = createGateway({
      fetch: upstream as unknown as typeof fetch,
      audit: (r) => void records.push(r),
    });

    const res = await gw.fetch(
      req({ model: 'gpt-4o', messages: [{ role: 'user', content: 'my ssn is 123-45-6789' }] }),
      ENV,
    );

    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string; types: string[] };
    expect(json.error).toBe('pii_detected');
    expect(json.types).toContain('SSN');
    expect(upstream).not.toHaveBeenCalled();
    expect(records[0].action).toBe('blocked');
    // The audit preview must never contain the raw value.
    expect(records[0].redactedPreview).not.toContain('123-45-6789');
    expect(records[0].redactedPreview).toContain('[[SSN_1]]');
  });

  it('in flag mode forwards but still re-redacts the audit preview', async () => {
    const upstream = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const records: AuditRecord[] = [];
    const gw = createGateway({
      fetch: upstream as unknown as typeof fetch,
      audit: (r) => void records.push(r),
      leakPolicy: 'flag',
    });

    const res = await gw.fetch(
      req({ model: 'gpt-4o', messages: [{ role: 'user', content: 'card 4111 1111 1111 1111' }] }),
      ENV,
    );

    expect(res.status).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
    expect(records[0].action).toBe('forwarded');
    expect(records[0].leakedTypes).toContain('CREDIT_CARD');
    expect(records[0].redactedPreview).not.toContain('4111 1111 1111 1111');
  });
});

describe('gateway forwarding', () => {
  it('forwards a clean (already-redacted) request and passes the response through', async () => {
    const upstream = vi.fn(async (url: string, init: RequestInit) => {
      // Upstream receives the server-held key, not the client key.
      expect(url).toBe('https://upstream.test/v1/chat/completions');
      expect((init.headers as Record<string, string>).authorization).toBe(
        'Bearer sk-upstream-secret',
      );
      return new Response(JSON.stringify({ id: 'cmpl_1', ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const records: AuditRecord[] = [];
    const gw = createGateway({
      fetch: upstream as unknown as typeof fetch,
      audit: (r) => void records.push(r),
      now: () => 1_700_000_000_000,
      id: () => 'req_test',
    });

    const res = await gw.fetch(
      req({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: '[[PERSON_1]] cannot access [[EMAIL_1]]' }],
      }),
      ENV,
    );

    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({ id: 'cmpl_1', ok: true });
    expect(records[0]).toMatchObject({
      id: 'req_test',
      timestamp: 1_700_000_000_000,
      clientKeyId: 'abcd',
      model: 'gpt-4o',
      leakedTypes: [],
      upstreamStatus: 200,
      action: 'forwarded',
    });
  });
});
