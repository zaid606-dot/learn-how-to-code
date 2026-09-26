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
// Plain values live in one file per key. Each hash field and each set member is its own file,
// so two requests changing different fields (two chats, two sessions) never overwrite each other.
const b64 = (x) => Buffer.from(String(x)).toString("base64url");
const unb64 = (x) => Buffer.from(x, "base64url").toString();
const pathOf = (key) => `kv/${b64(key)}.json`;
const fieldDir = (kind, key) => `kv/${kind}/${b64(key)}/`;
const fieldPath = (kind, key, field) => `${fieldDir(kind, key)}${b64(field)}.json`;
const OPTS = { access: "private", addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 60 };

const notFound = (err) => /not.?found|404/i.test(`${err?.name || ""} ${err?.message || ""} ${err?.status || ""}`);
async function readFile(path) {
  const B = await blob();
  let got;
  try {
    got = await B.get(path, { access: "private", useCache: false });
  } catch (err) {
    if (notFound(err)) return null;
    throw { status: 503, code: "storage_error" };
  }
  if (!got) return null;
  try {
    return JSON.parse(await new Response(got.stream).text());
  } catch {
    return null;
  }
}
async function writeFile(path, value, overwrite = true) {
  const B = await blob();
  try {
    await B.put(path, JSON.stringify(value), { ...OPTS, allowOverwrite: overwrite });
    return true;
  } catch (err) {
    if (!overwrite) return false; // refused: it already exists
    throw { status: 503, code: "storage_error" };
  }
}
async function removeFiles(paths) {
  if (!paths.length) return;
  const B = await blob();
  try {
    await B.del(paths);
  } catch {}
}
// Every file under a folder (paged).
async function listDir(dir) {
  const B = await blob();
  const out = [];
  let cursor;
  do {
    let page;
    try {
      page = await B.list({ prefix: dir, cursor, limit: 1000 });
    } catch {
      throw { status: 503, code: "storage_error" };
    }
    out.push(...page.blobs.map((b) => b.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}
const nameOf = (path, dir) => unb64(path.slice(dir.length).replace(/\.json$/, ""));

async function load(key) {
  const rec = await readFile(pathOf(key));
  if (rec?.exp && rec.exp <= Date.now()) {
    await removeFiles([pathOf(key)]);
    return null;
  }
  return rec;
}
async function remove(key) {
  await removeFiles([pathOf(key)]);
}

// Hashes and sets saved by the first version were one file per key: split them up on first use.
const migrated = new Set();
async function migrate(key) {
  if (migrated.has(key)) return;
  const old = await readFile(pathOf(key));
  if (old?.t === "hash" && old.v && typeof old.v === "object") {
    await Promise.all(Object.entries(old.v).map(([f, v]) => writeFile(fieldPath("h", key, f), String(v), false)));
    await removeFiles([pathOf(key)]);
  } else if (old?.t === "set" && Array.isArray(old.v)) {
    await Promise.all(old.v.map((m) => writeFile(fieldPath("s", key, m), 1, false)));
    await removeFiles([pathOf(key)]);
  }
  migrated.add(key);
}
const FIELD_CMDS = new Set(["SADD", "SMEMBERS", "SISMEMBER", "SREM", "HSET", "HGETALL", "HEXISTS", "HLEN", "HDEL"]);

async function blobCommand([cmd, key, ...args]) {
  if (FIELD_CMDS.has(cmd)) await migrate(key);
  switch (cmd) {
    case "GET": {
      const rec = await load(key);
      return rec?.t === "s" ? rec.v : null;
    }
    case "SET": {
      const ex = args.indexOf("EX");
      const next = { t: "s", v: String(args[0]), exp: ex > -1 ? Date.now() + Number(args[ex + 1]) * 1000 : 0 };
      if (!args.includes("NX")) return (await writeFile(pathOf(key), next)) ? "OK" : null;
      if (await writeFile(pathOf(key), next, false)) return "OK";
      // Refused because it exists, unless the existing one has expired: then it can be claimed.
      if (await load(key)) return null;
      return (await writeFile(pathOf(key), next, false)) ? "OK" : null;
    }
    case "DEL": {
      const [hashes, sets] = await Promise.all([listDir(fieldDir("h", key)), listDir(fieldDir("s", key))]);
      await removeFiles([pathOf(key), ...hashes, ...sets]);
      return 1;
    }
    case "GETDEL": {
      const rec = await load(key);
      if (rec) await remove(key);
      return rec?.t === "s" ? rec.v : null;
    }
    case "INCR": {
      const rec = await load(key);
      const n = (Number(rec?.v) || 0) + 1;
      await writeFile(pathOf(key), { t: "s", v: String(n), exp: rec?.exp || 0 });
      return n;
    }
    case "EXPIRE": {
      const rec = await load(key);
      if (!rec) return 0;
      await writeFile(pathOf(key), { ...rec, exp: Date.now() + Number(args[0]) * 1000 });
      return 1;
    }
    case "SADD":
      await Promise.all(args.map((m) => writeFile(fieldPath("s", key, m), 1)));
      return args.length;
    case "SMEMBERS": {
      const dir = fieldDir("s", key);
      return (await listDir(dir)).map((p) => nameOf(p, dir));
    }
    case "SISMEMBER":
      return (await readFile(fieldPath("s", key, args[0]))) === null ? 0 : 1;
    case "SREM":
      await removeFiles(args.map((m) => fieldPath("s", key, m)));
      return args.length;
    case "HSET": {
      const writes = [];
      for (let i = 0; i < args.length; i += 2) writes.push(writeFile(fieldPath("h", key, args[i]), String(args[i + 1])));
      await Promise.all(writes);
      return 1;
    }
    case "HGETALL": {
      const dir = fieldDir("h", key);
      const paths = await listDir(dir);
      const values = await Promise.all(paths.map((p) => readFile(p)));
      return paths.flatMap((p, i) => (typeof values[i] === "string" ? [nameOf(p, dir), values[i]] : []));
    }
    case "HEXISTS":
      return (await readFile(fieldPath("h", key, args[0]))) === null ? 0 : 1;
    case "HLEN":
      return (await listDir(fieldDir("h", key))).length;
    case "HDEL": {
      const present = await Promise.all(args.map((f) => readFile(fieldPath("h", key, f))));
      const gone = args.filter((_, i) => present[i] !== null);
      await removeFiles(gone.map((f) => fieldPath("h", key, f)));
      return gone.length;
    }
    default:
      throw { status: 500, code: "storage_error" };
  }
}

// ---------- cleanup (Blob only: Redis deletes expired keys by itself) ----------
// Records saved with an expiry (sign-ins, lockout counters, reset links, reports) are
// deleted when read after they expire, but ones never read again would stay forever.
// The daily cron (api/cleanup.js) sweeps them. Each kind is listed on its own, by the start
// of its file name, so saved chats and accounts are never even looked at.
const EXPIRING = [
  { prefix: "fail:", ttl: 900 },
  { prefix: "reset:", ttl: 3600 },
  { prefix: "session:", ttl: 60 * 86400 },
  { prefix: "report:", ttl: 180 * 86400 },
];
// A file-name prefix that every key starting with `text` shares (base64 works in 3-byte groups).
const b64Prefix = (text) => b64(text.slice(0, Math.floor(text.length / 3) * 3));
export async function sweepExpired({ maxReads = 800, now = Date.now() } = {}) {
  const cfg = storeConfig();
  if (cfg?.kind !== "blob") return { checked: 0, removed: 0, skipped: "not_blob" };
  let checked = 0;
  const gone = [];
  for (const { prefix, ttl } of EXPIRING) {
    const paths = (await listDir(`kv/${b64Prefix(prefix)}`)).filter((p) => /^kv\/[A-Za-z0-9_-]+\.json$/.test(p));
    for (const path of paths) {
      if (checked >= maxReads) break;
      if (!nameOf(path, "kv/").startsWith(prefix)) continue;
      checked++;
      const rec = await readFile(path);
      if (rec?.exp && rec.exp <= now) gone.push(path);
    }
  }
  for (let i = 0; i < gone.length; i += 100) await removeFiles(gone.slice(i, i + 100));
  return { checked, removed: gone.length, more: checked >= maxReads };
}
