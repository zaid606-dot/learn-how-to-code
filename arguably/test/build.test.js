import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Both builds must produce a page whose script parses. A stray quote in a template once shipped
// a page that couldn't start, so this runs with the fast unit tests.
for (const flags of [[], ["--store"]]) {
  test(`build ${flags.join(" ") || "(claude.ai)"}: the page script parses`, () => {
    const out = join(mkdtempSync(join(tmpdir(), "arguably-")), "page.html");
    execFileSync("node", ["scripts/build-artifact.mjs", ...flags, out], { cwd: new URL("..", import.meta.url) });
    const html = readFileSync(out, "utf8");
    const js = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
    assert.doesNotThrow(() => new Function(js));
    assert.match(js, new RegExp(`const STORE_BUILD = ${flags.length > 0};`));
  });
}
