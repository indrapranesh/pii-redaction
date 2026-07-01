/**
 * Cloudflare Worker entry point for the redacted-only gateway.
 *
 * In production, wire `audit` to a durable sink (KV, D1, R2, or an external
 * append-only log) so the audit trail is immutable. Because every record is
 * re-redacted before it is written, the trail can never contain raw PII.
 */
import { createGateway, type GatewayEnv, type AuditRecord } from './gateway.js';

interface WorkerEnv extends GatewayEnv {
  AUDIT_LOG?: KVNamespaceLike;
}

/** Minimal shape of a Cloudflare KV namespace used for the audit log. */
interface KVNamespaceLike {
  put(key: string, value: string): Promise<void>;
}

const gateway = createGateway({
  audit: async (record: AuditRecord) => {
    // Replaced per-request below when a KV binding is present.
    void record;
  },
});

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    // Rebuild with a KV-backed audit sink if the binding exists.
    const handler = env.AUDIT_LOG
      ? createGateway({
          audit: (record) =>
            env.AUDIT_LOG!.put(
              `${record.timestamp}:${record.id}`,
              JSON.stringify(record),
            ),
        })
      : gateway;
    return handler.fetch(request, env);
  },
};
