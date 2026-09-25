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

  await page.locator("#suggestions [data-say]").first().click();
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

test("first run: onboarding in three steps, name saved, lands on import", async () => {
  const { page, errors } = await openApp({ images: true, firstRun: true });
  assert.ok(await page.locator(".onboard").isVisible(), "onboarding shows on first run");
  await shot(page, "onboarding-1");
  assert.deepEqual(await layoutProblems(page), []);
  await page.click('[data-action="next"]');
  await page.click('[data-action="next"]');
  await page.fill("#obName", "Maya");
  await shot(page, "onboarding-3");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click('.onboard [data-action="import"]')]);
  assert.ok(chooser, "finishing onboarding opens the photo picker");
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem("arguably.prefs.v1")));
  assert.equal(prefs.onboarded, true);
  assert.equal(prefs.name, "Maya");
  assert.ok(await page.locator("#thread .home").isVisible(), "home is behind the picker");
  assert.deepEqual(errors, []);
});

test("first run: Skip goes straight to home", async () => {
  const { page } = await openApp({ firstRun: true });
  await page.click("#skipBtn");
  assert.ok(await page.locator("#thread .home").isVisible());
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("arguably.prefs.v1")).onboarded), true);
});

test("settings: name, tone, on-phone reading and delete all change real behavior", async () => {
  const { page, errors, calls } = await openApp({
    images: true,
    shots: { 1: { header: "Jordan", msgs: [["right", "You said you'd do the dishes last night?"], ["left", "Ok and you left your laundry in the dryer for 3 days so"]] } },
  });
  await page.click("#settingsBtn");
  await page.fill("#setName", "Maya");
  await page.click('[data-tone="gentle"]');
  await shot(page, "settings");
  assert.deepEqual(await layoutProblems(page), []);
  await page.click("#backBtn");
  // Name fills "Me" and preselects "you"; tone reaches the verdict prompt.
  await importFrom(page, HOME_IMPORT, [fixtures.mayaPhone]);
  await page.click("#sendBtn");
  await waitUntil(page, () => !!document.querySelector(".msg.who:not(.done)"));
  assert.deepEqual(await page.$$eval(".who input", (els) => els.map((e) => e.value)), ["Jordan", "Maya"]);
  assert.equal(await page.getAttribute('.you-chip[data-you="Maya"]', "aria-checked"), "true");
  await page.click("[data-confirm]");
  await waitUntil(page, () => !!document.querySelector(".msg.verdict"));
  const verdictCall = (await calls()).find((c) => c.kind === "verdict");
  assert.equal(verdictCall.you, "Maya");
  // Always read on this phone: no images go to Claude even though the view supports them.
  await page.click("#backBtn");
  await page.click("#settingsBtn");
  await page.click('[data-toggle="readOnPhone"]');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("arguably.prefs.v1")).readOnPhone), true);
  // Delete all asks first, then clears saved chats.
  await page.click('[data-action="delete-all"]');
  assert.match(await page.locator(".confirm-row").innerText(), /can't be undone/);
  await page.click('[data-action="delete-confirm"]');
  // Delete all data erases everything the app keeps; you aren't sent back through the intro.
  assert.equal(await page.evaluate(() => localStorage.getItem("arguably.chats.v2")), null);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("arguably.prefs.v1")));
  assert.equal(after.name, "");
  assert.equal(after.onboarded, true);
  assert.deepEqual(errors, []);
});

test("notifications: a verdict that finishes while you're home shows up with a badge", async () => {
  const { page, errors } = await openApp({
    images: true,
    shots: {
      1: { header: "Jordan", msgs: [["right", "You said you'd do the dishes last night?"], ["left", "Ok and you left your laundry in the dryer for 3 days so"]] },
    },
  });
  await importFrom(page, HOME_IMPORT, [fixtures.mayaPhone]);
  await page.click("#sendBtn");
  await waitUntil(page, () => !!document.querySelector(".msg.who:not(.done)"));
  await page.click("[data-confirm]");
  await page.click("#backBtn"); // leave while the verdict is being judged
  await waitUntil(page, () => !document.getElementById("inboxBadge").hidden, 15000);
  assert.match(await page.locator("#inboxBadge").innerText(), /^\d+$/);
  await page.click("#inboxBtn");
  await shot(page, "notifications");
  assert.match(await page.locator(".notes").innerText(), /Verdict ready/);
  assert.deepEqual(await layoutProblems(page), []);
  await page.locator(".note", { hasText: "Verdict ready" }).first().click();
  await waitUntil(page, () => !!document.querySelector(".msg.verdict"));
  assert.ok(await page.locator("#inboxBadge").isHidden() || /^\d+$/.test(await page.locator("#inboxBadge").innerText()));
  assert.deepEqual(errors, []);
});

test("nothing goes to Claude until the viewer allows it", async () => {
  const { page, errors, calls } = await openApp({ images: true, prefs: { aiConsent: false } });
  await page.locator(HOME_PASTE).first().click();
  await page.fill("#messageInput", "Maya: So you were asleep but liking pics at 2am?\nJordan: You literally left me on read for 6 hours yesterday\nMaya: This is literally the same thing that happened in March");
  await page.click("#sendBtn");
  await page.waitForSelector(".doc", { timeout: 5000 });
  assert.equal(await page.locator(".doc .page-title").innerText(), "How AI is used");
  assert.equal((await calls()).length, 0, "no Claude call before consent");
  await page.click('[data-action="consent"]');
  await page.waitForSelector(".msg.verdict", { timeout: 15000 });
  assert.ok((await calls()).some((c) => c.kind === "verdict"), "the held request goes through after consent");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("arguably.prefs.v1")).aiConsent), true);
  assert.deepEqual(errors, []);
});

test("onboarding asks for consent explicitly and 'Not now' respects it", async () => {
  const { page } = await openApp({ firstRun: true });
  await page.click('[data-action="next"]');
  assert.match(await page.locator(".ob-fine").innerText(), /Anthropic/);
  await page.click('.onboard [data-action="next"]'); // Not now
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("arguably.prefs.v1") || "{}").aiConsent || false), false);
});

test("the example ends by sending you to grab your own argument", async () => {
  const { page, errors } = await openApp({ images: true });
  await page.click('.sheet-btn[data-action="example"]');
  await page.waitForSelector(".msg.nudge");
  await shot(page, "example-nudge");
  assert.equal(await page.locator(".msg.nudge li").count(), 7);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click('.msg.nudge [data-action="import"]')]);
  assert.ok(chooser);
  await page.click('.msg.nudge [data-action="paste-new"]');
  assert.equal(await page.evaluate(() => document.activeElement.id), "messageInput");
  assert.deepEqual(errors, []);
});

test("settings: store-ready pages, export and support links", async () => {
  const { page, errors } = await openApp({ images: true });
  await page.click("#settingsBtn");
  for (const [doc, title] of [["privacy", "Privacy Policy"], ["ai", "How AI is used"], ["terms", "Terms of Use"], ["safety", "Staying safe"], ["licenses", "Open-source licenses"]]) {
    await page.click(`[data-doc="${doc}"]`);
    assert.equal(await page.locator(".doc .page-title").innerText(), title);
    assert.deepEqual(await layoutProblems(page), [], doc);
    await page.click("#backBtn");
    assert.ok(await page.locator(".settings").isVisible(), `back from ${doc} returns to Settings`);
  }
  assert.match(await page.getAttribute('a[href^="mailto:"]', "href"), /^mailto:.+@/);
  const [download] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="export"]')]);
  assert.match(download.suggestedFilename(), /^arguably-export-.*\.json$/);
  assert.deepEqual(errors, []);
});

test("the first notification asks for an App Store rating", async () => {
  const { page, errors } = await openApp({ firstRun: true });
  await page.click("#skipBtn");
  await page.click("#inboxBtn");
  assert.match(await page.locator(".note").first().innerText(), /welcome to Arguably[\s\S]*rating on the App Store/);
  await shot(page, "inbox-rate");
  assert.deepEqual(await layoutProblems(page), []);
  await page.click(".note");
  assert.equal(await page.locator(".note.unread").count(), 0);
  assert.deepEqual(errors, []);
});

const PASTED = "Maya: So you were asleep but liking pics at 2am?\nJordan: You literally left me on read for 6 hours yesterday\nMaya: This is literally the same thing that happened in March";
async function pasteConversation(page) {
  await page.locator(HOME_PASTE).first().click();
  await page.fill("#messageInput", PASTED);
  await page.click("#sendBtn");
}

test("a failed verdict leaves a Try again card that works, even after reload", async () => {
  const { page, errors, calls } = await openApp({ images: true, failVerdictTimes: 1 });
  await pasteConversation(page);
  await page.waitForSelector(".msg.resume.failed", { timeout: 10000 });
  await shot(page, "verdict-failed");
  await page.reload(); // the stub resets on reload, so the first retry fails once more
  await page.click(".recent [data-chat]");
  await page.click(".msg.resume [data-resume]");
  await page.waitForSelector(".msg.resume.failed", { timeout: 10000 });
  await page.click(".msg.resume [data-resume]");
  await page.waitForSelector(".msg.verdict", { timeout: 10000 });
  assert.equal(await page.locator(".msg.resume").count(), 0);
  assert.equal((await calls()).filter((c) => c.kind === "verdict").length, 1);
  assert.deepEqual(errors, []);
});

test("a failed reading keeps the screenshots and note for another try", async () => {
  const { page } = await openApp({ images: true, failJson: true });
  await importFrom(page, HOME_IMPORT, [fixtures.mayaPhone]);
  await page.fill("#messageInput", "We've been dating a year");
  await page.click("#sendBtn");
  await page.waitForSelector(".msg.error", { timeout: 15000 });
  assert.equal(await page.locator(".attach-item").count(), 1, "screenshot is back in the tray");
  assert.equal(await page.inputValue("#messageInput"), "We've been dating a year");
  assert.equal(await page.locator(".msg.user").count(), 0);
});

test("different screenshots are all kept; only a true re-import is skipped", async () => {
  const { page } = await openApp({ images: true });
  await importFrom(page, HOME_IMPORT, [fixtures.mayaPhone, fixtures.jordanPhone, fixtures.mayaPhone]);
  assert.equal(await page.locator(".attach-item").count(), 2);
});

test("asking about the example keeps the example's conversation", async () => {
  const { page, errors, calls } = await openApp({ images: true });
  await page.click('.sheet-btn[data-action="example"]');
  await page.fill("#messageInput", "Was Maya too harsh?");
  await page.click("#sendBtn");
  await waitUntil(page, () => !document.querySelector(".msg.reply .thinking") && !!document.querySelector(".msg.reply"));
  const chat = (await calls()).find((c) => c.kind === "chat");
  assert.ok(chat, "a chat call was made");
  assert.match(chat.context, /Brianna/);
  assert.ok(await page.locator(".msg.verdict").isVisible(), "the example verdict stays in the thread");
  assert.deepEqual(errors, []);
});

test("App Store build: free verdicts count down, then the paywall gates the next one", async () => {
  const { page, errors, calls } = await openApp({ images: true, store: true, prefs: { freeUsed: 2 } });
  assert.match(await page.locator(".import-note").innerText(), /1 free verdict left/);
  await pasteConversation(page);
  await page.waitForSelector(".msg.verdict", { timeout: 10000 });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("arguably.prefs.v1")).freeUsed), 3);
  // The next verdict is gated: the paywall shows and nothing is sent to Claude.
  await page.click("#newBtn");
  await page.fill("#messageInput", PASTED);
  await page.click("#sendBtn");
  await page.waitForSelector(".paywall");
  await shot(page, "paywall");
  assert.deepEqual(await layoutProblems(page), []);
  assert.equal((await calls()).filter((c) => c.kind === "verdict").length, 1);
  const terms = await page.locator(".pw-terms").innerText();
  assert.match(terms, /\$39\.99 per year/);
  assert.match(terms, /Renews automatically/);
  assert.ok(await page.locator('[data-action="restore"]').isVisible(), "Restore purchases on the paywall");
  // Closing leaves a card that brings the paywall back.
  await page.click('[data-action="paywall-close"]');
  assert.ok(await page.locator(".msg.resume.locked").isVisible());
  await page.click('.msg.resume [data-action="paywall"]');
  await page.click('[data-plan="monthly"]');
  assert.equal(await page.locator(".pw-cta").innerText(), "Subscribe for $6.99/month");
  await page.click('[data-action="purchase"]');
  await page.waitForSelector(".msg.verdict", { timeout: 10000 });
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem("arguably.prefs.v1")));
  assert.equal(prefs.pro.plan, "monthly");
  assert.equal(prefs.proUsage.n, 1);
  await page.click("#backBtn");
  await page.click("#settingsBtn");
  assert.match(await page.locator(".settings").innerText(), /Pro · Monthly[\s\S]*1 of 50 verdicts this month[\s\S]*Manage subscription/);
  assert.deepEqual(errors, []);
});

test("claude.ai build has no gate", async () => {
  const { page } = await openApp({ images: true, prefs: { freeUsed: 99 } });
  await pasteConversation(page);
  await page.waitForSelector(".msg.verdict", { timeout: 10000 });
  await page.click("#backBtn");
  await page.click("#settingsBtn");
  assert.doesNotMatch(await page.locator(".settings").innerText(), /Pro|Restore purchases/);
});

test("leaving or starting a new chat while work runs doesn't break or leak results", async () => {
  const { page, errors } = await openApp({
    images: true,
    shots: { 1: { header: "Jordan", msgs: [["right", "You said you'd do the dishes last night?"], ["left", "Ok and you left your laundry in the dryer for 3 days so"]] } },
  });
  // Back while reading.
  await importFrom(page, HOME_IMPORT, [fixtures.mayaPhone]);
  await page.click("#sendBtn");
  await page.click("#backBtn");
  await waitUntil(page, () => document.querySelector(".recent")?.innerText.includes("Check who's who"));
  // New chat while the verdict runs: the verdict lands in its own chat, not the new one.
  await page.click(".recent [data-chat]");
  await page.click("[data-confirm]");
  await page.click("#newBtn");
  await page.waitForTimeout(600);
  assert.equal(await page.locator(".msg.verdict").count(), 0, "new chat stays empty");
  assert.equal(await page.isVisible("#sendBtn"), true);
  await page.click("#backBtn");
  await waitUntil(page, () => document.querySelector(".recent")?.innerText.includes("won"));
  assert.deepEqual(errors, []);
});

test("who's who won't accept the same name for both sides", async () => {
  const { page, calls } = await openApp({
    images: true,
    shots: { 1: { header: "Jordan", msgs: [["right", "You said you'd do the dishes last night?"], ["left", "Ok and you left your laundry in the dryer for 3 days so"]] } },
  });
  await importFrom(page, HOME_IMPORT, [fixtures.mayaPhone]);
  await page.click("#sendBtn");
  await waitUntil(page, () => !!document.querySelector(".msg.who:not(.done)"));
  const inputs = page.locator(".who input");
  await inputs.nth(0).fill("Jordan");
  await inputs.nth(1).fill("jordan");
  await page.click("[data-confirm]");
  assert.ok(await page.locator(".msg.who:not(.done)").isVisible(), "still asking");
  assert.equal((await calls()).filter((c) => c.kind === "verdict").length, 0);
});

test("a short pasted exchange with names is judged, not treated as a question", async () => {
  const { page } = await openApp({ images: true });
  await page.locator(HOME_PASTE).first().click();
  await page.fill("#messageInput", "Maya: you're late again\nJordan: traffic");
  await page.click("#sendBtn");
  await page.waitForSelector(".msg.verdict", { timeout: 10000 });
});

test("verdict sections stay as you left them after a follow-up", async () => {
  const { page } = await openApp({ images: true });
  await pasteConversation(page);
  await page.waitForSelector(".msg.verdict", { timeout: 10000 });
  const before = await page.$$eval(".v-sec", (d) => d.map((x) => x.open));
  await page.locator(".v-sec summary").nth(0).click();
  await page.locator(".v-sec summary").nth(2).click();
  const toggled = await page.$$eval(".v-sec", (d) => d.map((x) => x.open));
  assert.notDeepEqual(toggled, before);
  await page.locator("#suggestions [data-say]").first().click();
  await waitUntil(page, () => !document.querySelector(".composer.busy") && !!document.querySelector(".msg.reply:not(:has(.thinking))"));
  assert.deepEqual(await page.$$eval(".v-sec", (d) => d.map((x) => x.open)), toggled);
  assert.doesNotMatch(await page.locator(".msg.reply").last().innerText(), /\[m\d+\]/, "no internal message IDs in replies");
});
