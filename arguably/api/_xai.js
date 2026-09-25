// Shared by the Vercel functions in api/ (files starting with "_" aren't routes).
// Talks to xAI's OpenAI-compatible Chat Completions API with the site's own key, which
// lives only in the XAI_API_KEY environment variable and never reaches the browser.

const XAI_URL = process.env.XAI_BASE_URL || "https://api.x.ai/v1/chat/completions";
export const modelFor = (tier) =>
  tier === "quick" ? process.env.XAI_FAST_MODEL || process.env.XAI_MODEL || "grok-4.7" : process.env.XAI_MODEL || "grok-4.7";

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

// Only this site's own pages may call the API from a browser.
export function foreignOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

// Map an xAI error response to the app's error codes.
export function errorCode(status, text = "") {
  if (status === 401 || status === 403) return { status: 500, code: "sampling_disabled" };
  if (status === 429) return { status: 429, code: "rate_limited" };
  if (status === 413 || /context|too (long|large)|maximum.*tokens/i.test(text)) return { status: 413, code: "prompt_too_large" };
  if (status === 400 && /image/i.test(text)) return { status: 400, code: "image_rejected" };
  if (/content.?(policy|filter)|safety|refus/i.test(text)) return { status: 400, code: "refused" };
  return { status: 502, code: "upstream_error" };
}

export async function xai(body, signal) {
  const key = process.env.XAI_API_KEY;
  if (!key) throw { status: 500, code: "sampling_disabled", detail: "XAI_API_KEY is not set" };
  const res = await fetch(XAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("xAI error", res.status, text.slice(0, 500));
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

// Pull the JSON object out of a model reply (tolerates ```json fences or a lead-in line).
export function parseJsonReply(text) {
  const s = String(text || "").replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
  try {
    return JSON.parse(s);
  } catch {
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
    throw new Error("not json");
  }
}
