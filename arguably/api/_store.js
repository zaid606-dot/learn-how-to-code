// The site's storage. Two backends, same commands (a small Redis subset):
//   1. Upstash Redis over REST (Vercel Marketplace sets KV_REST_API_URL / KV_REST_API_TOKEN,
//      plain Upstash uses UPSTASH_REDIS_REST_URL / _TOKEN). Preferred: fast and atomic.
//   2. Vercel Blob (BLOB_READ_WRITE_TOKEN, set when a Blob store is connected to the project):
//      each key is one private JSON file. Good for a launch; switch to Upstash as usage grows.
// With neither, accounts and the verdict vault are off and the app keeps everything on the phone.
export function storeConfig(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return { kind: "redis", url: url.replace(/\/$/, ""), token };
  if (env.BLOB_READ_WRITE_TOKEN || blobImpl) return { kind: "blob" };
  return null;
}

// One command, e.g. redis(["GET", "key"]). Throws {status, code} on any failure.
export async function redis(command, cfg = storeConfig()) {
  if (!cfg) throw { status: 503, code: "storage_off" };
  if (cfg.kind === "blob") return blobCommand(command);
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

// ---------- Vercel Blob backend ----------
let blobImpl = null; // tests put a fake here
export const _setBlobImpl = (impl) => (blobImpl = impl);
async function blob() {
  if (!blobImpl) {
    try {
      blobImpl = await import("@vercel/blob");
    } catch {
      throw { status: 503, code: "storage_off" };
    }
  }
  return blobImpl;
}
// File names use only letters, digits, "-" and "_" (base64url), so no URL encoding can change them.
const pathOf = (key) => `kv/${Buffer.from(key).toString("base64url")}.json`;
const OPTS = { access: "private", addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 60 };

async function load(key) {
  const B = await blob();
  let got;
  try {
    got = await B.get(pathOf(key), { access: "private", useCache: false });
  } catch (err) {
    if (/not.?found|404/i.test(String(err?.name || err?.message || ""))) return null;
    throw { status: 503, code: "storage_error" };
  }
  if (!got) return null;
  let rec;
  try {
    rec = JSON.parse(await new Response(got.stream).text());
  } catch {
    return null;
  }
  if (rec?.exp && rec.exp <= Date.now()) {
    await remove(key).catch(() => {});
    return null;
  }
  return rec;
}
// Write a record. With nx, only if it doesn't exist yet (the store refuses to overwrite).
async function save(key, rec, nx = false) {
  const B = await blob();
  try {
    await B.put(pathOf(key), JSON.stringify(rec), { ...OPTS, allowOverwrite: !nx });
    return true;
  } catch (err) {
    if (nx) {
      // Refused because it exists, unless the existing one has expired: then replace it.
      const existing = await load(key);
      if (existing) return false;
      await B.put(pathOf(key), JSON.stringify(rec), { ...OPTS, allowOverwrite: true }).catch(() => {
        throw { status: 503, code: "storage_error" };
      });
      return true;
    }
    throw { status: 503, code: "storage_error" };
  }
}
async function remove(key) {
  const B = await blob();
  try {
    await B.del(pathOf(key));
  } catch {}
}

async function blobCommand([cmd, key, ...args]) {
  const rec = cmd === "SET" && args.includes("NX") ? null : await load(key);
  const exp = rec?.exp || 0;
  switch (cmd) {
    case "GET":
      return rec?.t === "s" ? rec.v : null;
    case "SET": {
      const ex = args.indexOf("EX");
      const next = { t: "s", v: String(args[0]), exp: ex > -1 ? Date.now() + Number(args[ex + 1]) * 1000 : 0 };
      return (await save(key, next, args.includes("NX"))) ? "OK" : null;
    }
    case "DEL":
      if (!rec) return 0;
      await remove(key);
      return 1;
    case "GETDEL":
      if (rec) await remove(key);
      return rec?.t === "s" ? rec.v : null;
    case "INCR": {
      const n = (Number(rec?.v) || 0) + 1;
      await save(key, { t: "s", v: String(n), exp });
      return n;
    }
    case "EXPIRE":
      if (!rec) return 0;
      await save(key, { ...rec, exp: Date.now() + Number(args[0]) * 1000 });
      return 1;
    case "SADD": {
      const set = new Set(rec?.t === "set" ? rec.v : []);
      const before = set.size;
      args.forEach((a) => set.add(String(a)));
      await save(key, { t: "set", v: [...set], exp });
      return set.size - before;
    }
    case "SMEMBERS":
      return rec?.t === "set" ? rec.v : [];
    case "SISMEMBER":
      return rec?.t === "set" && rec.v.includes(String(args[0])) ? 1 : 0;
    case "SREM": {
      if (rec?.t !== "set") return 0;
      const left = rec.v.filter((m) => !args.includes(m));
      if (left.length) await save(key, { ...rec, v: left });
      else await remove(key);
      return rec.v.length - left.length;
    }
    case "HSET": {
      const h = rec?.t === "hash" ? rec.v : {};
      for (let i = 0; i < args.length; i += 2) h[args[i]] = String(args[i + 1]);
      await save(key, { t: "hash", v: h, exp });
      return 1;
    }
    case "HGETALL":
      return rec?.t === "hash" ? Object.entries(rec.v).flat() : [];
    case "HEXISTS":
      return rec?.t === "hash" && Object.hasOwn(rec.v, args[0]) ? 1 : 0;
    case "HLEN":
      return rec?.t === "hash" ? Object.keys(rec.v).length : 0;
    case "HDEL": {
      if (rec?.t !== "hash") return 0;
      let n = 0;
      for (const f of args) if (Object.hasOwn(rec.v, f)) delete rec.v[f], n++;
      if (n) {
        if (Object.keys(rec.v).length) await save(key, rec);
        else await remove(key);
      }
      return n;
    }
    default:
      throw { status: 500, code: "storage_error" };
  }
}
