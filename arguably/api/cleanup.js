// Daily cron (vercel.json "crons"): deletes expired records from Blob storage.
// Vercel calls it with "Authorization: Bearer <CRON_SECRET>"; nobody else can run it.
import crypto from "node:crypto";
import { send } from "./_ai.js";
import { sweepExpired } from "./_store.js";

const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return send(res, 503, { code: "cron_off" });
  if (!same(String(req.headers.authorization || ""), `Bearer ${secret}`)) return send(res, 401, { code: "unauthorized" });
  try {
    return send(res, 200, await sweepExpired());
  } catch (err) {
    return send(res, err?.status || 500, { code: err?.code || "server_error" });
  }
}
