// Accounts. All on one function, chosen by ?op=:
//   GET  ?op=me                         -> {accounts: true|false, user: {email, name} | null}
//   POST ?op=signup {email, password, name?}
//   POST ?op=login  {email, password}
//   POST ?op=logout
//   POST ?op=reset-request {email}      -> always {ok} (never says whether an account exists)
//   POST ?op=reset  {token, password}
//   POST ?op=delete {password}          -> erases the account, its chats and every session
import { send, readBody, rateLimited, foreignOrigin } from "./_ai.js";
import { storeConfig, redis } from "./_store.js";
import {
  normalEmail, passwordProblem, hashPassword, checkPassword, burnTime, newId, newToken, sha256,
  startSession, sessionUser, endAllSessions, clearSessionCookie, publicUser,
} from "./_auth.js";

const MAX_FAILS = 10; // wrong passwords per email per 15 minutes
const cleanName = (n) => (typeof n === "string" ? n.trim().replace(/[\u0000-\u001f<>]/g, "").slice(0, 40) : "");

async function sendResetEmail(req, email, token) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const link = `https://${host}/#reset=${token}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || "Arguably <onboarding@resend.dev>",
      to: [email],
      subject: "Reset your Arguably password",
      text: `Tap to choose a new password (the link works for 1 hour):\n\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
    }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  return !!res?.ok;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const op = new URL(req.url, "http://x").searchParams.get("op") || "";
  if (foreignOrigin(req)) return send(res, 403, { code: "forbidden" });
  if (!storeConfig()) return op === "me" && req.method === "GET" ? send(res, 200, { accounts: false, user: null }) : send(res, 503, { code: "accounts_off" });
  try {
    if (op === "me") {
      if (req.method !== "GET") return send(res, 405, { code: "method_not_allowed" });
      const user = await sessionUser(req);
      return send(res, 200, { accounts: true, user: user ? publicUser(user) : null, resetByEmail: !!process.env.RESEND_API_KEY });
    }
    if (req.method !== "POST") return send(res, 405, { code: "method_not_allowed" });
    if (rateLimited(req, `auth-${op}`, op === "login" ? 30 : 15)) return send(res, 429, { code: "rate_limited" });
    const body = await readBody(req, 10_000);

    if (op === "signup") {
      const email = normalEmail(body.email);
      if (!email) return send(res, 400, { code: "email_invalid" });
      const problem = passwordProblem(body.password);
      if (problem) return send(res, 400, { code: problem });
      const id = newId();
      // Claim the email first (SET NX), so two sign-ups for one email can't both win.
      if ((await redis(["SET", `user:email:${email}`, id, "NX"])) !== "OK") return send(res, 409, { code: "email_taken" });
      const user = { id, email, name: cleanName(body.name), pw: hashPassword(body.password), createdAt: Date.now() };
      await redis(["SET", `user:${id}`, JSON.stringify(user)]);
      await startSession(req, res, id);
      return send(res, 200, { user: publicUser(user) });
    }

    if (op === "login") {
      const email = normalEmail(body.email);
      const fails = email ? Number(await redis(["GET", `fail:${email}`])) || 0 : 0;
      if (fails >= MAX_FAILS) return send(res, 429, { code: "too_many_attempts" });
      const id = email ? await redis(["GET", `user:email:${email}`]) : null;
      const raw = typeof id === "string" ? await redis(["GET", `user:${id}`]) : null;
      const user = typeof raw === "string" ? JSON.parse(raw) : null;
      if (!user) burnTime(body.password);
      if (!user || !checkPassword(body.password, user.pw)) {
        if (email) {
          await redis(["INCR", `fail:${email}`]);
          await redis(["EXPIRE", `fail:${email}`, 900]);
        }
        return send(res, 401, { code: "wrong_login" }); // same answer for unknown email and wrong password
      }
      await redis(["DEL", `fail:${email}`]);
      await startSession(req, res, user.id);
      return send(res, 200, { user: publicUser(user) });
    }

    if (op === "logout") {
      const user = await sessionUser(req);
      if (user) {
        await redis(["DEL", `session:${user.sessionKey}`]);
        await redis(["SREM", `sessions:${user.id}`, user.sessionKey]);
      }
      clearSessionCookie(req, res);
      return send(res, 200, { ok: true });
    }

    if (op === "reset-request") {
      const email = normalEmail(body.email);
      if (!process.env.RESEND_API_KEY) return send(res, 503, { code: "reset_unavailable" });
      const id = email ? await redis(["GET", `user:email:${email}`]) : null;
      if (typeof id === "string") {
        const token = newToken();
        await redis(["SET", `reset:${sha256(token)}`, id, "EX", 3600]);
        await sendResetEmail(req, email, token);
      }
      return send(res, 200, { ok: true });
    }

    if (op === "reset") {
      const token = typeof body.token === "string" ? body.token : "";
      const problem = passwordProblem(body.password);
      if (problem) return send(res, 400, { code: problem });
      const key = `reset:${sha256(token)}`;
      const id = token ? await redis(["GET", key]) : null;
      const raw = typeof id === "string" ? await redis(["GET", `user:${id}`]) : null;
      if (typeof raw !== "string") return send(res, 400, { code: "reset_expired" });
      await redis(["DEL", key]); // one use only
      const user = { ...JSON.parse(raw), pw: hashPassword(body.password) };
      await redis(["SET", `user:${id}`, JSON.stringify(user)]);
      await redis(["DEL", `fail:${user.email}`]);
      await endAllSessions(id);
      await startSession(req, res, id);
      return send(res, 200, { user: publicUser(user) });
    }

    if (op === "delete") {
      const user = await sessionUser(req);
      if (!user) return send(res, 401, { code: "signed_out" });
      if (!checkPassword(body.password, user.pw)) return send(res, 401, { code: "wrong_password" });
      await endAllSessions(user.id);
      await redis(["DEL", `chats:${user.id}`]);
      await redis(["DEL", `prefs:${user.id}`]);
      await redis(["DEL", `user:${user.id}`]);
      await redis(["DEL", `user:email:${user.email}`]);
      clearSessionCookie(req, res);
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { code: "not_found" });
  } catch (err) {
    if (typeof err?.code === "string") return send(res, err.status || 500, { code: err.code });
    console.error("auth error", err?.name || "error");
    return send(res, 500, { code: "server_error" });
  }
}
