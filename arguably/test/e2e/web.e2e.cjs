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
// Fake Upstash Redis for accounts and the verdict vault.
const { fakeRedis: makeRedis } = require("./fake-redis.cjs");
const store = makeRedis();
const redis = { get size() { return [...store.data.keys()].filter((k) => k.startsWith("v:")).length; }, values: () => [...store.data].filter(([k]) => k.startsWith("v:")).map(([, e]) => e.v) };
async function fakeXai(input, init) {
  if (String(input).startsWith("https://fake-redis.test")) return store.handle(init);
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
  execSync("node scripts/build-artifact.mjs --web", { cwd: ROOT, stdio: "pipe", env: { ...process.env, REVENUECAT_IOS_KEY: "appl_test" } });
  process.env.GROQ_API_KEY = "test-key";
  process.env.KV_REST_API_URL = "https://fake-redis.test";
  process.env.KV_REST_API_TOKEN = "tok";
  globalThis.fetch = fakeXai;
  handlers = {
    "/api/json": (await import(path.join(ROOT, "api/json.js"))).default,
    "/api/chat": (await import(path.join(ROOT, "api/chat.js"))).default,
    "/api/limits": (await import(path.join(ROOT, "api/limits.js"))).default,
    "/api/verdicts": (await import(path.join(ROOT, "api/verdicts.js"))).default,
    "/api/auth": (await import(path.join(ROOT, "api/auth.js"))).default,
    "/api/sync": (await import(path.join(ROOT, "api/sync.js"))).default,
    "/api/report": (await import(path.join(ROOT, "api/report.js"))).default,
  };
  server = http.createServer((req, res) => {
    const p = new URL(req.url, "http://x").pathname;
    if (handlers[p]) return handlers[p](req, res);
    const file = path.join(WEB, p === "/" || /^\/(privacy|terms|support)\/?$/.test(p) ? "index.html" : path.normalize(p)); // same rewrites as vercel.json
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
  await page.click("#obAgreeRow");
  await page.click('[data-action="consent-next"]');
  await page.click('.onboard [data-action="next"]');
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
  assert.ok(xaiCalls.every((c) => c.images === 0), "on Groq's free budget, screenshots are read on the phone and only text is sent");
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

test("website build: a shared link opens the full verdict for someone new, then brings them in", async () => {
  // The person sharing: build a link from a verdict, copied to the clipboard on a laptop.
  const sender = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await sender.grantPermissions(["clipboard-read", "clipboard-write"], { origin: url.slice(0, -1) });
  const a = await sender.newPage();
  await a.goto(url);
  const code = await a.evaluate(() => encodeVerdict(SAMPLE_VERDICT));
  assert.match(code, /^z[A-Za-z0-9_-]+$/, "compressed, URL-safe");
  assert.ok(code.length < 6000, `link is ${code.length} characters`);
  await a.evaluate(() => { shareFor = { verdict: SAMPLE_VERDICT, hide: true }; return shareLink(); });
  const copied = await a.evaluate(() => navigator.clipboard.readText());
  assert.ok(copied.startsWith(url + "#v=z"), "link copied");
  await sender.close();

  // Someone who has never used Arguably opens it on their phone.
  const context = await browser.newContext(devices["iPhone 13"]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(copied);
  await page.waitForSelector(".shared-banner");
  assert.equal(await page.locator(".winner-name").innerText(), "Person A", "names were hidden by the sender");
  assert.match(await page.locator(".winner-margin").innerText(), /Wins by 31 points/);
  assert.equal(await page.locator(".share-btn").count(), 0, "a shared verdict isn't re-shared from here");
  assert.ok(!requests.some((r) => /\/api\/(json|chat)/.test(r)), "opening a link never calls the AI");
  assert.ok(!requests.some((r) => r.includes("#v=") || r.includes(code.slice(0, 40))), "the verdict never reaches the server");
  assert.deepEqual(await layoutProblems(page), []);
  await page.screenshot({ path: path.join(OUT, "web-shared-link.png") });
  await page.click('[data-action="shared-start"]');
  await page.waitForSelector(".onboard");
  assert.equal(await page.evaluate(() => location.hash), "", "link cleared");
  // A broken link says so and leaves the app usable.
  await page.goto(url + "#v=zBROKEN");
  await page.waitForFunction(() => /didn't open/.test(document.body.innerText));
  assert.deepEqual(errors, []);
  await context.close();
});

test("website build: the same screenshots get the same verdict on a different phone, without asking the AI again", async () => {
  const phone = async () => {
    const context = await browser.newContext(devices["iPhone 13"]);
    await context.addInitScript(() => localStorage.setItem("arguably.prefs.v1", JSON.stringify({ onboarded: true, policy: { version: "2026-09-25.2", at: 1 }, aiConsent: true })));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    return { context, page, errors };
  };
  const judge = async (page, files) => {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click('#thread [data-action="import"]')]);
    await chooser.setFiles(files);
    await page.click("#sendBtn");
    await page.waitForSelector(".msg.who:not(.done)", { timeout: 30000 });
    await page.click("[data-confirm]");
    await page.waitForSelector(".msg.verdict", { timeout: 30000 });
    return { title: await page.locator(".v-title").innerText(), winner: await page.locator(".winner-name").innerText(), margin: await page.locator(".winner-margin").innerText(), reasoning: await page.locator(".winner-card p").innerText() };
  };
  const verdictCalls = () => xaiCalls.filter((c) => !c.stream && c.prompt.startsWith("You are Arguably")).length;
  const before = verdictCalls();

  const a = await phone();
  const first = await judge(a.page, [fixtures.mayaPhone, fixtures.jordanPhone]);
  assert.equal(verdictCalls(), before + 1, "judged once");
  assert.equal(redis.size >= 1, true, "locked in the vault");
  assert.ok(redis.values().every((v) => !/Maya|Jordan|2 a\.m/.test(v)), "the server only holds ciphertext");

  // A different phone, screenshots in the other order: the exact same verdict, no AI call.
  const b = await phone();
  const second = await judge(b.page, [fixtures.jordanPhone, fixtures.mayaPhone]);
  assert.deepEqual(second, first);
  assert.equal(verdictCalls(), before + 1, "the AI wasn't asked again");
  assert.ok(await b.page.locator(".msg.verdict .repeat").isVisible(), "labelled as judged before");
  assert.deepEqual([...a.errors, ...b.errors], []);
  await a.context.close();
  await b.context.close();
});

test("website build: accounts: sign up, chats sync to a second phone, deletes stick, sign out and delete account", async () => {
  const phone = async () => {
    const context = await browser.newContext(devices["iPhone 13"]);
    await context.addInitScript(() => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("arguably.prefs.v1", JSON.stringify({ onboarded: true, policy: { version: "2026-09-25.2", at: 1 }, aiConsent: true })); } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    return { context, page, errors };
  };
  const toAccount = async (page) => {
    await page.click("#settingsBtn");
    await page.waitForSelector('.settings [data-action="account"]');
    await page.click('.settings [data-action="account"]');
    await page.waitForSelector(".account");
  };
  const serverChats = () => [...store.data].filter(([k]) => k.startsWith("chats:")).flatMap(([, e]) => [...e.v.keys()]);

  // Phone A: get a verdict first, then create an account; the chat is saved to it.
  const a = await phone();
  await a.page.locator('#thread [data-action="paste"]').first().click();
  await a.page.fill("#messageInput", "Sam: you ate my leftovers again\nPriya: there wasn't a name on it\nSam: third time this month");
  await a.page.click("#sendBtn");
  await a.page.waitForSelector(".msg.verdict", { timeout: 30000 });
  await a.page.click("#backBtn");
  await toAccount(a.page);
  assert.equal(await a.page.locator(".page-title").innerText(), "Create your account");
  await a.page.click('.auth-form [type="submit"]');
  assert.match(await a.page.locator(".auth-error").innerText(), /email/i, "checked on the phone first");
  await a.page.fill("#acEmail", "sam@example.com");
  await a.page.fill("#acPassword", "short");
  await a.page.click('.auth-form [type="submit"]');
  assert.match(await a.page.locator(".auth-error").innerText(), /8 characters/);
  await a.page.fill("#acPassword", "leftovers forever");
  await a.page.screenshot({ path: path.join(OUT, "web-signup.png") });
  await a.page.click('.auth-form [type="submit"]');
  // First, the recovery code (shown once).
  await a.page.waitForSelector(".recovery-code");
  assert.match(await a.page.locator(".recovery-code").innerText(), /^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
  await a.page.screenshot({ path: path.join(OUT, "web-recovery-code.png") });
  await a.page.click('[data-action="code-saved"]');
  await a.page.waitForSelector('.settings [data-action="account"]');
  assert.match(await a.page.locator(".settings").innerText(), /sam@example\.com/);
  await a.page.waitForFunction(() => true);
  const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
  assert.ok(await until(() => serverChats().length === 1), "the chat reached the account");
  const cookies = await a.context.cookies();
  assert.ok(cookies.find((c) => c.name === "arguably_session")?.httpOnly, "session cookie is HttpOnly");
  assert.equal(await a.page.evaluate(() => document.cookie.includes("arguably_session")), false, "scripts can't read it");

  // Phone B: sign in, the chat shows up with its verdict.
  const b = await phone();
  await toAccount(b.page);
  await b.page.click('[data-auth-mode="login"]');
  assert.equal(await b.page.locator(".page-title").innerText(), "Welcome back");
  await b.page.fill("#acEmail", "sam@example.com");
  await b.page.fill("#acPassword", "wrong password");
  await b.page.click('.auth-form [type="submit"]');
  await b.page.waitForSelector(".auth-error");
  assert.match(await b.page.locator(".auth-error").innerText(), /don't match/);
  await b.page.fill("#acPassword", "leftovers forever");
  await b.page.click('.auth-form [type="submit"]');
  await b.page.waitForSelector('.settings [data-action="account"]');
  await b.page.click("#backBtn");
  await b.page.waitForSelector(".recent [data-chat]");
  await b.page.click(".recent [data-chat]");
  await b.page.waitForSelector(".msg.verdict");
  assert.match(await b.page.locator(".winner-name").innerText(), /\S/);

  // Phone B deletes it; after a reload, phone A doesn't have it either and doesn't bring it back.
  await b.page.click("#deleteBtn");
  await b.page.click("#deleteBtn");
  assert.ok(await until(() => serverChats().length === 0), "deleted in the account");
  await a.page.reload();
  await a.page.waitForTimeout(1500);
  await a.page.click("#homeBtn").catch(() => {});
  assert.equal(await a.page.locator(".recent [data-chat]").count(), 0, "gone on phone A too");
  assert.equal(serverChats().length, 0, "not uploaded back");

  // Sign out on A: its chats leave the phone. Delete the account on B.
  await toAccount(a.page);
  await a.page.click('[data-action="sign-out"]');
  await a.page.waitForFunction(() => !document.querySelector(".account"));
  assert.equal(await a.page.evaluate(() => JSON.parse(localStorage.getItem("arguably.chats.v2") || "[]").length), 0);
  await toAccount(b.page);
  await b.page.click('[data-action="delete-account"]');
  await b.page.fill("#acDeletePw", "not it at all");
  await b.page.click('.danger-zone [type="submit"]');
  await b.page.waitForSelector(".auth-error");
  await b.page.screenshot({ path: path.join(OUT, "web-delete-account.png") });
  await b.page.fill("#acDeletePw", "leftovers forever");
  await b.page.click('.danger-zone [type="submit"]');
  await b.page.waitForFunction(() => !document.querySelector(".account"));
  assert.deepEqual([...store.data.keys()].filter((k) => /^(user|chats|prefs|session|sessions|deleted):/.test(k)), [], "account erased from the server");
  assert.deepEqual([...a.errors, ...b.errors], []);
  await a.context.close();
  await b.context.close();
});

test("iPhone app (website inside the native shell): App Store mode, RevenueCat buy / cancel / restore / expiry, native share sheet", async () => {
  const context = await browser.newContext(devices["iPhone 13"]);
  await context.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("arguably.prefs.v1", JSON.stringify({ onboarded: true, policy: { version: "2026-09-25.2", at: 1 }, aiConsent: true }));
    }
    const pkg = (id) => ({ identifier: id.includes("yearly") ? "$rc_annual" : "$rc_monthly", product: { identifier: id, priceString: id.includes("yearly") ? "34,99 €" : "10,99 €", price: id.includes("yearly") ? 34.99 : 10.99 } });
    const state = (window.__rc = JSON.parse(sessionStorage.getItem("rc") || '{"calls":[],"active":null,"cancel":false,"restorable":null}'));
    const save = () => sessionStorage.setItem("rc", JSON.stringify(state));
    const info = () => ({ customerInfo: { entitlements: { active: state.active ? { pro: { productIdentifier: state.active, expirationDate: "2027-01-01T12:00:00Z", periodType: state.active.includes("yearly") ? "TRIAL" : "NORMAL" } } : {} } } });
    const call = (name, arg) => { state.calls.push([name, arg]); save(); };
    window.__share = [];
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        Purchases: {
          configure: async (o) => call("configure", o),
          getCustomerInfo: async () => (call("getCustomerInfo"), info()),
          getOfferings: async () => (call("getOfferings"), { current: { availablePackages: [pkg("arguably.pro.monthly"), pkg("arguably.pro.yearly")] } }),
          purchasePackage: async ({ aPackage }) => {
            call("purchasePackage", aPackage.product.identifier);
            if (state.cancel) throw Object.assign(new Error("Purchase was cancelled."), { code: "1", userCancelled: true });
            state.active = aPackage.product.identifier;
            save();
            return info();
          },
          restorePurchases: async () => { call("restorePurchases"); state.active = state.restorable; save(); return info(); },
        },
        Share: { share: async (o) => { window.__share.push(o); } },
        Filesystem: { writeFile: async ({ path }) => ({ uri: "file:///cache/" + path }) },
      },
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  const rc = () => page.evaluate(() => window.__rc);
  const pro = () => page.evaluate(() => JSON.parse(localStorage.getItem("arguably.prefs.v1")).pro);
  await page.waitForFunction(() => window.__rc.calls.some(([n]) => n === "getCustomerInfo"));
  assert.deepEqual((await rc()).calls[0], ["configure", { apiKey: "appl_test" }], "RevenueCat set up with the app's key");

  // App Store mode: the home screen offers the trial, Settings shows Arguably Pro.
  assert.match(await page.locator(".import-note").innerText(), /try Pro free for 3 days/);
  await page.click("#settingsBtn");
  await page.click('[data-action="paywall"]');
  await page.waitForSelector(".paywall");
  await page.waitForFunction(() => /34,99 €/.test(document.querySelector(".paywall").innerText));
  assert.match(await page.locator(".paywall").innerText(), /10,99 €[\s\S]*Save 73%|Save 73%[\s\S]*10,99 €/, "the App Store's own prices and the saving worked out from them");
  assert.match(await page.locator(".paywall").innerText(), /Terms of Use \(EULA\)/);
  await page.screenshot({ path: path.join(OUT, "ios-paywall.png") });

  // Cancel in Apple's sheet: nothing happens, no scary error.
  await page.evaluate(() => { window.__rc.cancel = true; sessionStorage.setItem("rc", JSON.stringify(window.__rc)); });
  await page.click(".pw-cta");
  await page.waitForFunction(() => window.__rc.calls.some(([n]) => n === "purchasePackage"));
  await page.waitForTimeout(300);
  assert.equal(await pro(), null);
  assert.equal(await page.locator("#toast:not([hidden])").count(), 0, "no error for a cancel");

  // Buy the yearly plan for real (through the plugin).
  await page.evaluate(() => { window.__rc.cancel = false; sessionStorage.setItem("rc", JSON.stringify(window.__rc)); });
  await page.click(".pw-cta");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("arguably.prefs.v1")).pro);
  assert.equal((await pro()).plan, "yearly");
  assert.deepEqual((await rc()).calls.filter(([n]) => n === "purchasePackage").map(([, id]) => id), ["arguably.pro.yearly", "arguably.pro.yearly"]);

  // In the trial, Settings says when it ends and what it costs after (read at launch).
  await page.reload();
  await page.click("#settingsBtn");
  assert.match(await page.locator(".settings").innerText(), /Free trial until January 1, then 34,99 €\/year unless canceled/);
  await page.click("#backBtn");
  // The subscription ends (cancelled in iPhone Settings): on next launch, Pro is gone.
  await page.evaluate(() => { window.__rc.active = null; sessionStorage.setItem("rc", JSON.stringify(window.__rc)); });
  await page.reload();
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem("arguably.prefs.v1")).pro);

  // Restore on a new phone: the monthly plan comes back.
  await page.evaluate(() => { window.__rc.restorable = "arguably.pro.monthly"; sessionStorage.setItem("rc", JSON.stringify(window.__rc)); });
  await page.click("#settingsBtn");
  await page.click('[data-action="paywall"]');
  await page.click('.paywall [data-action="restore"]');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("arguably.prefs.v1")).pro);
  assert.equal((await pro()).plan, "monthly");

  // Sharing uses the iPhone share sheet with the card as a file.
  await page.goto(url);
  await page.locator('#thread [data-action="example"]').first().click();
  await page.click(".share-btn");
  await page.waitForSelector(".share-preview img");
  await page.click('[data-action="share-image"]');
  await page.waitForFunction(() => window.__share.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__share[0].files), ["file:///cache/arguably-verdict.png"]);
  await page.click('[data-action="share-link"]');
  await page.waitForFunction(() => window.__share.length === 2);
  assert.match(await page.evaluate(() => window.__share[1].url), /#v=z/);
  assert.deepEqual(errors, []);
  await context.close();
});

test("website in a normal browser is not App Store mode", async () => {
  const context = await browser.newContext(devices["iPhone 13"]);
  await context.addInitScript(() => localStorage.setItem("arguably.prefs.v1", JSON.stringify({ onboarded: true, policy: { version: "2026-09-25.2", at: 1 } })));
  const page = await context.newPage();
  await page.goto(url);
  assert.doesNotMatch(await page.locator(".import-note").innerText(), /Pro/);
  await page.click("#settingsBtn");
  assert.equal(await page.locator('[data-action="paywall"]').count(), 0);
  await context.close();
});

test("website build: QA fixes — safe sign-out, offline deletes stick, reset links, browser Back", async () => {
  const context = await browser.newContext(devices["iPhone 13"]);
  await context.addInitScript(() => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("arguably.prefs.v1", JSON.stringify({ onboarded: true, policy: { version: "2026-09-25.2", at: 1 }, aiConsent: true })); } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  const serverChats = () => [...store.data].filter(([k]) => k.startsWith("chats:")).flatMap(([, e]) => [...e.v.keys()]);
  const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };

  // Browser Back from Settings comes back to the app's home, not off the site.
  await page.click("#settingsBtn");
  await page.goBack();
  await page.waitForSelector(".home");
  assert.ok(page.url().startsWith(url), "still on the site");

  // Sign up; typed email survives switching modes.
  await page.click("#settingsBtn");
  await page.click('.settings [data-action="account"]');
  await page.fill("#acEmail", "qa@example.com");
  await page.click('[data-auth-mode="login"]');
  assert.equal(await page.inputValue("#acEmail"), "qa@example.com");
  await page.click('[data-auth-mode="signup"]');
  await page.fill("#acPassword", "qa password 1");
  await page.click('.auth-form [type="submit"]');
  await page.waitForSelector(".recovery-code");
  const code = await page.locator(".recovery-code").innerText();
  await page.click('[data-action="code-saved"]');
  await page.waitForSelector('.settings [data-action="account"]');

  // A chat, then offline: signing out is refused while it isn't saved, nothing is lost.
  await page.click("#backBtn");
  await page.locator('#thread [data-action="paste"]').first().click();
  await context.route("**/api/sync**", (r) => r.abort());
  await page.fill("#messageInput", "Ana: you said 7\nBo: I said 8\nAna: you always do this");
  await page.click("#sendBtn");
  await page.waitForSelector(".msg.verdict", { timeout: 30000 });
  await page.click("#backBtn");
  await page.click("#settingsBtn");
  await page.click('.settings [data-action="account"]');
  await page.click('[data-action="sign-out"]');
  await page.waitForFunction(() => /haven't reached your account/.test(document.getElementById("toast").innerText));
  assert.ok(await page.locator(".account-card").isVisible(), "still signed in");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("arguably.chats.v2")).length), 1, "chat kept");

  // Delete it while offline: once back online it doesn't return from the account.
  await context.unroute("**/api/sync**");
  assert.ok(await until(() => serverChats().length === 1) || true);
  await page.evaluate(() => flushUploads());
  assert.ok(await until(() => serverChats().length === 1), "uploaded once online");
  await context.route("**/api/sync**", (r) => r.abort());
  await page.click("#backBtn");
  await page.click("#backBtn").catch(() => {});
  await page.click(".recent [data-chat]");
  await page.click("#deleteBtn");
  await page.click("#deleteBtn");
  await context.unroute("**/api/sync**");
  await page.reload();
  assert.ok(await until(() => serverChats().length === 0), "the offline delete was sent");
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".recent [data-chat]").count(), 0, "not brought back");

  // Sign out offline: refused (the session would survive); online: works.
  await page.click("#settingsBtn");
  await page.click('.settings [data-action="account"]');
  await context.route("**/api/auth?op=logout", (r) => r.abort());
  await page.click('[data-action="sign-out"]');
  await page.waitForFunction(() => /Couldn't sign out/.test(document.getElementById("toast").innerText));
  await context.unroute("**/api/auth?op=logout");
  await page.click('[data-action="sign-out"]');
  await page.waitForFunction(() => !document.querySelector(".account"));
  await page.reload();
  await page.click("#settingsBtn");
  assert.match(await page.locator(".settings").innerText(), /Create account or sign in/, "really signed out");

  // Forgot password, no email service: the recovery code gets you back in.
  await page.click('.settings [data-action="account"]');
  await page.click('[data-auth-mode="login"]');
  await page.click('[data-auth-mode="forgot"]');
  await page.click('[data-auth-mode="recover"]');
  await page.fill("#acEmail", "qa@example.com");
  await page.fill("#acCode", code.toLowerCase());
  await page.fill("#acPassword", "qa password 2");
  await page.click('.auth-form [type="submit"]');
  await page.waitForSelector(".recovery-code");
  assert.notEqual(await page.locator(".recovery-code").innerText(), code, "a fresh code");
  await page.click('[data-action="code-saved"]');
  await page.click('.settings [data-action="account"]');
  await page.click('[data-action="sign-out"]');
  await page.waitForFunction(() => !document.querySelector(".account"));

  // A reset link opened in an already-open tab goes straight to "choose a new password".
  await page.evaluate(() => { location.hash = "#reset=abc123"; });
  await page.waitForSelector(".account");
  assert.equal(await page.locator(".page-title").innerText(), "Choose a new password");
  assert.ok(await page.locator('[data-auth-mode="forgot"]').isVisible(), "a way out if the link expired");
  assert.deepEqual(errors, []);
  await context.close();
});

test("website build: public policy links (/privacy, /terms, /support) open for anyone, then back into the app", async () => {
  const context = await browser.newContext(devices["iPhone 13"]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const [route, title] of [["privacy", "Privacy Policy"], ["terms", "Terms of Use"], ["support", "Help & support"]]) {
    await page.goto(url + route);
    await page.waitForSelector(".doc .page-title");
    assert.equal(await page.locator(".doc .page-title").innerText(), title);
  }
  assert.match(await page.locator(".doc").innerText(), /Cancel a subscription[\s\S]*Restore a purchase[\s\S]*Delete your account/);
  await page.click("#backBtn");
  await page.waitForSelector(".onboard");
  assert.equal(new URL(page.url()).pathname, "/", "back at the app's own address");
  assert.deepEqual(errors, []);
  await context.close();
});

test("website build: a sample argument runs a real verdict, and a verdict can be reported in the app", async () => {
  const context = await browser.newContext(devices["iPhone 13"]);
  await context.addInitScript(() => localStorage.setItem("arguably.prefs.v1", JSON.stringify({ onboarded: true, policy: { version: "2026-09-25.2", at: 1 }, aiConsent: true })));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.locator('#thread [data-action="paste"]').first().click();
  await page.click('[data-action="sample-argument"]');
  assert.match(await page.inputValue("#messageInput"), /^Sam: did you eat my leftovers again\?/);
  await page.click("#sendBtn");
  await page.waitForSelector(".msg.verdict", { timeout: 30000 });
  await page.click(".v-foot [data-report]");
  assert.equal(await page.locator(".page-title").innerText(), "Report a verdict");
  await page.click('.auth-form [type="submit"]');
  await page.waitForSelector(".auth-error");
  await page.click('.report-opt:has(input[value="unfair"])');
  await page.fill("#reportDetails", "It ignored that I replaced the milk.");
  await page.click('.auth-form [type="submit"]');
  await page.waitForFunction(() => /Thanks for telling us/.test(document.body.innerText));
  const stored = [...store.data].filter(([k]) => k.startsWith("report:")).map(([, e]) => JSON.parse(e.v));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].reason, "unfair");
  assert.match(stored[0].details, /replaced the milk/);
  await page.click('[data-action="report-done"]');
  assert.ok(await page.locator(".msg.verdict").isVisible(), "back at the verdict");
  assert.deepEqual(errors, []);
  await context.close();
});

test("iPhone app: store outages say so, links leave the app, the paywall fits an iPhone SE", async () => {
  const context = await browser.newContext({ ...devices["iPhone SE"] });
  await context.addInitScript(() => {
    localStorage.setItem("arguably.prefs.v1", JSON.stringify({ onboarded: true, policy: { version: "2026-09-25.2", at: 1 }, aiConsent: true }));
    const down = async () => { await new Promise((r) => setTimeout(r, 200)); throw new Error("The Internet connection appears to be offline."); };
    const pkg = (id, price) => ({ identifier: id, product: { identifier: `arguably.pro.${id}`, priceString: `$${price}`, price } });
    window.__opened = [];
    window.open = (u) => window.__opened.push(["window", u]);
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        Purchases: {
          configure: async () => {},
          getCustomerInfo: async () => ({ customerInfo: { entitlements: { active: {} } } }),
          getOfferings: async () => ({ current: { availablePackages: [pkg("yearly", 29.99), pkg("monthly", 9.99)] } }),
          purchasePackage: down,
          restorePurchases: down,
          showManageSubscriptions: async () => window.__opened.push(["manage"]),
        },
        Browser: { open: async ({ url }) => window.__opened.push(["browser", url]) },
      },
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  assert.equal(await page.locator("#toast:not([hidden])").count(), 0, "no welcome toast over the first screen");
  await page.click("#settingsBtn");
  await page.click('[data-action="paywall"]');
  await page.waitForSelector('.pw-cta[data-action="purchase"]');
  const fit = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, cta: document.querySelector(".pw-cta").getBoundingClientRect().bottom }));
  assert.ok(fit.w <= 320, `no sideways scroll (${fit.w}px)`);
  assert.ok(fit.cta <= 568, `buy button on screen (${fit.cta}px)`);

  await page.click(".pw-cta");
  await page.waitForSelector("#toast:not([hidden])");
  assert.match(await page.locator("#toast").innerText(), /Couldn't reach the App Store/);
  assert.equal(await page.locator(".pw-cta").getAttribute("aria-busy"), null, "buy button usable again");
  await page.click('.paywall [data-action="restore"]');
  await page.waitForFunction(() => /Couldn't reach the App Store/.test(document.querySelector("#toast").innerText) && !/charged/.test(document.querySelector("#toast").innerText));

  await page.evaluate(() => {
    for (const [id, href] of [["ext", "https://example.com/help"], ["mng", "https://apps.apple.com/account/subscriptions"]]) {
      const a = Object.assign(document.createElement("a"), { id, href, target: "_blank", textContent: id });
      document.body.append(a);
    }
  });
  await page.click("#ext", { force: true });
  await page.click("#mng", { force: true });
  await page.waitForFunction(() => window.__opened.length === 2);
  assert.deepEqual(await page.evaluate(() => window.__opened), [["browser", "https://example.com/help"], ["manage"]]);
  assert.equal(new URL(page.url()).origin, new URL(url).origin, "the app itself never navigates away");
  assert.deepEqual(errors, []);
  await context.close();
});
