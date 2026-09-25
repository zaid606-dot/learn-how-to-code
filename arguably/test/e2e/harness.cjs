// End-to-end harness for the Artifact build (dist/arguably.html).
// Serves the page the way claude.ai does (with dist/ocr/* next to it), injects a fake
// `window.claude` (see stub.js), generates chat screenshots, and drives a phone-sized browser.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const DIST = path.join(ROOT, "dist");
const OUT = path.join(ROOT, "test/e2e/.out");

function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    const globalRoot = execSync("npm root -g").toString().trim();
    return require(path.join(globalRoot, "playwright"));
  }
}
const { chromium, devices } = loadPlaywright();

function build() {
  execSync("node scripts/build-artifact.mjs", { cwd: ROOT, stdio: "pipe" });
}

// The page with the stub injected before it, as a full document (the Artifact host adds this skeleton).
function wrappedPage(stubConfig) {
  const page = fs.readFileSync(path.join(DIST, "arguably.html"), "utf8");
  const stub = fs.readFileSync(path.join(__dirname, "stub.js"), "utf8");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>[hidden]{display:none!important}body{margin:0}</style></head><body>
<script>window.__STUB_CONFIG = ${JSON.stringify(stubConfig || {})};
// Returning user by default; pass { firstRun: true } to see onboarding.
try { if (!window.__STUB_CONFIG.firstRun) localStorage.setItem("arguably.prefs.v1", JSON.stringify(Object.assign({ onboarded: true, aiConsent: true }, window.__STUB_CONFIG.prefs || {}))); else localStorage.clear(); } catch {}</script>
<script>${stub}</script>
${page}
<script>if (window.__STUB) window.__STUB.sampleVerdict = SAMPLE_VERDICT;</script>
</body></html>`;
}

// Tiny static server: "/" is the wrapped page, everything else comes from dist/.
function serve(stubConfig) {
  const html = wrappedPage(stubConfig);
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    const file = path.join(DIST, path.normalize(url).replace(/^(\.\.[/\\])+/, ""));
    if (!file.startsWith(DIST) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "Content-Type": file.endsWith(".js") ? "text/javascript" : "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

// Chat screenshots rendered in the browser, so the suite has no binary fixtures.
async function makeFixtures(browser) {
  fs.mkdirSync(OUT, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const bubble = (dark, me, text, name) => `${name && !me ? `<div style="font-size:12px;color:#8e8e93;margin:6px 0 2px 44px">${name}</div>` : ""}
    <div style="display:flex;justify-content:${me ? "flex-end" : "flex-start"};align-items:flex-end;gap:6px;margin:3px 0">
      ${!me && name ? '<div style="width:28px;height:28px;border-radius:50%;background:#636366"></div>' : ""}
      <div style="max-width:70%;padding:8px 12px;border-radius:18px;font-size:17px;line-height:1.25;background:${me ? "#0a84ff" : dark ? "#26252a" : "#e9e9eb"};color:${me || dark ? "#fff" : "#000"}">${text}</div></div>`;
  const chat = (dark, header, msgs, group) => `<body style="margin:0;font-family:-apple-system,Helvetica,sans-serif;background:${dark ? "#000" : "#fff"};color:${dark ? "#fff" : "#000"}">
    <div style="display:flex;justify-content:space-between;padding:14px 24px 4px;font-weight:600;font-size:16px"><span>10:01</span><span>5G</span></div>
    <div style="text-align:center;padding:8px 0 10px;border-bottom:1px solid ${dark ? "#222" : "#ddd"}"><div style="width:44px;height:44px;border-radius:50%;background:#636366;margin:0 auto 4px"></div><div style="font-size:12px">${header} ›</div></div>
    <div style="padding:10px 12px">${msgs.map(([me, t, n]) => (t.startsWith("@") ? `<div style="text-align:center;font-size:11px;color:#8e8e93;margin:10px 0">${t.slice(1)}</div>` : bubble(dark, me, t, group ? n : ""))).join("")}</div></body>`;
  const fixtures = {
    darkGroup: chat(true, "Strech Media team", [
      [0, "@Today 9:58 AM"],
      [0, "Ur telling me to have pride when it got the green light from the Man U asked me to check in with?", "Jason"],
      [0, "Ok buddy", "Jason"],
      [1, "What shit?"],
      [0, "I have pride in it I'm the one standing on it saying it's fine", "Michael"],
      [1, "U think that's fine to post"],
    ], true),
    mayaPhone: chat(false, "Jordan", [
      [1, "You said you'd do the dishes last night?"],
      [0, "Ok and you left your laundry in the dryer for 3 days so"],
      [1, "This is literally the same thing that happened in March"],
    ]),
    jordanPhone: chat(false, "Maya", [
      [1, "Ok and you left your laundry in the dryer for 3 days so"],
      [0, "This is literally the same thing that happened in March"],
      [1, "Wow ok sorry I'm not perfect like you"],
    ]),
  };
  const files = {};
  for (const [name, html] of Object.entries(fixtures)) {
    await page.setContent(html);
    files[name] = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: files[name] });
  }
  await page.close();
  return files;
}

// Checks that should hold on every screen.
async function layoutProblems(page) {
  return page.evaluate(() => {
    const problems = [];
    if (document.documentElement.scrollWidth > innerWidth) problems.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${innerWidth})`);
    for (const el of document.querySelectorAll("button, a[href], label[for], summary, input:not([type=file]), textarea")) {
      if (!el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height && (r.width < 40 || r.height < 40) && !el.closest(".visually-hidden")) {
        problems.push(`small tap target ${Math.round(r.width)}x${Math.round(r.height)}: ${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}"`);
      }
    }
    return problems;
  });
}

module.exports = { chromium, devices, build, serve, makeFixtures, layoutProblems, OUT, ROOT };
