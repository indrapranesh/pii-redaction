# Redacted-only gateway (Phase 2)

A drop-in endpoint that mimics the OpenAI/Anthropic API. The SDK/extension
redacts client-side and sends only redacted text here; the gateway forwards to
the provider and returns the response. **The gateway only ever sees redacted
text**, so it can log an immutable audit trail — "prove to our auditors no PII
left the building" — without becoming a data liability itself.

## Properties

- **Auth** — clients authenticate with a gateway key (`GATEWAY_API_KEYS`); the
  real provider key (`UPSTREAM_API_KEY`) is held server-side and never exposed.
- **Leak guard (defense-in-depth)** — every request is re-scanned with the
  deterministic engine. If raw structured PII arrives, it is **blocked** with
  `422 pii_detected` (or flagged, per `leakPolicy`) *before* reaching the
  provider. The response lists only entity *types*, never values.
- **Clean audit trail** — each record is re-redacted before it is written, so
  the log itself can never contain raw PII. Records carry a non-reversible
  client id (last 4 of the key), model, redacted preview, detected types,
  upstream status, and action.

## Design

`src/gateway.ts` is runtime-agnostic (Web Fetch API) and fully
dependency-injected — `fetch` (upstream), `audit` (sink), `now`, `id`, and
`leakPolicy` — which is what makes it unit-testable without a live provider (see
`test/gateway.test.ts`). `src/worker.ts` is the Cloudflare Workers entry point,
wiring the audit sink to a KV namespace when bound.

## Deploy (Cloudflare Workers)

```bash
npm i -g wrangler
cd gateway
wrangler secret put GATEWAY_API_KEYS   # comma-separated client keys
wrangler secret put UPSTREAM_API_KEY   # your OpenAI/Anthropic key
wrangler kv:namespace create AUDIT_LOG # then uncomment the binding in wrangler.toml
wrangler deploy
```

Point your OpenAI client's `baseURL` at the deployed Worker; requests flow
through unchanged except for the redaction guard and audit logging.

## Request flow

```
client (redacted text)
   │  Authorization: Bearer <gateway key>
   ▼
gateway ── re-scan for raw PII ──► block (422) if any leaked
   │  forward with <upstream key>
   ▼
provider (OpenAI / Anthropic)
   │
   ▼
gateway ── write re-redacted audit record ──► response passthrough to client
```
