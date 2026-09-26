// POST /api/report {title, reason, details} -> {ok}
// Reports about verdicts ("wrong", "unfair", "harmful", "other"), kept for 180 days for review.
// Only what the person typed is stored: no conversation, no account, no IP address.
import { send, readBody, rateLimited, foreignOrigin } from "./_ai.js";
import { storeConfig, redis } from "./_store.js";
import crypto from "node:crypto";

const REASONS = new Set(["wrong", "unfair", "harmful", "other"]);
const clip = (x, n) => (typeof x === "string" ? x.replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, n) : "");

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return send(res, 405, { code: "method_not_allowed" });
  if (foreignOrigin(req)) return send(res, 403, { code: "forbidden" });
  if (!storeConfig()) return send(res, 503, { code: "reports_off" });
  if (rateLimited(req, "report", 10)) return send(res, 429, { code: "rate_limited" });
  try {
    const body = await readBody(req, 10_000);
    const reason = REASONS.has(body.reason) ? body.reason : "";
    if (!reason) return send(res, 400, { code: "invalid_request" });
    const report = { at: new Date().toISOString(), reason, title: clip(body.title, 200), details: clip(body.details, 2000) };
    const id = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    await redis(["SET", `report:${id}`, JSON.stringify(report), "EX", 180 * 86400]);
    await redis(["SADD", "reports", id]);
    return send(res, 200, { ok: true });
  } catch (err) {
    if (typeof err?.code === "string") return send(res, err.status || 500, { code: err.code });
    return send(res, 500, { code: "server_error" });
  }
}
