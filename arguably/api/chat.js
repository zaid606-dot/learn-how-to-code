// POST /api/chat {turns, tier} -> newline-delimited JSON stream: {"delta": "..."} per chunk,
// then exactly one of {"done": true, "truncated": bool} or {"error": code}. Used for follow-up
// questions and for the quick second look at poorly read screenshots.
import { send, readBody, rateLimited, foreignOrigin, complete, modelFor, toMessages, thinkFilter, errorCode, fromApp } from "./_ai.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { code: "method_not_allowed" });
  if (foreignOrigin(req)) return send(res, 403, { code: "forbidden" });
  if (rateLimited(req, "chat", Number(process.env.RATE_LIMIT_PER_10_MIN || 40) * 2)) return send(res, 429, { code: "rate_limited" });
  const ctl = new AbortController();
  res.on("close", () => { if (!res.writableEnded) ctl.abort(); }); // the viewer tapped Stop or left
  let upstream;
  try {
    const { turns, tier } = await readBody(req);
    const messages = toMessages(turns);
    if (!messages) return send(res, 413, { code: "prompt_too_large" });
    if (!fromApp(messages[0].content)) return send(res, 403, { code: "forbidden" });
    upstream = await complete({ model: modelFor(tier), messages, stream: true, temperature: 0.5, max_tokens: 4000 }, ctl.signal);
  } catch (err) {
    if (ctl.signal.aborted) return res.end();
    return send(res, err?.status || 500, { code: typeof err?.code === "string" ? err.code : "upstream_error" });
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-store");
  const line = (o) => res.write(JSON.stringify(o) + "\n");
  const think = thinkFilter();
  let finished = false; // the provider said it was done ([DONE] or a finish_reason)
  let truncated = false;
  let visible = 0;
  const emit = (text) => {
    if (!text) return;
    visible += text.length;
    line({ delta: text });
  };
  // One SSE line. Returns an error code to stop with, or "".
  const handle = (rawLine) => {
    const raw = rawLine.trim();
    if (!raw.startsWith("data:")) return "";
    const payload = raw.slice(5).trim();
    if (payload === "[DONE]") {
      finished = true;
      return "";
    }
    let ev;
    try {
      ev = JSON.parse(payload);
    } catch {
      return ""; // a malformed line isn't worth ending the answer over
    }
    if (ev.error) return errorCode(0, JSON.stringify({ error: ev.error })).code;
    const c = ev.choices?.[0];
    if (c?.delta?.content) emit(think.push(c.delta.content));
    if (c?.finish_reason) {
      finished = true;
      if (c.finish_reason === "length") truncated = true;
    }
    return "";
  };
  try {
    const decoder = new TextDecoder();
    let buf = "";
    let failed = "";
    for await (const chunk of upstream.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while (!failed && (nl = buf.indexOf("\n")) >= 0) {
        failed = handle(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
      if (failed) break;
    }
    if (!failed) {
      buf += decoder.decode();
      if (buf) failed = handle(buf); // a last line with no newline still counts
    }
    emit(think.end());
    if (failed) line({ error: failed });
    else if (!visible) line({ error: truncated ? "prompt_too_large" : "invalid_json" }); // all thinking, no answer
    else line({ done: true, truncated: truncated || !finished });
  } catch {
    if (!ctl.signal.aborted) line({ error: "upstream_error" });
  }
  res.end();
}
