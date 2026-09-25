// The verdict vault: the same conversation gets the same verdict, on any phone, every time.
//   GET  /api/verdicts?id=<64 hex>        -> {blob} or 404
//   POST /api/verdicts {id, blob}         -> {blob}: the stored verdict (the first one ever saved
//                                            for this id wins; later ones never replace it)
// The app sends only a hash of the conversation (id) and the verdict encrypted with a key made
// from that conversation (blob), so this server can't read either. Storage is Upstash Redis
// (Vercel Marketplace: KV_REST_API_URL / KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL / _TOKEN).
// Without it configured, the vault is simply off and each phone keeps its own verdicts.
import { send, readBody, rateLimited, foreignOrigin } from "./_ai.js";

const ID = /^[0-9a-f]{64}$/;
const BLOB = /^[A-Za-z0-9_-]{40,90000}$/; // base64url AES-GCM ciphertext of one verdict
const KEEP_SECONDS = 60 * 60 * 24 * 365 * 2;

export function vault(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

async function redis(v, command) {
  const res = await fetch(v.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${v.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw { status: 502, code: "vault_error" };
  return (await res.json())?.result ?? null;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return send(res, 405, { code: "method_not_allowed" });
  if (foreignOrigin(req)) return send(res, 403, { code: "forbidden" });
  const v = vault();
  if (!v) return send(res, 404, { code: "vault_off" });
  if (rateLimited(req, `vault-${req.method}`, req.method === "GET" ? 200 : 60)) return send(res, 429, { code: "rate_limited" });
  try {
    if (req.method === "GET") {
      const id = new URL(req.url, "http://x").searchParams.get("id") || "";
      if (!ID.test(id)) return send(res, 400, { code: "invalid_request" });
      const blob = await redis(v, ["GET", `v:${id}`]);
      return typeof blob === "string" ? send(res, 200, { blob }) : send(res, 404, { code: "not_found" });
    }
    const { id, blob } = await readBody(req, 100_000);
    if (typeof id !== "string" || !ID.test(id) || typeof blob !== "string" || !BLOB.test(blob)) return send(res, 400, { code: "invalid_request" });
    // SET NX: only the first verdict for a conversation is kept; everyone after gets that one.
    const saved = await redis(v, ["SET", `v:${id}`, blob, "NX", "EX", KEEP_SECONDS]);
    if (saved === "OK") return send(res, 200, { blob });
    const first = await redis(v, ["GET", `v:${id}`]);
    return send(res, 200, { blob: typeof first === "string" ? first : blob });
  } catch (err) {
    if (typeof err?.code === "string") return send(res, err.status || 500, { code: err.code });
    console.error("vault error", err?.name || "error");
    return send(res, 502, { code: "vault_error" });
  }
}
