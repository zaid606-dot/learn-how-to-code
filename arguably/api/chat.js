// POST /api/chat {turns, tier} -> newline-delimited JSON stream: {"delta": "..."} per chunk,
// then {"done": true, "truncated": bool}, or {"error": code}. Used for follow-up questions
// and for the quick second look at poorly read screenshots.
import { send, readBody, rateLimited, foreignOrigin, complete, modelFor, toMessages, stripThinking } from "./_ai.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { code: "method_not_allowed" });
  if (foreignOrigin(req)) return send(res, 403, { code: "forbidden" });
  if (rateLimited(req, Number(process.env.RATE_LIMIT_PER_10_MIN || 40) * 2)) return send(res, 429, { code: "rate_limited" });
  const ctl = new AbortController();
  res.on("close", () => ctl.abort()); // the viewer tapped Stop or left
  let upstream;
  try {
    const { turns, tier } = await readBody(req);
    const messages = toMessages(turns);
    if (!messages.length) return send(res, 400, { code: "invalid_request" });
    upstream = await complete({ model: modelFor(tier), messages, stream: true, temperature: 0.5, max_tokens: 4000 }, ctl.signal);
  } catch (err) {
    if (ctl.signal.aborted) return;
    return send(res, err?.status || 500, { code: err?.code || "upstream_error" });
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-store");
  const line = (o) => res.write(JSON.stringify(o) + "\n");
  let truncated = false;
  let raw_ = "";
  let sent = 0;
  try {
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of upstream.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const raw = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!raw.startsWith("data:")) continue;
        const payload = raw.slice(5).trim();
        if (payload === "[DONE]") continue;
        const ev = JSON.parse(payload);
        const c = ev.choices?.[0];
        if (c?.delta?.content) {
          // Hold back anything inside <think>…</think>; only the answer streams to the page.
          raw_ += c.delta.content;
          const visible = stripThinking(raw_);
          if (visible.length > sent) {
            line({ delta: visible.slice(sent) });
            sent = visible.length;
          }
        }
        if (c?.finish_reason === "length") truncated = true;
      }
    }
    line({ done: true, truncated });
  } catch (err) {
    if (!ctl.signal.aborted) line({ error: "upstream_error" });
  }
  res.end();
}
