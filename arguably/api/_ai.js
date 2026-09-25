// Shared by the Vercel functions in api/ (files starting with "_" aren't routes).
// Talks to an OpenAI-compatible Chat Completions API with the site's own key, which lives
// only in an environment variable and never reaches the browser:
//   GROQ_API_KEY -> Groq (default model qwen/qwen3.8-27b, which reads images)
//   XAI_API_KEY  -> xAI Grok (default model grok-4.7)
// AI_PROVIDER (groq|xai) picks one when both keys are set; AI_MODEL / AI_FAST_MODEL override
// the model. The build (scripts/build-artifact.mjs --web) names the AI with the same rules.

export const PROVIDERS = {
  groq: { id: "groq", url: "https://api.groq.com/openai/v1/chat/completions", key: "GROQ_API_KEY", model: "qwen/qwen3.8-27b", maxImages: 3, tokens: "max_completion_tokens", name: "Qwen", maker: "Alibaba, running on Groq" },
  xai: { id: "xai", url: "https://api.x.ai/v1/chat/completions", key: "XAI_API_KEY", model: "grok-4.7", maxImages: 4, tokens: "max_tokens", name: "Grok", maker: "xAI" },
};
export function provider(env = process.env) {
  if (PROVIDERS[env.AI_PROVIDER]) return PROVIDERS[env.AI_PROVIDER];
  return env.GROQ_API_KEY || !env.XAI_API_KEY ? PROVIDERS.groq : PROVIDERS.xai;
}
export const modelFor = (tier, env = process.env) => {
  const p = provider(env);
  const main = env.AI_MODEL || (p.id === "xai" && env.XAI_MODEL) || p.model;
  return tier === "quick" ? env.AI_FAST_MODEL || main : main;
};

// Size limits, matched to what the app sends (it trims to fit well under these).
export const LIMITS = { jsonPrompt: 200_000, chatTotal: 90_000, chatTurns: 30, body: 4_400_000 };
// Every request the app makes starts with one of its own instructions. Anything else isn't
// the app, so the site can't be used as a free general-purpose AI.
const APP_PROMPTS = ["You are Arguably", "Transcribe these screenshots", "These are text lines read on the user's phone"];
export const fromApp = (text) => typeof text === "string" && APP_PROMPTS.some((p) => text.startsWith(p));

// Plain Node request/response helpers, so the handlers run the same on Vercel and in tests.
export function send(res, status, body) {
  if (res.headersSent) return res.end();
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

// The request body as an object, or a {status, code} error for anything malformed.
export async function readBody(req, limit = LIMITS.body) {
  let body;
  try {
    // On Vercel req.body is pre-parsed (and throws on bad JSON); elsewhere, read the stream.
    body = req.body;
    if (body === undefined) {
      let size = 0;
      const chunks = [];
      for await (const c of req) {
        size += c.length;
        if (size > limit) throw { status: 413, code: "prompt_too_large" };
        chunks.push(c);
      }
      body = Buffer.concat(chunks).toString("utf8") || "{}";
    }
    if (typeof body === "string") body = JSON.parse(body);
  } catch (err) {
    if (err?.code === "prompt_too_large") throw err;
    throw { status: 400, code: "invalid_request" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw { status: 400, code: "invalid_request" };
  return body;
}

// Best-effort abuse brake: a fixed window per visitor, per endpoint, per server instance.
// Blocked requests don't extend the block, old entries are evicted (never a wholesale reset),
// and IPv6 visitors are grouped by /64 so rotating addresses doesn't help. The real ceiling
// is the spending limit on the provider account.
const WINDOW = 10 * 60_000;
const MAX_TRACKED = 50_000; // visitors remembered per endpoint (a few MB at most)
const buckets = new Map(); // endpoint -> Map(ip -> {start, count})
let lastSweep = 0;
export function clientIp(req) {
  const raw = String(req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0] || req.socket?.remoteAddress || "?").trim();
  if (raw.includes(":") && !raw.startsWith("::ffff:")) return raw.split(":").slice(0, 4).join(":") + "::/64";
  return raw.replace(/^::ffff:/, "");
}
export function rateLimited(req, endpoint, max = Number(process.env.RATE_LIMIT_PER_10_MIN || 40)) {
  let map = buckets.get(endpoint);
  if (!map) buckets.set(endpoint, (map = new Map()));
  const now = Date.now();
  // Clear out finished windows at most once a minute, so a busy instance never scans per call.
  if (map.size > 5000 && now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, v] of map) if (now - v.start >= WINDOW) map.delete(k);
  }
  // Hard ceiling on memory: forget the longest-tracked visitors first.
  if (map.size > MAX_TRACKED) for (const k of map.keys()) { map.delete(k); if (map.size <= MAX_TRACKED) break; }
  const ip = clientIp(req);
  let b = map.get(ip);
  if (!b || now - b.start >= WINDOW) map.set(ip, (b = { start: now, count: 0 }));
  if (b.count >= max) return true;
  b.count++;
  return false;
}
export const _resetRateLimits = () => buckets.clear(); // for tests

// Only this site's own pages may call the API. Browsers label every request with where it
// came from (Sec-Fetch-Site, Origin); a request with neither didn't come from a browser page,
// so it's turned away. Scripts can fake headers, so this is a brake, not a lock.
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

// Map a provider error to the app's error codes, from the provider's own error fields only.
// (Error bodies can echo the model's partial output, which quotes the user's conversation.)
export function errorCode(status, bodyText = "") {
  let e = {};
  try {
    e = JSON.parse(bodyText)?.error || {};
  } catch {}
  const code = String(e.code || "");
  const type = String(e.type || "");
  const msg = String(e.message || "");
  if (status === 401 || status === 403) return { status: 500, code: "sampling_disabled" };
  if (status === 429 || status === 503 || status === 498 || /rate_limit|capacity|overloaded/i.test(code + type)) return { status: 429, code: "rate_limited" };
  if (code === "json_validate_failed") return { status: 502, code: "invalid_json" };
  if (status === 413 || /context_length|request_too_large|context_window_exceeded/i.test(code + type)) return { status: 413, code: "prompt_too_large" };
  if (status === 400 && /image/i.test(code + type)) return { status: 400, code: "image_rejected" };
  if (/content_filter|content_policy|safety/i.test(code + type) || /^content (?:policy|filter)/i.test(msg)) return { status: 400, code: "refused" };
  return { status: 502, code: "upstream_error" };
}

// One call to the provider. Stops when the viewer stops, and gives up before the function's
// own time limit so the provider isn't left generating (and billing) after Vercel kills it.
export async function complete(body, signal, timeoutMs = 110_000) {
  const p = provider();
  const key = process.env[p.key];
  if (!key) throw { status: 500, code: "sampling_disabled" };
  // Each API names the output cap differently.
  if (body.max_tokens && p.tokens !== "max_tokens") {
    body = { ...body, [p.tokens]: body.max_tokens };
    delete body.max_tokens;
  }
  const timeout = AbortSignal.timeout(timeoutMs);
  let res;
  try {
    res = await fetch(p.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    if (signal?.aborted) throw { status: 499, code: "cancelled" };
    throw { status: 504, code: timeout.aborted ? "rate_limited" : "upstream_error" };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const mapped = errorCode(res.status, text);
    // Log only the status and the provider's error code, never the body (it can quote the chat).
    let pcode = "";
    try {
      pcode = JSON.parse(text)?.error?.code || "";
    } catch {}
    console.error("AI API error", res.status, pcode, "->", mapped.code);
    throw mapped;
  }
  return res;
}

// The app's turns -> Chat Completions messages, or null when they're too large or not the app's.
export function toMessages(turns) {
  if (!Array.isArray(turns) || !turns.length || turns.length > LIMITS.chatTurns) return null;
  const msgs = turns
    .filter((t) => t && (t.role === "user" || t.role === "assistant"))
    .map((t) => ({ role: t.role, content: String(t.content ?? "") }));
  const total = msgs.reduce((n, m) => n + m.content.length, 0);
  if (!msgs.length || total > LIMITS.chatTotal) return null;
  return msgs;
}

// Reasoning models may think out loud in <think> tags before answering; people never see that.
export const stripThinking = (text) => String(text || "").replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();

// Streaming version: feed chunks in, get back only text that's final and outside <think>.
// Holds back a trailing piece that could be the start of a tag until the next chunk decides it.
export function thinkFilter() {
  const OPEN = "<think>";
  const CLOSE = "</think>";
  let inside = false;
  let held = "";
  let started = false; // leading whitespace before the answer is dropped
  const partialAt = (s, tag) => {
    for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) if (tag.startsWith(s.slice(-k))) return s.length - k;
    return -1;
  };
  function push(chunk, final = false) {
    let s = held + chunk;
    held = "";
    let out = "";
    for (;;) {
      if (inside) {
        const i = s.indexOf(CLOSE);
        if (i < 0) {
          const p = final ? -1 : partialAt(s, CLOSE);
          held = p >= 0 ? s.slice(p) : "";
          break;
        }
        s = s.slice(i + CLOSE.length);
        inside = false;
      } else {
        const i = s.indexOf(OPEN);
        if (i < 0) {
          const p = final ? -1 : partialAt(s, OPEN);
          if (p >= 0) {
            held = s.slice(p);
            s = s.slice(0, p);
          }
          out += s;
          break;
        }
        out += s.slice(0, i);
        s = s.slice(i + OPEN.length);
        inside = true;
      }
    }
    if (!started) {
      out = out.replace(/^\s+/, "");
      if (out) started = true;
    }
    return out;
  }
  return { push, end: () => push("", true) };
}

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
