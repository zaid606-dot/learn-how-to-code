// Builds Arguably's chat app as one self-contained HTML page for a claude.ai Artifact.
// The page talks to Claude through the Artifact `sample` capability (billed to the
// signed-in viewer), so it needs no server or API key.
//
//   node scripts/build-artifact.mjs [out.html]
// Publish with capabilities: {sample: {}} and the files in dist/ocr/ alongside the page.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verdictSchema } from "../src/schema.js";
import { sampleVerdict } from "../src/sample.js";
import { SYSTEM_PROMPT } from "../src/analyze.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");
// --store builds the App Store variant (Pro gate on); the default is the free claude.ai page.
const store = process.argv.includes("--store");
// --web builds a standalone site for Vercel (web-dist/): the AI is reached through this
// site's /api functions (see api/) instead of the claude.ai capability.
const web = process.argv.includes("--web");
const AI = web
  ? { name: process.env.AI_NAME || "Grok", maker: process.env.AI_MAKER || "xAI" }
  : { name: "Claude", maker: "Anthropic" };
const out =
  process.argv.slice(2).find((a) => !a.startsWith("--")) ||
  root + (web ? "web-dist/index.html" : store ? "dist/arguably-store.html" : "dist/arguably.html");
const dataUri = (p) => "data:image/svg+xml;base64," + Buffer.from(read(p)).toString("base64");

function replaceOnce(src, from, to, label) {
  if (!src.includes(from)) throw new Error(`build-artifact: anchor not found: ${label}`);
  return src.replace(from, to);
}

// Shared brand styles. The Artifact skeleton already pads :root by the safe-area insets.
let css = read("public/styles.css");
css = replaceOnce(css, "--safe-t: env(safe-area-inset-top, 0px);", "--safe-t: 0px;", "safe-t");
css = replaceOnce(css, "position: sticky; top: 0; z-index: 20;", "position: sticky; top: env(safe-area-inset-top, 0px); z-index: 20;", "topbar top");
css += "\n" + read("artifact/chat.css");

const body = read("artifact/chat.html")
  .replace("__ICON_URI__", dataUri("public/icon.svg"))
  .replace("__COST_NOTE__", web ? `Verdicts by ${AI.name}. Double-check anything important.` : "Replies use your Claude account.");

const constants = [
  `const VERDICT_SCHEMA = ${JSON.stringify(verdictSchema)};`,
  `const SAMPLE_VERDICT = ${JSON.stringify(sampleVerdict)};`,
  `const SYSTEM_PROMPT = ${JSON.stringify(SYSTEM_PROMPT)};`,
  `const MARK_URI = ${JSON.stringify(dataUri("public/brand/mark.svg"))};`,
  `const STORE_BUILD = ${store};`,
  `const HOSTED = ${web};`,
  `const AI_NAME = ${JSON.stringify(AI.name)};`,
  `const AI_MAKER = ${JSON.stringify(AI.maker)};`,
].join("\n");
const js = read("artifact/pipeline.cjs") + "\n" + replaceOnce(read("artifact/chat.js"), "/*__CONSTANTS__*/", constants, "constants");

let page = `<title>Arguably</title>
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
// A standalone site needs the document shell the Artifact host otherwise provides, plus
// home-screen icons so it can be added to a phone like an app.
if (web) {
  page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#FFF7F3">
<meta name="description" content="Drop in screenshots from both sides of an argument and get a fair verdict.">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Arguably">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>[hidden]{display:none!important}html,body{margin:0}:root{padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}</style>
<script>
${read("artifact/web-shim.js")}
</script>
</head>
<body>
${page}
</body>
</html>
`;
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
if (web) {
  for (const f of ["manifest.webmanifest", "icon.svg", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "icon-32.png", "icon-16.png"]) {
    if (existsSync(root + "public/" + f)) copyFileSync(root + "public/" + f, dirname(out) + "/" + f);
  }
}

// On-device OCR files, published next to the page (see scripts/fetch-ocr.sh).
const ocrOut = dirname(out) + "/ocr";
mkdirSync(ocrOut, { recursive: true });
copyFileSync(root + "artifact/ocr/ocr-worker.js", ocrOut + "/ocr-worker.js");
const vendor = (f) => {
  if (!existsSync(root + "vendor/ocr/" + f)) throw new Error(`build-artifact: vendor/ocr/${f} missing. Run scripts/fetch-ocr.sh first.`);
  return root + "vendor/ocr/" + f;
};
for (const f of ["tesseract-core-simd-lstm.wasm.js", "tesseract-core-lstm.wasm.js"]) copyFileSync(vendor(f), ocrOut + "/" + f);
for (const f of ["LICENSE-tesseract-core", "LICENSE-tessdata"]) copyFileSync(vendor(f), ocrOut + "/" + f + ".txt");
// Artifacts serve scripts but not raw binary files, so the language data ships as base64 in a script.
writeFileSync(ocrOut + "/eng-traineddata.js", `self.ENG_TRAINEDDATA_B64=${JSON.stringify(readFileSync(vendor("eng.traineddata")).toString("base64"))};\n`);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
