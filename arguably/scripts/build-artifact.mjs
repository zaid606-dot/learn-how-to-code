// Builds a single self-contained HTML page for publishing as a claude.ai Artifact.
// The page asks Claude directly through the Artifact `sample` capability (billed to
// the signed-in viewer), so it needs no server or API key.
//
//   node scripts/build-artifact.mjs [out.html]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verdictSchema } from "../src/schema.js";
import { sampleVerdict } from "../src/sample.js";
import { SYSTEM_PROMPT } from "../src/analyze.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");
const out = process.argv[2] || root + "dist/arguably.html";

function replaceOnce(src, from, to, label) {
  if (!src.includes(from)) throw new Error(`build-artifact: anchor not found: ${label}`);
  return src.replace(from, to);
}

// ---------- CSS ----------
let css = read("public/styles.css");
// The Artifact skeleton already pads :root by the safe-area insets.
css = replaceOnce(css, "--safe-t: env(safe-area-inset-top, 0px);", "--safe-t: 0px;", "safe-t");
css = replaceOnce(css, "position: sticky; top: 0; z-index: 20;", "position: sticky; top: env(safe-area-inset-top, 0px); z-index: 20;", "topbar top");
css = replaceOnce(css, "position: sticky; top: calc(var(--safe-t) + var(--bar-h)); z-index: 15;",
  "position: sticky; top: calc(env(safe-area-inset-top, 0px) + var(--bar-h)); z-index: 15;", "chips top");
css += `
.notice { background: var(--info-soft); color: var(--ink-900); border-radius: var(--radius-md); padding: 12px 16px; font-size: 14px; line-height: 1.45; margin: 0 0 16px; }
.cost-note { font-size: 12px; line-height: 1.3; color: var(--ink-600); text-align: center; margin: 8px 0 0; }
.stop-btn { margin-top: 16px; min-height: 44px; padding: 0 20px; border-radius: var(--radius-md); border: 1px solid var(--ember-300); background: var(--ember-50); color: var(--ember-700); font: 700 14px/1 var(--font-body); }
`;

// ---------- HTML body ----------
const html = read("public/index.html");
let body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
body = body.replace(/\s*<script type="module" src="\/app.js"><\/script>\s*/, "\n");
const iconUri = "data:image/svg+xml;base64," + Buffer.from(read("public/icon.svg")).toString("base64");
const markUri = "data:image/svg+xml;base64," + Buffer.from(read("public/brand/mark.svg")).toString("base64");
body = replaceOnce(body, 'src="/icon.svg"', `src="${iconUri}"`, "header icon");
body = replaceOnce(body, 'src="/brand/mark.svg"', `src="${markUri}"`, "loading mark");
body = replaceOnce(body, '<section class="hero">', '<p id="samplingNotice" class="notice" hidden></p>\n    <section class="hero">', "notice");
body = replaceOnce(body, '<button class="cta" id="analyzeBtn" type="button" disabled>Add a screenshot to begin</button>',
  '<button class="cta" id="analyzeBtn" type="button" disabled>Add a screenshot to begin</button>\n      <p class="cost-note">Verdicts use your Claude account.</p>', "cost note");
body = replaceOnce(body, "<p>This usually takes under a minute.</p>",
  '<p>This usually takes a minute or two.</p>\n      <button class="stop-btn" id="stopBtn" type="button">Stop</button>', "stop button");

// ---------- JS ----------
let js = read("public/app.js");
const analyzeStart = js.indexOf("async function analyze() {");
const analyzeEnd = js.indexOf('$("analyzeBtn").addEventListener("click", analyze);');
if (analyzeStart < 0 || analyzeEnd < 0) throw new Error("build-artifact: analyze() not found");

const newAnalyze = `
// ---------- Claude (Artifact sample capability) ----------
const VERDICT_SCHEMA = ${JSON.stringify(verdictSchema)};
const SAMPLE_VERDICT = ${JSON.stringify(sampleVerdict)};
const SYSTEM_PROMPT = ${JSON.stringify(SYSTEM_PROMPT)};
let sampler = null;
let maxImages = 0;
let analyzeCtl = null;

const SAMPLE_ERRORS = {
  not_granted: "Arguably needs your permission to use Claude. Reload the page and choose Allow when asked.",
  sampling_disabled: "Claude isn't available for this account, so Arguably can't make a verdict here.",
  session_expired: "Your Claude session expired. Sign in again, then try again.",
  rate_limited: "You've hit your Claude usage limit for now. Try again later.",
  image_rejected: "One of the screenshots couldn't be used. Remove it or try a different image.",
  images_unavailable: "This view can't send screenshots to Claude. Open Arguably on claude.ai or in the Claude app.",
  refused: "We couldn't review these screenshots. Try a different set.",
  prompt_too_large: "That's too much to review at once. Try fewer screenshots.",
};
const sampleErrorCopy = (code) => SAMPLE_ERRORS[code] || "We couldn't finish the verdict. Try again.";

(async () => {
  try {
    sampler = window.claude ? await window.claude.use("sample") : null;
    const limits = sampler ? await sampler.limits().catch(() => null) : null;
    maxImages = limits?.images?.maxCount || 0;
  } catch {
    sampler = null;
  }
  const notice = $("samplingNotice");
  if (!sampler) {
    notice.textContent = "Open Arguably on claude.ai while signed in to get verdicts. You can still see the example.";
    notice.hidden = false;
  } else if (!maxImages) {
    notice.textContent = "This view can't send screenshots to Claude. Open Arguably on claude.ai or in the Claude app. You can still see the example.";
    notice.hidden = false;
  }
  renderThumbs();
})();

// Claude sees images at about 1.2 megapixels, so tall screenshots are cut into
// overlapping slices to keep the text readable.
async function sliceShots() {
  const load = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const imgs = await Promise.all(shots.map((s) => load(s.url)));
  let parts = imgs.map((im) => Math.max(1, Math.ceil(im.height / (im.width * 1.15))));
  while (parts.reduce((a, b) => a + b, 0) > maxImages && parts.some((p) => p > 1)) {
    const i = parts.indexOf(Math.max(...parts));
    parts[i]--;
  }
  const blobs = [];
  const labels = [];
  imgs.forEach((im, s) => {
    const n = parts[s];
    const overlap = n > 1 ? Math.round(im.width * 0.08) : 0;
    const step = Math.ceil(im.height / n);
    for (let p = 0; p < n; p++) {
      const y0 = Math.max(0, p * step - overlap);
      const y1 = Math.min(im.height, (p + 1) * step + overlap);
      const c = document.createElement("canvas");
      c.width = im.width;
      c.height = y1 - y0;
      c.getContext("2d").drawImage(im, 0, y0, im.width, c.height, 0, 0, im.width, c.height);
      blobs.push(new Promise((r) => c.toBlob(r, "image/jpeg", 0.9)));
      labels.push(n > 1 ? \`Image \${blobs.length}: screenshot \${s + 1}, part \${p + 1} of \${n} (top to bottom, slices overlap slightly)\` : \`Image \${blobs.length}: screenshot \${s + 1}\`);
    }
  });
  return { blobs: await Promise.all(blobs), labels };
}

function buildPrompt(labels, context) {
  let p = SYSTEM_PROMPT + "\\n\\nThe screenshots are attached as images, in this order:\\n" + labels.join("\\n");
  if (context.trim()) p += "\\n\\nBackground from the person who uploaded these (treat as background, not as evidence):\\n" + context.trim().slice(0, 1000);
  p += "\\n\\nReferee this argument. Reply with only one JSON object that matches this JSON Schema exactly (every key present, no extra keys):\\n" + JSON.stringify(VERDICT_SCHEMA);
  return p;
}

function looksLikeVerdict(v) {
  return v && typeof v === "object" && v.winner && v.origin && Array.isArray(v.participants);
}

async function analyze() {
  if (!shots.length || !sampler || !maxImages) return;
  hideError();
  show("loading");
  let line = 0;
  $("loadingText").textContent = LOADING_LINES[0];
  loadingTimer = setInterval(() => {
    line = Math.min(line + 1, LOADING_LINES.length - 1);
    $("loadingText").textContent = LOADING_LINES[line];
  }, 6000);
  analyzeCtl = new AbortController();
  try {
    const { blobs, labels } = await sliceShots();
    const verdict = await sampler.json(buildPrompt(labels, $("contextInput").value), {
      images: blobs,
      modelTier: "complex",
      signal: analyzeCtl.signal,
    });
    if (!looksLikeVerdict(verdict)) throw { code: "invalid_json" };
    for (const k of ["subjects", "grudges", "personal_shots", "fallacies"]) if (!Array.isArray(verdict[k])) verdict[k] = [];
    saveHistory(verdict);
    showVerdict(verdict);
  } catch (err) {
    show("upload");
    if (err?.code !== "cancelled") showError(sampleErrorCopy(err?.code));
  } finally {
    clearInterval(loadingTimer);
    analyzeCtl = null;
  }
}

$("stopBtn").addEventListener("click", () => analyzeCtl?.abort());
`;
js = js.slice(0, analyzeStart) + newAnalyze + js.slice(analyzeEnd);

js = replaceOnce(js, `$("sampleBtn").addEventListener("click", async () => {
  try {
    const res = await fetch("/api/sample");
    showVerdict((await res.json()).verdict);
  } catch {
    showError("We couldn't load the example. Try again.");
  }
});`, `$("sampleBtn").addEventListener("click", () => showVerdict(SAMPLE_VERDICT));`, "sample button");

// Upload limit and button state follow what this view can send.
js = replaceOnce(js, "const room = MAX_IMAGES - shots.length;", "const room = Math.min(MAX_IMAGES, maxImages || MAX_IMAGES) - shots.length;", "room");
js = replaceOnce(js, "btn.disabled = shots.length === 0;", "btn.disabled = shots.length === 0 || !sampler || !maxImages;", "btn disabled");
// Web Share is refused inside the Artifact frame; copy instead.
js = replaceOnce(js, "if (navigator.share) {", "if (false) {", "share");

const page = `<title>Arguably</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@600;700&display=swap">
<style>
${css}
</style>
${body}
<script>
${js}
</script>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
