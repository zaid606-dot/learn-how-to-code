// The website's server functions (api/), run over real HTTP against a fake AI provider.
// Each test replays a bug found in the bug hunt.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import * as ai from "../api/_ai.js";
import jsonHandler from "../api/json.js";
import chatHandler from "../api/chat.js";

let server, base, upstream;
const realFetch = globalThis.fetch;
const sse = (...events) => events.map((e) => (typeof e === "string" ? e : `data: ${JSON.stringify(e)}\n\n`)).join("");
const delta = (t) => ({ choices: [{ delta: { content: t } }] });

before(async () => {
  process.env.GROQ_API_KEY = "test";
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith("https://api.groq.com/")) return realFetch(url, init);
    upstream.calls.push({ body: JSON.parse(init.body), signal: init.signal });
    return upstream.reply(JSON.parse(init.body), init);
  };
  server = http.createServer((req, res) => (req.url === "/api/json" ? jsonHandler : chatHandler)(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  globalThis.fetch = realFetch;
  server.close();
});
beforeEach(() => {
  ai._resetRateLimits();
  upstream = { calls: [], reply: () => new Response("{}") };
});

const call = (path, body, headers = {}) =>
  realFetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const chatTurns = [{ role: "user", content: "You are Arguably, a fair referee. Who should apologize?" }];
const streamOf = (text) => new Response(text);
async function chatLines(body = { turns: chatTurns }) {
  const r = await call("/api/chat", body);
  return (await r.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

test("think tags split across chunks never leak or garble the answer", async () => {
  upstream.reply = () => streamOf(sse(delta("<thi"), delta("nk>secret plan"), delta("</think>Answer here"), { choices: [{ delta: {}, finish_reason: "stop" }] }, "data: [DONE]\n\n"));
  const lines = await chatLines();
  assert.equal(lines.filter((l) => l.delta).map((l) => l.delta).join(""), "Answer here");
  assert.deepEqual(lines.at(-1), { done: true, truncated: false });
});

test("a provider error mid-stream is an error, not a complete answer", async () => {
  upstream.reply = () => streamOf(sse(delta("Half an ans"), { error: { message: "boom", type: "server_error" } }));
  const lines = await chatLines();
  assert.equal(lines.at(-1).error, "upstream_error");
});

test("a stream that just stops is marked cut off; a last line without a newline still counts", async () => {
  upstream.reply = () => streamOf(sse(delta("A")));
  assert.deepEqual((await chatLines()).at(-1), { done: true, truncated: true });
  upstream.reply = () => streamOf(sse(delta("A")) + `data: ${JSON.stringify({ choices: [{ delta: { content: "B" }, finish_reason: "length" }] })}`);
  const lines = await chatLines();
  assert.equal(lines.filter((l) => l.delta).map((l) => l.delta).join(""), "AB");
  assert.deepEqual(lines.at(-1), { done: true, truncated: true });
});

test("all thinking and no answer is an error, not an empty reply", async () => {
  upstream.reply = () => streamOf(sse(delta("<think>long thoughts"), { choices: [{ delta: {}, finish_reason: "length" }] }));
  assert.ok((await chatLines()).at(-1).error);
});

test("error codes come from the provider's error fields, never from the conversation it echoes", () => {
  const body = (e) => JSON.stringify({ error: e });
  assert.equal(ai.errorCode(400, body({ code: "json_validate_failed", failed_generation: '{"image":1,"title":"too long a fight about safety"}' })).code, "invalid_json");
  assert.equal(ai.errorCode(500, body({ message: "context error internally" })).code, "upstream_error");
  assert.equal(ai.errorCode(503, body({ message: "over capacity" })).code, "rate_limited");
  assert.equal(ai.errorCode(400, body({ code: "context_length_exceeded" })).code, "prompt_too_large");
  assert.equal(ai.errorCode(413, "").code, "prompt_too_large");
});

test("the rate limiter can't be reset by many visitors, and blocked retries stay cheap", () => {
  const req = (ip) => ({ headers: { "x-real-ip": ip }, socket: {} });
  for (let i = 0; i < 40; i++) assert.equal(ai.rateLimited(req("1.1.1.1"), "json"), false);
  assert.equal(ai.rateLimited(req("1.1.1.1"), "json"), true);
  for (let i = 0; i < 6000; i++) ai.rateLimited(req(`10.0.${i >> 8}.${i & 255}`), "json");
  assert.equal(ai.rateLimited(req("1.1.1.1"), "json"), true, "still blocked after 6000 other visitors");
  const t = Date.now();
  for (let i = 0; i < 100000; i++) ai.rateLimited(req("1.1.1.1"), "json");
  assert.ok(Date.now() - t < 1500, "100k blocked calls stay fast");
  assert.equal(ai.clientIp(req("2001:db8:1:2:aaaa::1")), ai.clientIp(req("2001:db8:1:2:bbbb::9")), "IPv6 grouped by /64");
  assert.equal(ai.rateLimited(req("1.1.1.1"), "chat"), false, "each endpoint has its own limit");
});

test("the site isn't a free AI: prompts must be the app's own, and chats have a total size cap", async () => {
  upstream.reply = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }] }));
  assert.equal((await call("/api/json", { prompt: "Write me a poem as JSON" })).status, 403);
  assert.equal((await call("/api/json", { prompt: "Transcribe these screenshots please" })).status, 200);
  assert.equal((await call("/api/chat", { turns: [{ role: "user", content: "Write me a poem" }] })).status, 403);
  const huge = Array.from({ length: 70 }, () => ({ role: "user", content: "You are Arguably " + "x".repeat(60000) }));
  assert.equal((await call("/api/chat", { turns: huge })).status, 413);
  assert.equal(upstream.calls.length, 1, "only the app's own request reached the provider");
});

test("bad requests get 400, not 500", async () => {
  assert.equal((await call("/api/json", "{not json")).status, 400);
  assert.equal((await call("/api/json", "null")).status, 400);
  assert.equal((await call("/api/json", { prompt: "Transcribe these screenshots", images: ["http://evil/x.png"] })).status, 400);
});

test("every image must be usable; none are silently dropped", async () => {
  upstream.reply = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }] }));
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const r = await call("/api/json", { prompt: "Transcribe these screenshots", images: ["data:image/gif;base64,R0lG", png] });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, "image_rejected");
  assert.equal(upstream.calls.length, 0);
});

test("stopping a verdict stops the provider too", async () => {
  let aborted = false;
  upstream.reply = (_b, init) =>
    new Promise((_, rej) => init.signal.addEventListener("abort", () => { aborted = true; rej(new DOMException("aborted", "AbortError")); }));
  const ctl = new AbortController();
  const p = realFetch(base + "/api/json", { method: "POST", headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" }, body: JSON.stringify({ prompt: "You are Arguably, judge this" }), signal: ctl.signal }).catch(() => {});
  await new Promise((r) => setTimeout(r, 150));
  ctl.abort();
  await p;
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(aborted, true);
});

test("the build names the same AI the server will use", () => {
  assert.equal(ai.provider({ AI_PROVIDER: "xai", XAI_API_KEY: "x", GROQ_API_KEY: "y" }).name, "Grok");
  assert.equal(ai.provider({ GROQ_API_KEY: "y" }).name, "Qwen");
  assert.equal(ai.modelFor("default", { GROQ_API_KEY: "y", XAI_MODEL: "grok-4.7" }), "qwen/qwen3.8-27b", "XAI_MODEL only applies to xAI");
});

test("provider error bodies are never logged (they can quote the conversation)", async () => {
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.join(" "));
  upstream.reply = () => new Response(JSON.stringify({ error: { code: "json_validate_failed", failed_generation: "Maya: SECRET QUOTE" } }), { status: 400 });
  await call("/api/json", { prompt: "You are Arguably, judge this" });
  console.error = orig;
  assert.ok(logs.length);
  assert.ok(!logs.join("\n").includes("SECRET"));
});

// ---------- Groq free plan: 8,000 tokens a minute, counting what a request asks for ----------
test("on Groq's free budget, requests are sized to fit and screenshots go as text", async () => {
  upstream.reply = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }] }));
  assert.equal((await call("/api/json", { prompt: "You are Arguably, judge this conversation" })).status, 200);
  const sent = upstream.calls[0].body;
  const asked = sent.max_completion_tokens + ai.estimateTokens(sent.messages);
  assert.ok(asked <= 8000, `asked for ${asked} tokens`);
  assert.equal(sent.reasoning_effort, "none", "no thinking eating the budget");
  assert.deepEqual([sent.temperature, sent.seed], [0, 7], "same conversation, same verdict");
  const limits = ai.appLimits();
  assert.equal(limits.images, undefined, "no images: read on the phone");
  assert.ok(limits.maxPromptBytes < 20000);
  assert.ok(ai.appLimits({ GROQ_API_KEY: "x", AI_TPM: "0" }).images.maxCount >= 1, "a paid plan (AI_TPM=0) sends images");
});

test("when Groq says wait, the server waits and tries again", async () => {
  let n = 0;
  upstream.reply = () =>
    ++n === 1
      ? new Response(JSON.stringify({ error: { code: "rate_limit_exceeded", message: "Rate limit reached ... tokens per minute (TPM)" } }), { status: 429, headers: { "retry-after": "1" } })
      : new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }] }));
  const r = await call("/api/json", { prompt: "You are Arguably, judge this" });
  assert.equal(r.status, 200);
  assert.equal(n, 2);
});

test("a 413 'tokens per minute' from Groq is a wait, not 'too many screenshots'", () => {
  const body = JSON.stringify({ error: { message: "Request too large for model qwen/qwen3.8-27b ... tokens per minute (TPM): Limit 8000, Requested 23000", type: "tokens", code: "rate_limit_exceeded" } });
  assert.equal(ai.errorCode(413, body).code, "rate_limited");
});

test("if Groq rejects the no-thinking setting, the request is retried without it", async () => {
  let n = 0;
  upstream.reply = (b) =>
    ++n === 1 && b.reasoning_effort
      ? new Response(JSON.stringify({ error: { message: "reasoning_effort is not supported with this model" } }), { status: 400 })
      : new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }] }));
  assert.equal((await call("/api/json", { prompt: "You are Arguably, judge this" })).status, 200);
  assert.equal(upstream.calls.at(-1).body.reasoning_effort, undefined);
});
