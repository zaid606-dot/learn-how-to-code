// Makes the social promo video from the real app (web build), vertical 1080x1920.
//   node scripts/make-promo.cjs            -> promo/arguably-promo.webm   (captions, phone frame, end card)
//   node scripts/make-promo.cjs --clean    -> promo/arguably-app-capture.webm (just the app, full screen)
// The app runs for real in a browser; only the AI's reply is canned (the example verdict), so
// every screen in the video is what the app actually shows. Frames are captured as the page
// renders and encoded with the ffmpeg that ships with Playwright (VP8/WebM). For the App Store
// or Instagram, convert to H.264 MP4 (see promo/README.md).
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execSync } = require("node:child_process");
const { chromium } = require("../test/e2e/harness.cjs");

const ROOT = path.join(__dirname, "..");
const WEB = path.join(ROOT, "web-dist");
const OUT = path.join(ROOT, "promo");
const CLEAN = process.argv.includes("--clean");
const FPS = 30;
const W = 1080, H = 1920;
const STAGE = { w: 432, h: 768, dpr: W / 432 }; // 432x768 CSS px at 2.5x = 1080x1920
const APP = CLEAN ? { w: 432, h: 768 } : { w: 393, h: 852 }; // clean: the app fills the frame

function ffmpegPath() {
  const dir = fs.readdirSync("/opt/pw-browsers").find((d) => d.startsWith("ffmpeg"));
  const p = dir && path.join("/opt/pw-browsers", dir, "ffmpeg-linux");
  if (!p || !fs.existsSync(p)) throw new Error("Playwright's ffmpeg not found");
  return p;
}

// The conversation the example verdict was written for (quotes in it match word for word).
const CONVO = [
  "Maya: So you were 'asleep' but liking Brianna's pics at 2am? 👀",
  "Jordan: It's literally just a like, why is this a whole thing",
  "Maya: Honestly you're such a liar",
  "Jordan: You literally left me on read for 6 hours yesterday",
  "Maya: This is literally the same thing that happened in March",
  "Jordan: Wow ok sorry I'm not perfect like you 🙄",
  "Maya: I just want a straight answer",
].join("\n");

const STAGE_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=${STAGE.w}">
<style>
  :root { --ember-500:#B74324; --ember-300:#E7A18A; --coral:#FF5A47; --ink:#140e0c; --navy:#252668; }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: ${STAGE.w}px; height: ${STAGE.h}px; overflow: hidden; background: var(--ink); font-family: "Liberation Sans", Arial, sans-serif; color: #fff; }
  .bg { position: absolute; inset: 0; background:
      radial-gradient(70% 45% at 50% 18%, rgba(255,90,71,.38), transparent 70%),
      linear-gradient(to top, rgba(37,38,104,.42), rgba(37,38,104,0) 45%), var(--ink); }
  .cap { position: absolute; left: 22px; right: 22px; top: 44px; height: 112px; display: grid; place-items: center; text-align: center; }
  .cap span { font: 700 29px/1.12 "Liberation Sans", Arial, sans-serif; letter-spacing: -.02em; text-wrap: balance;
    opacity: 0; transform: translateY(14px); transition: opacity .35s ease, transform .45s cubic-bezier(.2,.9,.3,1.2); position: absolute; }
  .cap span.on { opacity: 1; transform: none; }
  .cap em { font-style: normal; color: var(--coral); }
  .phone { position: absolute; left: 50%; top: 168px; width: ${APP.w}px; height: ${APP.h}px; transform-origin: top center;
    transform: translateX(-50%) translateY(980px) scale(.7); border-radius: 58px; overflow: hidden; background: #000;
    box-shadow: 0 0 0 9px #1d1716, 0 0 0 11px #3a2d2a, 0 40px 90px rgba(0,0,0,.6), 0 0 120px rgba(255,90,71,.25);
    transition: transform .9s cubic-bezier(.2,.9,.25,1.05), filter .5s ease; }
  .phone.up { transform: translateX(-50%) translateY(0) scale(.7); }
  .phone.dim { filter: brightness(.2) blur(5px); transform: translateX(-50%) translateY(40px) scale(.66); }
  .phone iframe { position: absolute; top: 50px; left: 0; width: 100%; height: calc(100% - 50px); border: 0; display: block; background: #fff; }
  .status { position: absolute; inset: 0 0 auto; height: 50px; background: var(--app-bg, #fff8f5); color: #140e0c; font: 600 16px/1 "Liberation Sans", Arial, sans-serif; }
  .status b { position: absolute; left: 40px; top: 19px; }
  .status s { position: absolute; right: 34px; top: 20px; width: 25px; height: 12px; border: 1.5px solid #140e0c; border-radius: 4px; }
  .status s::after { content: ""; position: absolute; inset: 1.5px 4px 1.5px 1.5px; background: #140e0c; border-radius: 1.5px; }
  .island { position: absolute; top: 11px; left: 50%; width: 120px; height: 34px; margin-left: -60px; border-radius: 20px; background: #000; z-index: 2; }
  /* hook */
  .hook { position: absolute; inset: 0; display: grid; place-items: center; }
  .hook h1 { font: 700 46px/1.02 "Liberation Sans", Arial, sans-serif; letter-spacing: -.035em; text-align: center; padding: 0 28px; }
  .hook h1 i { display: inline-block; font-style: normal; opacity: 0; transform: translateY(26px) scale(.9); transition: opacity .3s, transform .5s cubic-bezier(.2,1.4,.4,1); }
  .hook h1 i.on { opacity: 1; transform: none; }
  .hook h1 i.hot { color: var(--coral); }
  .hook.out { opacity: 0; transform: scale(.94); transition: opacity .4s, transform .4s; }
  .bub { position: absolute; max-width: 250px; padding: 11px 15px; border-radius: 20px; font: 500 17px/1.25 "Liberation Sans", Arial, sans-serif;
    opacity: 0; transition: opacity .25s, transform .55s cubic-bezier(.2,1.3,.4,1); }
  .bub.l { left: 22px; background: #2e2624; color: #f4ebe7; border-bottom-left-radius: 6px; transform: translateX(-60px) rotate(-6deg); }
  .bub.r { right: 22px; background: #1f7cf2; color: #fff; border-bottom-right-radius: 6px; transform: translateX(60px) rotate(6deg); }
  .bub.on { opacity: 1; transform: rotate(var(--rot, 0deg)); }
  /* end card */
  .end { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 16px; text-align: center; opacity: 0; pointer-events: none; }
  .end.on { opacity: 1; transition: opacity .5s ease; background: radial-gradient(60% 45% at 50% 50%, rgba(20,14,12,.85), rgba(20,14,12,.35)); }
  .end img { width: 132px; transform: scale(.4) rotate(-12deg); transition: transform .8s cubic-bezier(.2,1.5,.4,1); }
  .end.on img { transform: none; }
  .end .name { font: 700 58px/1 "Liberation Sans", Arial, sans-serif; letter-spacing: -.045em; }
  .end .tag { font: 700 26px/1.15 "Liberation Sans", Arial, sans-serif; color: var(--ember-300); letter-spacing: -.02em; }
  .end .cta { margin-top: 18px; padding: 16px 28px; border-radius: 999px; background: var(--coral); font: 700 20px/1 "Liberation Sans", Arial, sans-serif; box-shadow: 0 14px 40px rgba(255,90,71,.45); }
  .end .url { font: 500 15px/1 "Liberation Sans", Arial, sans-serif; color: #b9aaa4; }
  .end > * { opacity: 0; transform: translateY(16px); }
  .end.on > * { opacity: 1; transform: none; transition: opacity .45s, transform .6s cubic-bezier(.2,1.2,.4,1); }
  .end.on > :nth-child(2) { transition-delay: .15s } .end.on > :nth-child(3) { transition-delay: .3s }
  .end.on > :nth-child(4) { transition-delay: .5s } .end.on > :nth-child(5) { transition-delay: .6s }
  ${CLEAN ? `.phone, .phone.up { top: 0; left: 0; transform: none; border-radius: 0; box-shadow: none; } .phone iframe { top: 0; height: 100%; } .island, .status, .cap, .hook, .bg { display: none; }` : ""}
</style></head><body>
<div class="bg"></div>
<div class="hook" id="hook">
  <div class="bub l" id="b1" style="top:150px;--rot:-3deg">I NEVER said that</div>
  <div class="bub r" id="b2" style="top:222px;--rot:3deg">You literally did. Scroll up.</div>
  <h1 id="hookText"><i>Who</i> <i>actually</i> <i class="hot">won</i> <i>the</i> <i class="hot">argument?</i></h1>
  <div class="bub l" id="b3" style="top:520px;--rot:2deg">whatever. you always do this</div>
</div>
<div class="cap" id="cap"></div>
<div class="phone" id="phone"><div class="status"><b>9:41</b><s></s></div><div class="island"></div><iframe id="app" src="/"></iframe></div>
<div class="end" id="end">
  <img src="/__mark.svg" alt="">
  <div class="name">Arguably</div>
  <div class="tag">See who's right.<br>With receipts.</div>
  <div class="cta">Try it free</div>
  <div class="url">arguably-gold.vercel.app</div>
</div>
<script>
  const $ = (id) => document.getElementById(id);
  window.stage = {
    caption(html) {
      const cap = $("cap");
      [...cap.children].forEach((s) => { s.classList.remove("on"); setTimeout(() => s.remove(), 400); });
      if (!html) return;
      const s = document.createElement("span");
      s.innerHTML = html;
      cap.append(s);
      requestAnimationFrame(() => requestAnimationFrame(() => s.classList.add("on")));
    },
    async hook() {
      const words = [...$("hookText").children];
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      $("b1").classList.add("on"); await wait(260);
      for (const w of words) { w.classList.add("on"); await wait(150); }
      $("b2").classList.add("on"); await wait(380);
      $("b3").classList.add("on");
    },
    phoneUp() { $("hook").classList.add("out"); $("phone").classList.add("up"); },
    end() { $("phone").classList.add("dim"); stage.caption(""); $("end").classList.add("on"); },
  };
</script></body></html>`;

function serve() {
  const mark = fs.readFileSync(path.join(ROOT, "public/brand/mark.svg"));
  return http.createServer((req, res) => {
    const p = new URL(req.url, "http://x").pathname;
    if (p === "/__stage.html") { res.setHeader("Content-Type", "text/html"); return res.end(STAGE_HTML); }
    if (p === "/__mark.svg") { res.setHeader("Content-Type", "image/svg+xml"); return res.end(mark); }
    if (p.startsWith("/api/")) { res.statusCode = 404; return res.end("{}"); } // routed in the page instead
    const file = path.join(WEB, p === "/" ? "index.html" : path.normalize(p));
    if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader("Content-Type", file.endsWith(".html") ? "text/html" : file.endsWith(".js") ? "text/javascript" : file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".wasm") ? "application/wasm" : "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  });
}

(async () => {
  execSync("node scripts/build-artifact.mjs --web", { cwd: ROOT, stdio: "pipe" });
  const { sampleVerdict } = await import(path.join(ROOT, "src/sample.js"));
  const server = serve();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: STAGE.w, height: STAGE.h }, deviceScaleFactor: STAGE.dpr, isMobile: true, hasTouch: true });
  await context.addInitScript(() => {
    if (location.pathname === "/__stage.html") return;
    localStorage.setItem("arguably.prefs.v1", JSON.stringify({ onboarded: true, name: "", policy: { version: "2026-09-25.2", at: 1 }, aiConsent: true }));
    // The system fonts here stand in for the web fonts, which this machine can't download.
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = `:root { --font-body: "Liberation Sans", Arial, sans-serif !important; --font-display: "Liberation Sans", Arial, sans-serif !important; } ::-webkit-scrollbar { display: none; }`;
      document.head.append(s);
    });
  });
  await context.route("**/api/limits", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ maxPromptBytes: 200000 }) }));
  await context.route("**/api/verdicts**", (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await context.route("**/api/auth**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ accounts: false, user: null }) }));
  await context.route("**/api/json", async (r) => {
    await new Promise((ok) => setTimeout(ok, 3600)); // the judging moment
    r.fulfill({ contentType: "application/json", body: JSON.stringify(sampleVerdict) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/__stage.html`);
  const app = page.frameLocator("#app");
  await app.locator("#thread").waitFor();
  await page.waitForTimeout(1200);
  const appFrame = page.frames().find((f) => f.url().startsWith(base + "/") && !f.url().includes("__stage"));
  const appBg = await appFrame.evaluate(() => getComputedStyle(document.querySelector(".topbar") || document.body).backgroundColor);
  await page.evaluate((c) => document.documentElement.style.setProperty("--app-bg", c), appBg);

  // ---- capture ----
  const cdp = await context.newCDPSession(page);
  const frames = []; // {t, data}
  // The page paints nothing while it sits still, so the frame from before the story can be a
  // half-painted first paint. The video starts with the first frame painted after goLive().
  let t0 = 0, live = false;
  cdp.on("Page.screencastFrame", (f) => {
    const t = f.metadata.timestamp * 1000;
    if (live) {
      if (!t0) t0 = t;
      frames.push({ t: t - t0, data: Buffer.from(f.data, "base64") });
    }
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  const goLive = () => (live = true);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 95, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  const wait = (ms) => page.waitForTimeout(ms);
  const stage = (js) => page.evaluate(js);
  const cap = (html) => stage(`stage.caption(${JSON.stringify(html)})`);

  // ---- the story ----
  goLive();
  if (!CLEAN) {
    await stage("stage.hook()");
    await wait(2300);
    await stage("stage.phoneUp()");
    await cap("Drop in the screenshots from <em>both</em> phones.");
    await wait(4200);
  } else {
    await wait(3500); // the home screen's own demo
  }
  await app.locator('#thread [data-action="paste"]').first().click();
  await wait(500);
  await app.locator("#messageInput").fill("");
  await app.locator("#messageInput").pressSequentially(CONVO.slice(0, 64), { delay: 18 });
  await app.locator("#messageInput").fill(CONVO);
  await wait(500);
  if (!CLEAN) await cap("Arguably reads every message…");
  await app.locator("#sendBtn").click();
  await app.locator(".msg.verdict").waitFor({ timeout: 20000 });
  if (!CLEAN) await cap("…and picks a winner. <em>With receipts.</em>");
  await wait(2600);
  // Glide down through the verdict: winner, how it started, low blows, quote check.
  const scrollBy = (y, ms) => appFrame.evaluate(async ([y, ms]) => {
    const el = document.scrollingElement;
    const from = el.scrollTop, start = performance.now();
    await new Promise((done) => {
      const step = (now) => {
        const k = Math.min(1, (now - start) / ms);
        el.scrollTop = from + y * (k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
        k < 1 ? requestAnimationFrame(step) : done();
      };
      requestAnimationFrame(step);
    });
  }, [y, ms]);
  // Bring a part of the verdict to just under the top bar.
  const glideTo = async (text, ms) => {
    const y = await appFrame.evaluate((text) => {
      const el = [...document.querySelectorAll(".verdict h2, .verdict h3, .verdict summary, .verdict button, .verdict .v-label, .verdict span")].find((e) => e.textContent.trim().startsWith(text));
      return el ? el.getBoundingClientRect().top - 70 : 400;
    }, text);
    await scrollBy(y, ms);
  };
  if (!CLEAN) await cap("Who started it, and <em>what it's really about.</em>");
  await glideTo("Where it started", 1600);
  await wait(2600);
  await app.locator(".verdict").getByText("Personal shots", { exact: false }).first().click();
  await wait(300);
  if (!CLEAN) await cap("Every low blow, <em>called out.</em>");
  await glideTo("Personal shots", 1500);
  await wait(2800);
  if (!CLEAN) {
    await stage("stage.end()");
    await wait(3400);
  } else {
    await scrollBy(-99999, 1400);
    await wait(1200);
  }
  await cdp.send("Page.stopScreencast");
  await browser.close();
  server.close();
  if (errors.length) console.warn("page errors:", errors);

  // ---- encode: a steady 30 fps from the frames as they were painted ----
  const total = frames.at(-1).t + 400;
  fs.mkdirSync(OUT, { recursive: true });
  // --frames N: N stills spread evenly from first frame to last (e.g. for a storyboard or thumbnails).
  const nFrames = Number(process.argv[process.argv.indexOf("--frames") + 1]) || 0;
  if (process.argv.includes("--frames") && nFrames > 0) {
    const dir = path.join(OUT, CLEAN ? "frames-app" : "frames");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (let n = 0, k = 0; n < nFrames; n++) {
      const at = (n / (nFrames - 1)) * frames.at(-1).t;
      while (k + 1 < frames.length && frames[k + 1].t <= at) k++;
      fs.writeFileSync(path.join(dir, `frame-${String(n + 1).padStart(2, "0")}-${(at / 1000).toFixed(2)}s.jpg`), frames[k].data);
    }
  }
  if (process.env.STILLS) { // one still a second, for checking the cut
    const dir = path.join(OUT, "stills");
    fs.mkdirSync(dir, { recursive: true });
    for (let s = 0, k = 0; s * 1000 < total; s++) {
      while (k + 1 < frames.length && frames[k + 1].t <= s * 1000) k++;
      fs.writeFileSync(path.join(dir, `${CLEAN ? "clean" : "promo"}-${String(s).padStart(2, "0")}.jpg`), frames[k].data);
    }
  }
  const out = path.join(OUT, CLEAN ? "arguably-app-capture.webm" : "arguably-promo.webm");
  const ff = spawn(ffmpegPath(), [
    "-loglevel", "error", "-y",
    "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "pipe:0",
    "-vf", `scale=${W}:${H}:flags=lanczos,format=yuv420p`,
    "-c:v", "libvpx", "-b:v", "6M", "-maxrate", "9M", "-bufsize", "9M", "-qmin", "2", "-qmax", "30", "-crf", "6",
    "-deadline", "good", "-cpu-used", "1", "-auto-alt-ref", "1", "-lag-in-frames", "16", "-g", "60",
    out,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  let i = 0, painted = 0;
  for (let t = 0; t < total; t += 1000 / FPS) {
    while (i + 1 < frames.length && frames[i + 1].t <= t) i++;
    if (!ff.stdin.write(frames[i].data)) await new Promise((r) => ff.stdin.once("drain", r));
    painted++;
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on("close", (code) => (code ? j(new Error("ffmpeg " + code)) : r())));
  const gaps = frames.slice(1).map((f, k) => f.t - frames[k].t);
  console.log(JSON.stringify({ out: path.relative(ROOT, out), seconds: +(total / 1000).toFixed(1), frames: painted, captured: frames.length, capturedFps: +(frames.length / (total / 1000)).toFixed(1), worstGapMs: Math.round(Math.max(...gaps)), mb: +(fs.statSync(out).size / 1e6).toFixed(1) }));
})().catch((e) => { console.error(e); process.exit(1); });
