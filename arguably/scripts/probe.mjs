// Build-time check of the Vercel AI Gateway (used only in probe deployments).
// Vercel's build logs aren't readable from the tools used to set this up, so the result is
// reported through the build's duration: on failure it waits CODE*20 seconds, then fails.
const PREFER = ["google/gemini-2.5-flash", "google/gemini-3-flash", "google/gemini-2.5-flash-lite", "openai/gpt-5-mini", "openai/gpt-4.1-mini", "anthropic/claude-haiku-4.5"];
const fail = async (code) => {
  await new Promise((r) => setTimeout(r, code * 20000));
  process.exit(1);
};
const token = process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY;
if (!token) await fail(1);
let models;
try {
  const r = await fetch("https://ai-gateway.vercel.sh/v1/models", { signal: AbortSignal.timeout(15000) });
  models = (await r.json()).data.map((m) => m.id);
} catch {
  await fail(2);
}
const model = PREFER.find((m) => models.includes(m));
if (!model) await fail(3);
let res;
try {
  res = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: 'Reply with the JSON object {"ok": true} and nothing else.' }], response_format: { type: "json_object" }, temperature: 0, max_tokens: 50 }),
    signal: AbortSignal.timeout(30000),
  });
} catch {
  await fail(4);
}
if (res.status === 401 || res.status === 403) await fail(5);
if (res.status === 402 || res.status === 429) await fail(6);
if (!res.ok) await fail(7);
const text = (await res.json())?.choices?.[0]?.message?.content || "";
if (!/"ok"\s*:\s*true/.test(text)) await fail(8);
// Which model answered: the index in PREFER, as extra seconds (0..5).
await new Promise((r) => setTimeout(r, PREFER.indexOf(model) * 5000));
process.exit(1); // probe deployments always fail on purpose; success = short build
