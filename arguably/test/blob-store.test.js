// Accounts, sync and the verdict vault running on the Vercel Blob backend (a faithful fake of
// @vercel/blob: private files, put refuses to overwrite unless allowOverwrite, get/del).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { _setBlobImpl, storeConfig, redis } from "../api/_store.js";
import authHandler from "../api/auth.js";
import syncHandler from "../api/sync.js";
import vaultHandler from "../api/verdicts.js";
import * as ai from "../api/_ai.js";

const files = new Map();
const calls = { put: 0, get: 0, del: 0 };
const fakeBlob = {
  async put(path, body, opts) {
    calls.put++;
    assert.equal(opts.access, "private");
    assert.equal(opts.addRandomSuffix, false);
    if (files.has(path) && !opts.allowOverwrite) throw Object.assign(new Error("This blob already exists"), { name: "BlobError" });
    files.set(path, String(body));
    return { pathname: path };
  },
  async get(path, opts) {
    calls.get++;
    assert.equal(opts.useCache, false, "always a consistent read");
    if (!files.has(path)) return null;
    return { stream: new Blob([files.get(path)]).stream(), blob: { pathname: path } };
  },
  async del(path) {
    calls.del++;
    files.delete(path);
  },
};

let server, base;
before(async () => {
  for (const k of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) delete process.env[k];
  _setBlobImpl(fakeBlob);
  server = http.createServer((req, res) => (req.url.startsWith("/api/auth") ? authHandler : req.url.startsWith("/api/sync") ? syncHandler : vaultHandler)(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  _setBlobImpl(null);
  server.close();
});
function phone() {
  let cookie = "";
  return async (path, { method = "GET", body } = {}) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", ...(cookie ? { Cookie: cookie } : {}) }, body: body && JSON.stringify(body) });
    const set = r.headers.get("set-cookie");
    if (set) cookie = /Max-Age=0/.test(set) ? "" : set.split(";")[0];
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
}

test("the Blob backend is picked when there's no Redis, and speaks the same commands", async () => {
  assert.equal(storeConfig().kind, "blob");
  assert.equal(await redis(["SET", "k", "1", "NX", "EX", 60]), "OK");
  assert.equal(await redis(["SET", "k", "2", "NX"]), null, "NX refuses an existing key");
  assert.equal(await redis(["INCR", "k"]), 2);
  assert.equal(await redis(["GETDEL", "k"]), "2");
  assert.equal(await redis(["GET", "k"]), null);
  await redis(["SET", "short", "x", "EX", 1]);
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(await redis(["GET", "short"]), null, "expired");
  assert.equal(await redis(["SET", "short", "y", "NX"]), "OK", "an expired key can be claimed again");
  await redis(["HSET", "h", "a", "1", "b", "2"]);
  assert.deepEqual(await redis(["HGETALL", "h"]), ["a", "1", "b", "2"]);
  assert.equal(await redis(["HDEL", "h", "a", "zz"]), 1);
  assert.equal(await redis(["HLEN", "h"]), 1);
  await redis(["SADD", "s", "x", "y"]);
  assert.equal(await redis(["SISMEMBER", "s", "y"]), 1);
  await redis(["SREM", "s", "x", "y"]);
  assert.deepEqual(await redis(["SMEMBERS", "s"]), []);
  assert.ok([...files.keys()].every((p) => p.startsWith("kv/")));
});

test("accounts and sync work end to end on Blob", async () => {
  ai._resetRateLimits();
  const a = phone(), b = phone();
  const r = await a("/api/auth?op=signup", { method: "POST", body: { email: "sam@example.com", password: "leftovers forever" } });
  assert.equal(r.status, 200);
  assert.ok(r.data.recoveryCode);
  assert.equal((await b("/api/auth?op=signup", { method: "POST", body: { email: "sam@example.com", password: "another one 1" } })).data.code, "email_taken");
  await a("/api/sync", { method: "PUT", body: { chat: { id: "c1", title: "Leftovers", updatedAt: 1, messages: [] } } });
  assert.equal((await b("/api/auth?op=login", { method: "POST", body: { email: "sam@example.com", password: "leftovers forever" } })).status, 200);
  assert.equal((await b("/api/sync")).data.chats[0].title, "Leftovers");
  await b("/api/sync?id=c1", { method: "DELETE" });
  assert.equal((await a("/api/sync", { method: "PUT", body: { chat: { id: "c1", messages: [] } } })).status, 410);
  assert.equal((await a("/api/auth?op=delete", { method: "POST", body: { password: "leftovers forever" } })).status, 200);
  assert.deepEqual([...files.keys()].filter((p) => /kv\/(user|chats|session|deleted|prefs)/.test(p)), [], "account erased");
});

test("the verdict vault keeps the first verdict on Blob", async () => {
  ai._resetRateLimits();
  const p = phone();
  const id = "b".repeat(64);
  assert.equal((await p(`/api/verdicts?id=${id}`)).status, 404);
  assert.equal((await p("/api/verdicts", { method: "POST", body: { id, blob: "A".repeat(100) } })).data.blob, "A".repeat(100));
  assert.equal((await p("/api/verdicts", { method: "POST", body: { id, blob: "B".repeat(100) } })).data.blob, "A".repeat(100));
});
