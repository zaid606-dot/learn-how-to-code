// In-memory stand-in for Upstash Redis's REST API (the commands the site uses), with expiry.
function fakeRedis() {
  const data = new Map(); // key -> {v, exp}
  const calls = [];
  const live = (k) => {
    const e = data.get(k);
    if (e && e.exp && e.exp <= Date.now()) data.delete(k);
    return data.get(k);
  };
  const run = ([cmd, key, ...args]) => {
    calls.push(cmd);
    const e = live(key);
    switch (cmd) {
      case "GET": return e && typeof e.v === "string" ? e.v : null;
      case "SET": {
        const nx = args.includes("NX");
        if (nx && e) return null;
        const ex = args.indexOf("EX");
        data.set(key, { v: String(args[0]), exp: ex > -1 ? Date.now() + Number(args[ex + 1]) * 1000 : 0 });
        return "OK";
      }
      case "DEL": return data.delete(key) ? 1 : 0;
      case "GETDEL": { const v = e && typeof e.v === "string" ? e.v : null; data.delete(key); return v; }
      case "INCR": { const n = (Number(e?.v) || 0) + 1; data.set(key, { v: String(n), exp: e?.exp || 0 }); return n; }
      case "EXPIRE": if (e) e.exp = Date.now() + Number(args[0]) * 1000; return e ? 1 : 0;
      case "SADD": { const s = e?.v instanceof Set ? e.v : new Set(); args.forEach((a) => s.add(a)); data.set(key, { v: s, exp: 0 }); return 1; }
      case "SMEMBERS": return e?.v instanceof Set ? [...e.v] : [];
      case "SISMEMBER": return e?.v instanceof Set && e.v.has(args[0]) ? 1 : 0;
      case "SREM": if (e?.v instanceof Set) args.forEach((a) => e.v.delete(a)); return 1;
      case "HSET": { const h = e?.v instanceof Map ? e.v : new Map(); for (let i = 0; i < args.length; i += 2) h.set(args[i], String(args[i + 1])); data.set(key, { v: h, exp: 0 }); return 1; }
      case "HGETALL": return e?.v instanceof Map ? [...e.v].flat() : [];
      case "HDEL": return e?.v instanceof Map ? args.filter((a) => e.v.delete(a)).length : 0;
      case "HEXISTS": return e?.v instanceof Map && e.v.has(args[0]) ? 1 : 0;
      case "HLEN": return e?.v instanceof Map ? e.v.size : 0;
      default: throw new Error("fake redis: unsupported " + cmd);
    }
  };
  const handle = async (init) => {
    try {
      return Response.json({ result: run(JSON.parse(init.body)) });
    } catch (err) {
      return Response.json({ error: String(err.message) }, { status: 400 });
    }
  };
  return { data, calls, handle, keys: () => [...data.keys()] };
}
module.exports = { fakeRedis };
