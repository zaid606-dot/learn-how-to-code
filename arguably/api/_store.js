// The site's storage: Upstash Redis over its REST API (Vercel Marketplace sets
// KV_REST_API_URL / KV_REST_API_TOKEN; plain Upstash uses UPSTASH_REDIS_REST_URL / _TOKEN).
// Without it, accounts and the verdict vault are off and the app keeps everything on the phone.
export function storeConfig(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

// One Redis command, e.g. redis(["GET", "key"]). Throws {status, code} on any failure.
export async function redis(command, cfg = storeConfig()) {
  if (!cfg) throw { status: 503, code: "storage_off" };
  let res;
  try {
    res = await fetch(cfg.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw { status: 503, code: "storage_error" };
  }
  if (!res.ok) throw { status: 503, code: "storage_error" };
  const data = await res.json().catch(() => null);
  if (!data || data.error) throw { status: 503, code: "storage_error" };
  return data.result ?? null;
}
