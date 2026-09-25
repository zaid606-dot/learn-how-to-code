// Shared by the Vercel functions in api/ (files starting with "_" aren't routes).
// Talks to an OpenAI-compatible Chat Completions API with the site's own key, which lives
// only in an environment variable and never reaches the browser:
//   GROQ_API_KEY -> Groq (default model qwen/qwen3.8-27b, which reads images)
//   XAI_API_KEY  -> xAI Grok (default model grok-4.7)
// AI_MODEL / AI_FAST_MODEL override the model for either.

export const PROVIDERS = {
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", key: "GROQ_API_KEY", model: "qwen/qwen3.8-27b", maxImages: 3, tokens: "max_completion_tokens" },
  xai: { url: "https://api.x.ai/v1/chat/completions", key: "XAI_API_KEY", model: "grok-4.7", maxImages: 4, tokens: "max_tokens" },
};
export const provider = () => PROVIDERS[process.env.AI_PROVIDER] || (process.env.GROQ_API_KEY || !process.env.XAI_API_KEY ? PROVIDERS.groq : PROVIDERS.xai);
export const modelFor = (tier) => {
  const main = process.env.AI_MODEL || process.env.XAI_MODEL || provider().model;
  return tier === "quick" ? process.env.AI_FAST_MODEL || main : main;
};

// Plain Node request/response helpers, so the handlers run the same on Vercel and in tests.
export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export async function readBody(req, limit = 4_400_000) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw { status: 413, code: "prompt_too_large" };
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

// Best-effort abuse brake: requests per visitor per window, per server instance. The real
// ceiling is the spending limit set on the xAI account.
const hits = new Map();
export function rateLimited(req, max = Number(process.env.RATE_LIMIT_PER_10_MIN || 40)) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 10 * 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > max;
}

// Only this site's own pages may call the API. Browsers label every request with where it
// came from (Sec-Fetch-Site, Origin); a request with neither didn't come from a browser page,
// so it's turned away. Scripts can fake headers, so this is a brake, not a lock; the spending
// limit on the provider account is the real ceiling.
export function foreignOrigin(req) {
  const site = req.headers["sec-fetch-site"];
  const origin = req.headers.origin;
  if (site) return site !== "same-origin";
  if (!origin) return true;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

// Map a provider error response to the app's error codes.
export function errorCode(status, text = "") {
  if (status === 401 || status === 403) return { status: 500, code: "sampling_disabled" };
  if (status === 429) return { status: 429, code: "rate_limited" };
  if (status === 413 || /context|too (long|large)|maximum.*tokens/i.test(text)) return { status: 413, code: "prompt_too_large" };
  if (status === 400 && /image/i.test(text)) return { status: 400, code: "image_rejected" };
  if (/content.?(policy|filter)|safety|refus/i.test(text)) return { status: 400, code: "refused" };
  return { status: 502, code: "upstream_error" };
}

export async function complete(body, signal) {
  const p = provider();
  const key = process.env[p.key];
  if (!key) throw { status: 500, code: "sampling_disabled", detail: `${p.key} is not set` };
  // Each API names the output cap differently.
  if (body.max_tokens && p.tokens !== "max_tokens") {
    body = { ...body, [p.tokens]: body.max_tokens };
    delete body.max_tokens;
  }
  const res = await fetch(p.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("AI API error", res.status, text.slice(0, 500));
    throw errorCode(res.status, text);
  }
  return res;
}

// The app's turns -> Chat Completions messages. Only user/assistant text passes through.
export function toMessages(turns) {
  return (Array.isArray(turns) ? turns : [])
    .filter((t) => t && (t.role === "user" || t.role === "assistant"))
    .map((t) => ({ role: t.role, content: String(t.content ?? "").slice(0, 60000) }));
}

// Reasoning models may think out loud in <think> tags before answering; people never see that.
export const stripThinking = (text) => String(text || "").replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();

// Pull the JSON object out of a model reply (tolerates thinking, ```json fences or a lead-in line).
export function parseJsonReply(text) {
  const s = stripThinking(text).replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
  try {
    return JSON.parse(s);
  } catch {
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
    throw new Error("not json");
  }
}
