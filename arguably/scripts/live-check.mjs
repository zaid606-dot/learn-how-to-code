// Live end-to-end check of accounts, sync and the verdict vault against the project's real
// storage, run inside a (preview) Vercel build. Passing = the build succeeds. On failure the build
// waits STEP*15 seconds before failing, so the failing step can be read from the build's length
// (build logs aren't readable from the tools used to set this up).
import http from "node:http";
// Emergency switch: set SKIP_LIVE_CHECK=1 in Vercel to deploy even if storage is down.
if (process.env.SKIP_LIVE_CHECK === "1") process.exit(0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let step = 0;
let cleanup = async () => {};
async function check(ok) {
  step++;
  if (!ok) {
    await cleanup().catch(() => {}); // never leave the test account behind
    await sleep(step * 15000);
    process.exit(1);
  }
}
const { default: auth } = await import("../api/auth.js");
const { default: sync } = await import("../api/sync.js");
const { default: vault } = await import("../api/verdicts.js");
const { storeConfig } = await import("../api/_store.js");
await check(storeConfig()?.kind === "blob" || storeConfig()?.kind === "redis"); // 1

const server = http.createServer((req, res) => (req.url.startsWith("/api/auth") ? auth : req.url.startsWith("/api/sync") ? sync : vault)(req, res));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const phone = () => {
  let cookie = "";
  return async (path, method = "GET", body) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", ...(cookie ? { Cookie: cookie } : {}) }, body: body && JSON.stringify(body) });
    const set = r.headers.get("set-cookie");
    if (set) cookie = /Max-Age=0/.test(set) ? "" : set.split(";")[0];
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
};
const email = `live-check-${Date.now()}@example.com`;
const { redis } = await import("../api/_store.js");
let vaultId = "";
cleanup = async () => {
  const id = await redis(["GET", `user:email:${email}`]);
  if (typeof id === "string") {
    for (const k of [`chats:${id}`, `deleted:${id}`, `prefs:${id}`, `user:${id}`]) await redis(["DEL", k]);
    const sessions = (await redis(["SMEMBERS", `sessions:${id}`])) || [];
    for (const k of sessions) await redis(["DEL", `session:${k}`]);
    await redis(["DEL", `sessions:${id}`]);
    await redis(["DEL", `user:email:${email}`]);
  }
  if (vaultId) await redis(["DEL", `v:${vaultId}`]);
};
const a = phone(), b = phone();
const signup = await a("/api/auth?op=signup", "POST", { email, password: "live check pw 1" });
await check(signup.status === 200 && !!signup.data.recoveryCode); // 2
await check((await a("/api/auth?op=me")).data.user?.email === email); // 3
await check((await a("/api/sync", "PUT", { chat: { id: "live1", title: "Live", updatedAt: 1, messages: [] } })).status === 200); // 4
await check((await b("/api/auth?op=login", "POST", { email, password: "live check pw 1" })).status === 200); // 5
await check((await b("/api/sync")).data.chats?.[0]?.title === "Live"); // 6
await check((await b("/api/sync?id=live1", "DELETE")).status === 200 && (await a("/api/sync", "PUT", { chat: { id: "live1", messages: [] } })).status === 410); // 7
const rec = await phone()("/api/auth?op=recover", "POST", { email, code: signup.data.recoveryCode, password: "live check pw 2" });
await check(rec.status === 200 && rec.data.recoveryCode !== signup.data.recoveryCode); // 8
await check((await a("/api/auth?op=me")).data.user === null); // 9: other sessions ended
const c = phone();
await check((await c("/api/auth?op=login", "POST", { email, password: "live check pw 2" })).status === 200); // 10
const id = (vaultId = [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join(""));
await check((await c("/api/verdicts", "POST", { id, blob: "A".repeat(60) })).data.blob === "A".repeat(60)); // 11
await check((await c("/api/verdicts", "POST", { id, blob: "B".repeat(60) })).data.blob === "A".repeat(60)); // 12
await check((await c("/api/auth?op=delete", "POST", { password: "live check pw 2" })).status === 200); // 13
await check((await phone()("/api/auth?op=login", "POST", { email, password: "live check pw 2" })).status === 401); // 14
await cleanup(); // the test verdict and any leftovers
server.close();
process.exit(0);
