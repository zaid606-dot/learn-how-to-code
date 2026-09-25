// End-to-end tests for the Artifact build. Run: npm run test:e2e
// Needs vendor/ocr (scripts/fetch-ocr.sh) and Playwright with Chromium.
const { test, before, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium, devices, build, serve, makeFixtures, layoutProblems, OUT } = require("./harness.cjs");

let browser;
let fixtures;
const servers = [];
const contexts = [];

before(async () => {
  build();
  browser = await chromium.launch();
  fixtures = await makeFixtures(browser);
});
// Close each test's pages so background work (OCR workers, streams) can't slow the next test.
afterEach(async () => {
  while (contexts.length) await contexts.pop().close();
  while (servers.length) servers.pop().close();
});
after(async () => {
  await browser?.close();
});

// A phone-sized page running the app with the given stub configuration.
async function openApp(stubConfig, { width } = {}) {
  const { server, url } = await serve(stubConfig);
  servers.push(server);
  const device = devices["iPhone 13"];
  const context = await browser.newContext(width ? { ...device, viewport: { width, height: 800 } } : device);
  contexts.push(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForTimeout(400); // let claude.use("sample") resolve
  return { page, errors, calls: () => page.evaluate(() => window.__STUB.calls) };
}

// Selectors that hold across home-screen redesigns.
const HOME_IMPORT = '#thread [data-action="import"], #thread label[for="fileInput"]';
const HOME_EXAMPLE = '#thread [data-action="example"], #thread #exampleTile';
const HOME_PASTE = '#thread [data-action="paste"], #thread #pasteTile';

// Import through a file picker; resolves once the import toast confirms (duplicates may be skipped).
async function importFrom(page, selector, files) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator(selector).first().click()]);
  await chooser.setFiles(files);
  await page.waitForFunction(() => /ready|couldn't/.test(document.getElementById("toast")?.textContent || ""));
}

// Polls from Node rather than from inside the page, so in-page timer throttling in headless
// Chromium can't delay the check (it measured 30s for a card that appeared in under 1s).
async function waitUntil(page, fn, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await page.evaluate(fn)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out after ${timeout} ms waiting for ${fn}`);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

test("home screen: loads cleanly and fits phones", async () => {
  for (const width of [undefined, 360]) {
    const { page, errors } = await openApp({}, { width });
    await page.waitForTimeout(700); // let the entrance animation settle before the screenshot
    await shot(page, `home-${width || 390}`);
    assert.deepEqual(errors, []);
    assert.deepEqual(await layoutProblems(page), []);
    assert.ok(await page.locator(HOME_IMPORT).first().isVisible(), "import action visible");
    assert.ok(await page.locator("#composer").isHidden(), "composer hidden on home");
  }
});

test("home screen: signed out shows the notice and the example still works", async () => {
  const { page } = await openApp({ noClaude: true });
  assert.match(await page.locator("#thread").innerText(), /Open Arguably on claude\.ai/);
  await page.locator(HOME_EXAMPLE).first().click();
  await page.waitForSelector(".msg.verdict");
  assert.match(await page.locator(".winner-name").innerText(), /Maya/);
});

test("screenshots from both phones: who's who, merged transcript, verdict, follow-up", async () => {
  const { page, errors, calls } = await openApp({
    images: true,
    shots: {
      1: { header: "Jordan", msgs: [["right", "You said you'd do the dishes last night?"], ["left", "Ok and you left your laundry in the dryer for 3 days so"], ["right", "This is literally the same thing that happened in March"]] },
      2: { header: "Maya", msgs: [["right", "Ok and you left your laundry in the dryer for 3 days so"], ["left", "This is literally the same thing that happened in March"], ["right", "Wow ok sorry I'm not perfect like you"]] },
    },
  });
  await importFrom(page, HOME_IMPORT, [fixtures.mayaPhone, fixtures.jordanPhone, fixtures.mayaPhone]);
  assert.equal(await page.locator(".attach-item").count(), 2, "duplicate screenshot skipped");
  await page.click("#sendBtn");
  await page.waitForSelector(".msg.who:not(.done)", { timeout: 15000 });
  assert.deepEqual(await page.$$eval(".who input", (els) => els.map((e) => e.value)), ["Jordan", "Maya", "Maya", "Jordan"]);
  assert.ok(await page.isDisabled("#sendBtn"), "send waits for who's who");
  await shot(page, "flow-who");
  assert.deepEqual(await layoutProblems(page), []);

  await page.click('.you-chip[data-you="Maya"]');
  await page.click("[data-confirm]");
  await page.waitForSelector(".msg.verdict", { timeout: 15000 });
  const verdictCall = (await calls()).find((c) => c.kind === "verdict");
  assert.equal(verdictCall.images, 0, "verdict is judged from text, not images");
  assert.equal(verdictCall.tier, "complex");
  assert.equal(verdictCall.you, "Maya");
  assert.deepEqual(verdictCall.transcript, [
    "[m1] Maya: You said you'd do the dishes last night?",
    "[m2] Jordan: Ok and you left your laundry in the dryer for 3 days so",
    "[m3] Maya: This is literally the same thing that happened in March",
    "[m4] Jordan: Wow ok sorry I'm not perfect like you",
  ]);
  assert.ok(await page.locator(".tag.unverified").count() > 0, "quotes not in the transcript are flagged");
  await shot(page, "flow-verdict");

  await page.locator("#suggestions button").first().click();
  await page.waitForFunction(() => !document.querySelector(".composer.busy") && document.querySelector(".msg.reply"));
  const chat = (await calls()).find((c) => c.kind === "chat");
  assert.match(chat.context, /\[m1\] Maya: You said/, "follow-ups get the transcript");
  assert.equal(chat.opts.cache, false);
  assert.deepEqual(await layoutProblems(page), []);
  assert.deepEqual(errors, []);
});

test("Claude iPhone app (no images): screenshots are read on the phone", async () => {
  const { page, errors, calls } = await openApp({ images: false });
  await importFrom(page, HOME_IMPORT, [fixtures.darkGroup]);
  const started = Date.now();
  await page.click("#sendBtn");
  await waitUntil(page, () => !!document.querySelector(".msg.who:not(.done), .msg.error"), 90000);
  const readMs = Date.now() - started;
  const error = await page.evaluate(() => document.querySelector(".msg.error")?.innerText || "");
  assert.equal(error, "", "reading failed");
  assert.ok(!(await calls()).some((c) => c.images > 0), "no images sent to Claude");
  await page.click("[data-confirm]");
  await page.waitForSelector(".msg.verdict", { timeout: 15000 });
  const transcript = (await calls()).find((c) => c.kind === "verdict").transcript.join("\n");
  for (const expected of [/Jason: .*Ok buddy/, /What shit\?/, /U think that's fine to post/, /Michael: I have pride in it/]) {
    assert.match(transcript, expected);
  }
  console.log(`  on-device reading took ${readMs} ms`);
  assert.ok(readMs < 15000, `on-device reading should take seconds, took ${readMs} ms`);
  assert.deepEqual(errors, []);
});

test("pasting the conversation as text gets a verdict", async () => {
  const { page, calls } = await openApp({ images: true });
  await page.locator(HOME_PASTE).first().click();
  await page.fill("#messageInput", "Maya: You said you'd do the dishes last night?\nJordan: Ok and you left your laundry in the dryer for 3 days so\nMaya: This is literally the same thing that happened in March");
  await page.click("#sendBtn");
  await page.waitForSelector(".msg.verdict", { timeout: 15000 });
  assert.ok((await calls()).some((c) => c.kind === "verdict"));
});

test("a failed Claude call shows a clear error and the app stays usable", async () => {
  const { page } = await openApp({ images: true, failJson: true });
  await importFrom(page, HOME_IMPORT, [fixtures.mayaPhone]);
  await page.click("#sendBtn");
  await page.waitForSelector(".msg.error", { timeout: 15000 });
  assert.match(await page.locator(".msg.error").innerText(), /Try again/);
  assert.ok(await page.isEnabled("#fileInput"), "can import again");
});
