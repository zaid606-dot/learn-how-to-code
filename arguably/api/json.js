// POST /api/json {prompt, images: [dataUrl], tier} -> the JSON object the model returns.
// Used for reading screenshots and for verdicts.
import { send, readBody, rateLimited, foreignOrigin, complete, modelFor, parseJsonReply, provider, fromApp, LIMITS } from "./_ai.js";

const IMAGE = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/;

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { code: "method_not_allowed" });
  if (foreignOrigin(req)) return send(res, 403, { code: "forbidden" });
  if (rateLimited(req, "json")) return send(res, 429, { code: "rate_limited" });
  const ctl = new AbortController();
  res.on("close", () => { if (!res.writableEnded) ctl.abort(); }); // the viewer tapped Stop or left
  try {
    const { prompt, images = [], tier } = await readBody(req);
    if (typeof prompt !== "string" || !prompt.trim()) return send(res, 400, { code: "invalid_request" });
    if (!fromApp(prompt)) return send(res, 403, { code: "forbidden" });
    if (prompt.length > LIMITS.jsonPrompt) return send(res, 413, { code: "prompt_too_large" });
    if (!Array.isArray(images)) return send(res, 400, { code: "invalid_request" });
    // Every image must be usable: dropping some silently would misnumber the rest.
    if (images.length > provider().maxImages) return send(res, 413, { code: "prompt_too_large" });
    if (!images.every((u) => typeof u === "string" && IMAGE.test(u))) return send(res, 400, { code: "image_rejected" });
    const content = [
      { type: "text", text: `${prompt}\n\nReply with a single JSON object and nothing else.` },
      ...images.map((url) => ({ type: "image_url", image_url: { url, detail: "high" } })),
    ];
    // Temperature 0 and a fixed seed: the same conversation should get the same verdict.
    const steady = { temperature: 0, ...(provider().id === "groq" ? { seed: 7 } : {}) };
    const r = await complete(
      { model: modelFor(tier), messages: [{ role: "user", content }], response_format: { type: "json_object" }, ...steady, max_tokens: tier === "complex" ? 5000 : 3500 },
      ctl.signal
    );
    const data = await r.json().catch(() => null);
    const choice = data?.choices?.[0];
    let out;
    try {
      out = parseJsonReply(choice?.message?.content);
    } catch {
      return send(res, 502, { code: choice?.finish_reason === "length" ? "prompt_too_large" : "invalid_json" });
    }
    if (!out || typeof out !== "object") return send(res, 502, { code: "invalid_json" });
    return send(res, 200, out);
  } catch (err) {
    if (ctl.signal.aborted) return res.end();
    if (typeof err?.code === "string") return send(res, err.status || 500, { code: err.code });
    console.error("json handler error", err?.name || "error");
    return send(res, 500, { code: "upstream_error" });
  }
}
