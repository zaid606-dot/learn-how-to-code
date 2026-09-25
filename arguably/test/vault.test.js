// The verdict vault: the first verdict saved for a conversation is the one everyone gets.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import handler, { vault } from "../api/verdicts.js";
import * as ai from "../api/_ai.js";

let server, base;
const realFetch = globalThis.fetch;
const store = new Map();
const redisCalls = [];
before(async () => {
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith("https://fake-redis.test")) return realFetch(url, init);
    const [cmd, key, value, nx] = JSON.parse(init.body);
    redisCalls.push(cmd);
    assert.equal(init.headers.Authorization, "Bearer tok");
    if (cmd === "GET") return Response.json({ result: store.get(key) ?? null });
    if (cmd === "SET") {
      if (nx === "NX" && store.has(key)) return Response.json({ result: null });
      store.set(key, value);
      return Response.json({ result: "OK" });
    }
    return Response.json({ error: "bad" }, { status: 400 });
  };
  server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  globalThis.fetch = realFetch;
  server.close();
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
});

const headers = { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" };
const put = (body) => realFetch(`${base}/api/verdicts`, { method: "POST", headers, body: JSON.stringify(body) });
const get = (id) => realFetch(`${base}/api/verdicts?id=${id}`, { headers });
const ID = "a".repeat(64);
const blobA = "A".repeat(200), blobB = "B".repeat(200);

test("without storage configured, the vault is simply off", async () => {
  assert.equal(vault({}), null);
  assert.equal((await get(ID)).status, 404);
});

test("first verdict wins: a later one for the same conversation gets the first back", async () => {
  process.env.KV_REST_API_URL = "https://fake-redis.test";
  process.env.KV_REST_API_TOKEN = "tok";
  ai._resetRateLimits();
  assert.equal((await get(ID)).status, 404, "not judged yet");
  assert.deepEqual(await (await put({ id: ID, blob: blobA })).json(), { blob: blobA });
  assert.deepEqual(await (await put({ id: ID, blob: blobB })).json(), { blob: blobA }, "never replaced");
  assert.deepEqual(await (await get(ID)).json(), { blob: blobA });
  assert.equal(store.get(`v:${ID}`), blobA);
});

test("bad ids, bad blobs and other sites are turned away", async () => {
  process.env.KV_REST_API_URL = "https://fake-redis.test";
  process.env.KV_REST_API_TOKEN = "tok";
  ai._resetRateLimits();
  const n = redisCalls.length;
  assert.equal((await get("../../etc")).status, 400);
  assert.equal((await put({ id: "x", blob: blobA })).status, 400);
  assert.equal((await put({ id: ID, blob: "<script>" })).status, 400);
  const foreign = await realFetch(`${base}/api/verdicts?id=${ID}`, { headers: { "Sec-Fetch-Site": "cross-site" } });
  assert.equal(foreign.status, 403);
  assert.equal(redisCalls.length, n, "none of those reached storage");
});
