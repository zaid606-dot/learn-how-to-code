// Builds Arguably's chat app as one self-contained HTML page for a claude.ai Artifact.
// The page talks to Claude through the Artifact `sample` capability (billed to the
// signed-in viewer), so it needs no server or API key.
//
//   node scripts/build-artifact.mjs [out.html]
// Publish with capabilities: {sample: {}}.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verdictSchema } from "../src/schema.js";
import { sampleVerdict } from "../src/sample.js";
import { SYSTEM_PROMPT } from "../src/analyze.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");
const out = process.argv[2] || root + "dist/arguably.html";
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

const body = read("artifact/chat.html").replace("__ICON_URI__", dataUri("public/icon.svg"));

const constants = [
  `const VERDICT_SCHEMA = ${JSON.stringify(verdictSchema)};`,
  `const SAMPLE_VERDICT = ${JSON.stringify(sampleVerdict)};`,
  `const SYSTEM_PROMPT = ${JSON.stringify(SYSTEM_PROMPT)};`,
].join("\n");
const js = read("artifact/pipeline.cjs") + "\n" + replaceOnce(read("artifact/chat.js"), "/*__CONSTANTS__*/", constants, "constants");

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
