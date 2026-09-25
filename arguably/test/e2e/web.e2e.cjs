// End-to-end test of the standalone website build (Vercel): the real api/ functions run
// in this process against a fake xAI API, and a phone-sized browser uses the site.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { chromium, devices, makeFixtures, layoutProblems, ROOT, OUT } = require("./harness.cjs");

const WEB = path.join(ROOT, "web-dist");
let browser, fixtures, server, url, handlers;
const xaiCalls = [];

// Fake xAI: reading requests get a transcript, verdict requests the sample verdict, chat streams.
const realFetch = globalThis.fetch;
async function fakeXai(input, init) {
  if (!String(input).startsWith("https://api.groq.com/")) return realFetch(input, init);
  const body = JSON.parse(init.body);
  const prompt = typeof body.messages[0].content === "string" ? body.messages.at(-1).content : body.messages[0].content[0].text;
  const images = Array.isArray(body.messages[0].content) ? body.messages[0].content.filter((c) => c.type === "image_url").length : 0;
  xaiCalls.push({ model: body.model, stream: !!body.stream, images, auth: init.headers.Authorization, prompt });
  if (body.stream) {
    const chunks = ["<think>private reasoning", "</think>Jordan should answer ", "the question first."].map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
    chunks.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    return new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(new TextEncoder().encode(x))); c.close(); } }), { status: 200 });
  }
  let out;
  if (prompt.startsWith("Transcribe")) {
    const labels = prompt.split("Images in this batch:\n")[1].trim().split("\n");
    out = { images: labels.map((_, i) => ({ image: i + 1, app: "iMessage", header_name: "Jordan" })), messages: [
      { image: 1, side: "right", sender_label: "", text: "So you were 'asleep' but liking Brianna's pics at 2am?", time: "", kind: "text", partial: false, y: 20 },
      { image: 1, side: "left", sender_label: "", text: "You literally left me on read for 6 hours yesterday", time: "", kind: "text", partial: false, y: 30 },
    ] };
  } else {
    const { sampleVerdict } = await import(path.join(ROOT, "src/sample.js"));
    out = sampleVerdict;
  }
  return new Response(JSON.stringify({ choices: [{ message: { content: "<think>hmm</think>```json\n" + JSON.stringify(out) + "\n```" }, finish_reason: "stop" }] }), { status: 200 });
}

before(async () => {
  execSync("node scripts/build-artifact.mjs --web", { cwd: ROOT, stdio: "pipe" });
  process.env.GROQ_API_KEY = "test-key";
  globalThis.fetch = fakeXai;
  handlers = {
    "/api/json": (await import(path.join(ROOT, "api/json.js"))).default,
    "/api/chat": (await import(path.join(ROOT, "api/chat.js"))).default,
  };
  server = http.createServer((req, res) => {
    const p = new URL(req.url, "http://x").pathname;
    if (handlers[p]) return handlers[p](req, res);
    const file = path.join(WEB, p === "/" ? "index.html" : path.normalize(p));
    if (!file.startsWith(WEB) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
    const type = file.endsWith(".html") ? "text/html" : file.endsWith(".js") ? "text/javascript" : file.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
    res.setHeader("Content-Type", type);
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
  fixtures = await makeFixtures(browser);
});
after(async () => {
  globalThis.fetch = realFetch;
  await browser?.close();
  server?.close();
});

test("website build: no Claude account, Groq via the site's own API, full flow works", async () => {
  const context = await browser.newContext(devices["iPhone 13"]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  // First run: onboarding names Grok and xAI in the consent step.
  await page.click('[data-action="next"]');
  assert.match(await page.locator(".ob-fine").innerText(), /Qwen, an AI by Alibaba, running on Groq/);
  await page.click('[data-action="consent-next"]');
  await page.click('.onboard [data-action="example"]');
  await page.click("#backBtn");
  assert.equal(await page.locator(".notice:visible").count(), 0, "no 'sign in to claude.ai' notice");
  // Screenshots -> who's who -> verdict, all through /api.
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click('#thread [data-action="import"]')]);
  await chooser.setFiles([fixtures.mayaPhone]);
  await page.click("#sendBtn");
  await page.waitForSelector(".msg.who:not(.done)", { timeout: 20000 });
  await page.click("[data-confirm]");
  await page.waitForSelector(".msg.verdict", { timeout: 20000 });
  // Follow-up streams back.
  await page.locator("#suggestions [data-say]").first().click();
  await page.waitForFunction(() => document.querySelector(".msg.reply")?.innerText.includes("answer the question first"), null, { timeout: 20000 });
  await page.screenshot({ path: path.join(OUT, "web-verdict.png") });
  assert.doesNotMatch(await page.locator(".msg.reply").last().innerText(), /think|private reasoning/);
  assert.deepEqual(await layoutProblems(page), []);
  assert.ok(xaiCalls.some((c) => c.images > 0), "screenshots were sent as images");
  assert.ok(xaiCalls.some((c) => c.stream), "follow-up streamed");
  assert.ok(xaiCalls.every((c) => c.auth === "Bearer test-key" && c.model === "qwen/qwen3.8-27b"));
  // No Claude wording anywhere a person reads.
  await page.click("#backBtn");
  await page.click("#settingsBtn");
  const settings = await page.locator(".settings").innerText();
  assert.doesNotMatch(settings, /Claude|Anthropic/);
  assert.match(settings, /Send chats to Qwen/);
  assert.deepEqual(errors, []);
  await context.close();
});

test("website API: the key never reaches the browser and other sites can't call it", async () => {
  const html = fs.readFileSync(path.join(WEB, "index.html"), "utf8");
  assert.doesNotMatch(html, /test-key|GROQ_API_KEY|XAI_API_KEY/);
  const r = await realFetch(url + "api/json", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify({ prompt: "hi" }) });
  assert.equal(r.status, 403);
  const noOrigin = await realFetch(url + "api/json", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "hi" }) });
  assert.equal(noOrigin.status, 403, "scripts without a browser origin are turned away");
  const bad = await realFetch(url + "api/json", { method: "GET" });
  assert.equal(bad.status, 405);
});
