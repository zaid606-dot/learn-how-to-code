// POST /api/json {prompt, images: [dataUrl], tier} -> the JSON object the model returns.
// Used for reading screenshots and for verdicts.
import { send, readBody, rateLimited, foreignOrigin, complete, modelFor, parseJsonReply, provider } from "./_ai.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { code: "method_not_allowed" });
  if (foreignOrigin(req)) return send(res, 403, { code: "forbidden" });
  if (rateLimited(req)) return send(res, 429, { code: "rate_limited" });
  try {
    const { prompt, images = [], tier } = await readBody(req);
    if (typeof prompt !== "string" || !prompt.trim()) return send(res, 400, { code: "invalid_request" });
    if (prompt.length > 200000) return send(res, 413, { code: "prompt_too_large" });
    const pics = (Array.isArray(images) ? images : []).slice(0, provider().maxImages).filter((u) => typeof u === "string" && /^data:image\/(jpeg|png);base64,/.test(u));
    const content = [
      { type: "text", text: `${prompt}\n\nReply with a single JSON object and nothing else.` },
      ...pics.map((url) => ({ type: "image_url", image_url: { url, detail: "high" } })),
    ];
    const r = await complete({
      model: modelFor(tier),
      messages: [{ role: "user", content }],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 16000,
    });
    const data = await r.json();
    const choice = data.choices?.[0];
    let out;
    try {
      out = parseJsonReply(choice?.message?.content);
    } catch {
      return send(res, 502, { code: choice?.finish_reason === "length" ? "prompt_too_large" : "invalid_json" });
    }
    return send(res, 200, out);
  } catch (err) {
    if (err?.code) return send(res, err.status || 500, { code: err.code });
    console.error(err);
    return send(res, 500, { code: "upstream_error" });
  }
}
