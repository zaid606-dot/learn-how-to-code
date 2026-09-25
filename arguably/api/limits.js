// GET /api/limits -> what the app should send to this site's AI (sizes, images or text only).
import { appLimits, send } from "./_ai.js";

export default function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { code: "method_not_allowed" });
  res.setHeader("Cache-Control", "no-store");
  return send(res, 200, appLimits());
}
