// Saved data for a signed-in account.
//   GET                      -> {chats: [...], prefs: {...} | null}
//   PUT {chat}               -> saves one chat (replaces the saved copy with the same id)
//   PUT {prefs}              -> saves settings (name, tone, notifications)
//   DELETE ?id=<chat id>     -> deletes one chat;  DELETE ?all=1 -> deletes every chat
// Deleted chat ids are remembered (GET returns them as `deleted`), so a phone that still has an
// old copy drops it instead of uploading it back.
import { send, readBody, rateLimited, foreignOrigin } from "./_ai.js";
import { storeConfig, redis } from "./_store.js";
import { sessionUser } from "./_auth.js";

const CHAT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_CHAT_BYTES = 300_000;
const MAX_CHATS = 100;
const PREF_KEYS = ["name", "tone", "notify", "readOnPhone"];

function cleanPrefs(p) {
  const out = {};
  if (typeof p?.name === "string") out.name = p.name.slice(0, 40);
  if (["straight", "gentle", "blunt"].includes(p?.tone) || typeof p?.tone === "string") out.tone = String(p.tone).slice(0, 20);
  if (p?.notify && typeof p.notify === "object") out.notify = Object.fromEntries(Object.entries(p.notify).filter(([k, v]) => /^[a-z]{1,12}$/.test(k) && typeof v === "boolean").slice(0, 10));
  if (typeof p?.readOnPhone === "boolean") out.readOnPhone = p.readOnPhone;
  return Object.keys(out).filter((k) => PREF_KEYS.includes(k)).length ? out : null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (foreignOrigin(req)) return send(res, 403, { code: "forbidden" });
  if (!storeConfig()) return send(res, 503, { code: "accounts_off" });
  if (rateLimited(req, `sync-${req.method}`, 400)) return send(res, 429, { code: "rate_limited" });
  try {
    const user = await sessionUser(req);
    if (!user) return send(res, 401, { code: "signed_out" });
    const key = `chats:${user.id}`;
    const gone = `deleted:${user.id}`;

    if (req.method === "GET") {
      const flat = (await redis(["HGETALL", key])) || [];
      const chats = [];
      for (let i = 1; i < flat.length; i += 2) {
        try {
          chats.push(JSON.parse(flat[i]));
        } catch {}
      }
      const prefs = await redis(["GET", `prefs:${user.id}`]);
      const deleted = (await redis(["SMEMBERS", gone])) || [];
      return send(res, 200, { chats, deleted, prefs: typeof prefs === "string" ? JSON.parse(prefs) : null });
    }

    if (req.method === "PUT") {
      const body = await readBody(req, MAX_CHAT_BYTES + 10_000);
      if (body.prefs !== undefined) {
        const prefs = cleanPrefs(body.prefs);
        if (!prefs) return send(res, 400, { code: "invalid_request" });
        await redis(["SET", `prefs:${user.id}`, JSON.stringify(prefs)]);
        return send(res, 200, { ok: true });
      }
      const chat = body.chat;
      if (!chat || typeof chat !== "object" || Array.isArray(chat) || !CHAT_ID.test(String(chat.id)) || !Array.isArray(chat.messages)) {
        return send(res, 400, { code: "invalid_request" });
      }
      const json = JSON.stringify(chat);
      if (Buffer.byteLength(json) > MAX_CHAT_BYTES) return send(res, 413, { code: "chat_too_big" });
      if (await redis(["SISMEMBER", gone, chat.id])) return send(res, 410, { code: "chat_deleted" });
      const exists = await redis(["HEXISTS", key, chat.id]);
      if (!exists && Number(await redis(["HLEN", key])) >= MAX_CHATS) return send(res, 409, { code: "too_many_chats" });
      await redis(["HSET", key, chat.id, json]);
      return send(res, 200, { ok: true });
    }

    if (req.method === "DELETE") {
      const q = new URL(req.url, "http://x").searchParams;
      if (q.get("all") === "1") {
        const flat = (await redis(["HGETALL", key])) || [];
        const ids = flat.filter((_, i) => i % 2 === 0);
        if (ids.length) await redis(["SADD", gone, ...ids]);
        await redis(["DEL", key]);
        await redis(["DEL", `prefs:${user.id}`]); // "Delete all data" includes settings
      } else if (CHAT_ID.test(q.get("id") || "")) {
        // Remember it as deleted only if it was really there (no junk piling up).
        if (await redis(["HDEL", key, q.get("id")])) await redis(["SADD", gone, q.get("id")]);
      } else return send(res, 400, { code: "invalid_request" });
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { code: "method_not_allowed" });
  } catch (err) {
    if (typeof err?.code === "string") return send(res, err.status || 500, { code: err.code });
    console.error("sync error", err?.name || "error");
    return send(res, 500, { code: "server_error" });
  }
}
