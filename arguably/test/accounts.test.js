// Accounts and sync (api/auth.js, api/sync.js) over real HTTP, against an in-memory Redis.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import authHandler from "../api/auth.js";
import syncHandler from "../api/sync.js";
import * as ai from "../api/_ai.js";
import { hashPassword, checkPassword } from "../api/_auth.js";

const { fakeRedis } = createRequire(import.meta.url)("./e2e/fake-redis.cjs");
let server, base, redis, mail;
const realFetch = globalThis.fetch;
before(async () => {
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://fake-redis.test")) return redis.handle(init);
    if (String(url).startsWith("https://api.resend.com/")) {
      mail.push(JSON.parse(init.body));
      return Response.json({ id: "m1" });
    }
    return realFetch(url, init);
  };
  server = http.createServer((req, res) => (req.url.startsWith("/api/auth") ? authHandler : syncHandler)(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  globalThis.fetch = realFetch;
  server.close();
  for (const k of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "RESEND_API_KEY"]) delete process.env[k];
});
beforeEach(() => {
  process.env.KV_REST_API_URL = "https://fake-redis.test";
  process.env.KV_REST_API_TOKEN = "tok";
  process.env.RESEND_API_KEY = "re_test";
  redis = fakeRedis();
  mail = [];
  ai._resetRateLimits();
});

// A tiny cookie-keeping client, like one phone's browser.
function phone() {
  let cookie = "";
  const req = async (path, { method = "GET", body, headers = {} } = {}) => {
    const r = await realFetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get("set-cookie");
    if (set) cookie = /Max-Age=0/.test(set) ? "" : set.split(";")[0];
    return { status: r.status, data: await r.json().catch(() => ({})), setCookie: set };
  };
  return { req, get cookie() { return cookie; } };
}
const signup = (p, email = "maya@example.com", password = "correct horse") => p.req("/api/auth?op=signup", { method: "POST", body: { email, password } });

test("passwords are hashed with a salt and checked in constant time", () => {
  const h = hashPassword("hunter2hunter2");
  assert.match(h, /^scrypt\$/);
  assert.notEqual(h, hashPassword("hunter2hunter2"), "salted");
  assert.equal(checkPassword("hunter2hunter2", h), true);
  assert.equal(checkPassword("hunter2hunter3", h), false);
  assert.equal(checkPassword("x", "garbage"), false);
});

test("without storage, accounts are off and the app is told so", async () => {
  delete process.env.KV_REST_API_URL;
  const p = phone();
  assert.deepEqual((await p.req("/api/auth?op=me")).data, { accounts: false, user: null });
  assert.equal((await signup(p)).status, 503);
});

test("sign up: session cookie is HttpOnly and Lax; nothing sensitive is stored in the clear", async () => {
  const p = phone();
  const r = await signup(p, "  Maya@Example.com ");
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.data.user).sort(), ["createdAt", "email", "name"]);
  assert.equal(r.data.user.email, "maya@example.com", "normalized");
  assert.match(r.setCookie, /HttpOnly/);
  assert.match(r.setCookie, /SameSite=Lax/);
  const me = await p.req("/api/auth?op=me");
  assert.equal(me.data.user.email, "maya@example.com");
  const dump = JSON.stringify([...redis.data].map(([k, e]) => [k, e.v instanceof Set ? [...e.v] : e.v]));
  assert.doesNotMatch(dump, /correct horse/, "no plain password");
  assert.ok(!dump.includes(p.cookie.split("=")[1]), "no plain session token");
});

test("sign up rejects bad emails, short passwords and taken emails", async () => {
  const p = phone();
  assert.equal((await signup(p, "not-an-email")).data.code, "email_invalid");
  assert.equal((await signup(p, "a@b.co", "short")).data.code, "password_short");
  assert.equal((await signup(p, "a@b.co", "x".repeat(201))).data.code, "password_long");
  assert.equal((await signup(p)).status, 200);
  const r = await signup(phone(), "MAYA@example.com");
  assert.equal(r.status, 409);
  assert.equal(r.data.code, "email_taken");
});

test("sign in: same answer for unknown email and wrong password; locks after 10 misses", async () => {
  await signup(phone());
  const p = phone();
  const unknown = await p.req("/api/auth?op=login", { method: "POST", body: { email: "nobody@example.com", password: "whatever1" } });
  const wrong = await p.req("/api/auth?op=login", { method: "POST", body: { email: "maya@example.com", password: "wrong pass" } });
  assert.deepEqual([unknown.status, unknown.data], [wrong.status, wrong.data]);
  for (let i = 0; i < 9; i++) await p.req("/api/auth?op=login", { method: "POST", body: { email: "maya@example.com", password: "wrong pass" } });
  const locked = await p.req("/api/auth?op=login", { method: "POST", body: { email: "maya@example.com", password: "correct horse" } });
  assert.equal(locked.data.code, "too_many_attempts", "even the right password waits");
  for (const k of redis.keys()) if (k.startsWith("fail:")) redis.data.delete(k);
  const ok = await p.req("/api/auth?op=login", { method: "POST", body: { email: "Maya@Example.com", password: "correct horse" } });
  assert.equal(ok.status, 200);
});

test("sync: chats saved on one phone appear on another; only the owner can see them", async () => {
  const a = phone();
  await signup(a);
  const chat = { id: "c1", title: "The 2 a.m. Like", updatedAt: 5, messages: [{ role: "user", text: "hi" }] };
  assert.equal((await a.req("/api/sync", { method: "PUT", body: { chat } })).status, 200);
  assert.equal((await a.req("/api/sync", { method: "PUT", body: { prefs: { name: "Maya", tone: "gentle", notify: { tips: false }, evil: 1 } } })).status, 200);
  const b = phone();
  assert.equal((await b.req("/api/sync")).status, 401, "signed out");
  await b.req("/api/auth?op=login", { method: "POST", body: { email: "maya@example.com", password: "correct horse" } });
  const got = await b.req("/api/sync");
  assert.deepEqual(got.data.chats, [chat]);
  assert.deepEqual(got.data.prefs, { name: "Maya", tone: "gentle", notify: { tips: false } });
  // Someone else's account sees nothing of Maya's.
  const c = phone();
  await signup(c, "jordan@example.com");
  assert.deepEqual((await c.req("/api/sync")).data.chats, []);
  // Delete one, then all.
  await b.req("/api/sync?id=c1", { method: "DELETE" });
  assert.deepEqual((await a.req("/api/sync")).data.chats, []);
});

test("sync rejects malformed and oversized chats, and bad ids", async () => {
  const p = phone();
  await signup(p);
  assert.equal((await p.req("/api/sync", { method: "PUT", body: { chat: { id: "../x", messages: [] } } })).status, 400);
  assert.equal((await p.req("/api/sync", { method: "PUT", body: { chat: { id: "ok", messages: "no" } } })).status, 400);
  assert.equal((await p.req("/api/sync", { method: "PUT", body: { chat: { id: "big", messages: [{ text: "x".repeat(300_001) }] } } })).status, 413);
  assert.equal((await p.req("/api/sync?id=", { method: "DELETE" })).status, 400);
});

test("other sites can't use the account API", async () => {
  const p = phone();
  await signup(p);
  const cross = await p.req("/api/sync", { headers: { "Sec-Fetch-Site": "cross-site" } });
  assert.equal(cross.status, 403);
  const login = await p.req("/api/auth?op=login", { method: "POST", body: { email: "maya@example.com", password: "correct horse" }, headers: { "Sec-Fetch-Site": "cross-site" } });
  assert.equal(login.status, 403);
});

test("sign out ends only that session", async () => {
  const a = phone(), b = phone();
  await signup(a);
  await b.req("/api/auth?op=login", { method: "POST", body: { email: "maya@example.com", password: "correct horse" } });
  const old = a.cookie;
  await a.req("/api/auth?op=logout", { method: "POST", body: {} });
  assert.equal((await a.req("/api/auth?op=me")).data.user, null);
  const replay = await realFetch(base + "/api/auth?op=me", { headers: { Cookie: old, "Sec-Fetch-Site": "same-origin" } });
  assert.equal((await replay.json()).user, null, "the old cookie is dead");
  assert.equal((await b.req("/api/auth?op=me")).data.user.email, "maya@example.com", "the other phone stays signed in");
});

test("password reset: emails a one-time link, never says whether an account exists, signs out everywhere", async () => {
  const a = phone();
  await signup(a);
  const p = phone();
  const none = await p.req("/api/auth?op=reset-request", { method: "POST", body: { email: "nobody@example.com" } });
  const some = await p.req("/api/auth?op=reset-request", { method: "POST", body: { email: "maya@example.com" } });
  assert.deepEqual([none.status, none.data], [some.status, some.data]);
  assert.equal(mail.length, 1);
  const token = mail[0].text.match(/#reset=([A-Za-z0-9_-]+)/)[1];
  assert.equal((await p.req("/api/auth?op=reset", { method: "POST", body: { token, password: "short" } })).data.code, "password_short");
  assert.equal((await p.req("/api/auth?op=reset", { method: "POST", body: { token, password: "new password 1" } })).status, 200);
  assert.equal((await p.req("/api/auth?op=reset", { method: "POST", body: { token, password: "new password 2" } })).data.code, "reset_expired", "one use");
  assert.equal((await a.req("/api/auth?op=me")).data.user, null, "old sessions ended");
  assert.equal((await phone().req("/api/auth?op=login", { method: "POST", body: { email: "maya@example.com", password: "new password 1" } })).status, 200);
  assert.equal((await phone().req("/api/auth?op=reset", { method: "POST", body: { token: "made-up", password: "new password 3" } })).data.code, "reset_expired");
});

test("without an email service, reset says it's unavailable instead of pretending", async () => {
  delete process.env.RESEND_API_KEY;
  const r = await phone().req("/api/auth?op=reset-request", { method: "POST", body: { email: "maya@example.com" } });
  assert.equal(r.data.code, "reset_unavailable");
});

test("delete account: needs the password, then erases the account, chats, settings and every session", async () => {
  const a = phone(), b = phone();
  await signup(a);
  await b.req("/api/auth?op=login", { method: "POST", body: { email: "maya@example.com", password: "correct horse" } });
  await a.req("/api/sync", { method: "PUT", body: { chat: { id: "c1", messages: [] } } });
  await a.req("/api/sync", { method: "PUT", body: { prefs: { name: "Maya" } } });
  assert.equal((await a.req("/api/auth?op=delete", { method: "POST", body: { password: "nope nope" } })).data.code, "wrong_password");
  assert.equal((await a.req("/api/auth?op=delete", { method: "POST", body: { password: "correct horse" } })).status, 200);
  assert.deepEqual(redis.keys().filter((k) => !k.startsWith("fail:")), [], "nothing left");
  assert.equal((await b.req("/api/sync")).status, 401, "other phone signed out");
  assert.equal((await signup(phone())).status, 200, "the email can be used again");
});

test("a chat deleted on one phone can't be brought back by another phone's old copy", async () => {
  const a = phone();
  await signup(a);
  await a.req("/api/sync", { method: "PUT", body: { chat: { id: "c1", messages: [] } } });
  await a.req("/api/sync", { method: "PUT", body: { chat: { id: "c2", messages: [] } } });
  await a.req("/api/sync?id=c1", { method: "DELETE" });
  const stale = await a.req("/api/sync", { method: "PUT", body: { chat: { id: "c1", messages: [{ text: "old copy" }] } } });
  assert.equal(stale.status, 410);
  await a.req("/api/sync?all=1", { method: "DELETE" });
  const got = await a.req("/api/sync");
  assert.deepEqual(got.data.chats, []);
  assert.deepEqual(got.data.deleted.sort(), ["c1", "c2"]);
});

test("a stranger's wrong guesses from another network don't lock the owner out", async () => {
  await signup(phone());
  const attacker = phone();
  for (let i = 0; i < 12; i++) await attacker.req("/api/auth?op=login", { method: "POST", body: { email: "maya@example.com", password: "guess guess" }, headers: { "X-Real-IP": "203.0.113.9" } });
  const blocked = await attacker.req("/api/auth?op=login", { method: "POST", body: { email: "maya@example.com", password: "correct horse" }, headers: { "X-Real-IP": "203.0.113.9" } });
  assert.equal(blocked.data.code, "too_many_attempts", "the guessing network is blocked");
  const owner = await phone().req("/api/auth?op=login", { method: "POST", body: { email: "maya@example.com", password: "correct horse" }, headers: { "X-Real-IP": "198.51.100.7" } });
  assert.equal(owner.status, 200, "the owner, elsewhere, still gets in");
  assert.ok(redis.keys().filter((k) => k.startsWith("fail:")).every((k) => redis.data.get(k).exp > 0), "every counter expires");
});

test("a new reset link cancels the old one, and the used one can't reset again", async () => {
  await signup(phone());
  const p = phone();
  await p.req("/api/auth?op=reset-request", { method: "POST", body: { email: "maya@example.com" } });
  await p.req("/api/auth?op=reset-request", { method: "POST", body: { email: "maya@example.com" } });
  const [first, second] = mail.map((m) => m.text.match(/#reset=([A-Za-z0-9_-]+)/)[1]);
  assert.equal((await p.req("/api/auth?op=reset", { method: "POST", body: { token: first, password: "attacker pw 1" } })).data.code, "reset_expired");
  assert.equal((await p.req("/api/auth?op=reset", { method: "POST", body: { token: second, password: "owner new pw" } })).status, 200);
  assert.ok(!redis.keys().some((k) => k.startsWith("reset:")), "no live reset links left");
});

test("reset links use the configured address, never a forwarded host header", async () => {
  process.env.APP_URL = "https://arguably.app";
  await signup(phone());
  await phone().req("/api/auth?op=reset-request", { method: "POST", body: { email: "maya@example.com" }, headers: { "X-Forwarded-Host": "evil.example" } });
  delete process.env.APP_URL;
  assert.match(mail[0].text, /https:\/\/arguably\.app\/#reset=/);
  assert.doesNotMatch(mail[0].text, /evil/);
});

test("wrong passwords on delete count toward the same limit", async () => {
  const p = phone();
  await signup(p);
  for (let i = 0; i < 10; i++) await p.req("/api/auth?op=delete", { method: "POST", body: { password: "guess guess" } });
  assert.equal((await p.req("/api/auth?op=delete", { method: "POST", body: { password: "correct horse" } })).data.code, "too_many_attempts");
});

test("junk requests: unknown ops, mangled cookies and made-up deletes are harmless", async () => {
  const p = phone();
  assert.equal((await p.req("/api/auth?op=whatever")).status, 404);
  const bad = await realFetch(base + "/api/auth?op=me", { headers: { Cookie: "arguably_session=%E0%A4%A", "Sec-Fetch-Site": "same-origin" } });
  assert.equal(bad.status, 200);
  await signup(p);
  for (let i = 0; i < 5; i++) await p.req(`/api/sync?id=nope${i}`, { method: "DELETE" });
  assert.deepEqual((await p.req("/api/sync")).data.deleted, [], "no tombstones for chats that never existed");
});
