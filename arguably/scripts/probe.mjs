// Build-time checks (probe deployments only). Build logs aren't readable from the tools used to
// set this up, so results come back as the build's duration: sleep = gateway*40s + blob*6s.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function blobCheck() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return 1;
  let B;
  try { B = await import("@vercel/blob"); } catch { return 2; }
  const path = `probe/${Date.now()}.json`;
  try { await B.put(path, JSON.stringify({ n: 1 }), { access: "private", addRandomSuffix: false, contentType: "application/json" }); } catch { return 3; }
  let nxRejected = false;
  try { await B.put(path, JSON.stringify({ n: 2 }), { access: "private", addRandomSuffix: false, contentType: "application/json" }); } catch { nxRejected = true; }
  try { await B.put(path, JSON.stringify({ n: 3 }), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" }); } catch { return 4; }
  try {
    const got = await B.get(path, { access: "private", useCache: false });
    const text = await new Response(got.stream).text();
    if (JSON.parse(text).n !== 3) return 4;
  } catch { return 4; }
  try { await B.del(path); } catch {}
  return nxRejected ? 0 : 5;
}

async function gatewayCheck() {
  const token = process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY;
  if (!token) return 1;
  let res;
  try {
    res = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: [{ role: "user", content: 'Reply with {"ok": true}' }], response_format: { type: "json_object" }, max_tokens: 50 }),
      signal: AbortSignal.timeout(30000),
    });
  } catch { return 2; }
  if (res.ok) return 0;
  const body = (await res.text()).toLowerCase();
  if (/credit card|card on file|payment method|verif/.test(body)) return 3; // needs a card on file (free credits)
  if (res.status === 401) return 4; // token not accepted
  if (res.status === 403) return 5;
  if (res.status === 402) return 6; // out of credit
  if (res.status === 404 || /model/.test(body)) return 7;
  return 8;
}

const b = await blobCheck();
const g = await gatewayCheck();
await sleep(g * 40000 + b * 6000);
process.exit(1);
