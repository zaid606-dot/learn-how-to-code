// Accounts. All on one function, chosen by ?op=:
//   GET  ?op=me                         -> {accounts: true|false, user: {email, name} | null}
//   POST ?op=signup {email, password, name?}
//   POST ?op=login  {email, password}
//   POST ?op=logout
//   POST ?op=reset-request {email}      -> always {ok} (never says whether an account exists)
//   POST ?op=reset  {token, password}
//   POST ?op=delete {password}          -> erases the account, its chats and every session
import { send, readBody, rateLimited, foreignOrigin, clientIp } from "./_ai.js";
import { storeConfig, redis } from "./_store.js";
import {
  normalEmail, passwordProblem, hashPassword, checkPassword, burnTime, newId, newToken, sha256,
  startSession, sessionUser, endAllSessions, clearSessionCookie, publicUser, newRecoveryCode, hashCode, checkCode,
} from "./_auth.js";

const MAX_FAILS = 10; // wrong passwords per email, per network, per 15 minutes
const MAX_FAILS_ANYWHERE = 100; // per email from everywhere: a stranger can't lock you out cheaply
const OPS = new Set(["me", "signup", "login", "logout", "reset-request", "reset", "recover", "recovery-code", "delete"]);
const cleanName = (n) => (typeof n === "string" ? n.trim().replace(/[\u0000-\u001f<>]/g, "").slice(0, 40) : "");

async function sendResetEmail(req, email, token) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  // A fixed address, never one taken from request headers (which a proxy might pass through).
  const host = (process.env.APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || req.headers.host || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
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

// Wrong-password counters: per email + network, and per email overall. Created with their expiry
// in one command, so a counter can never be left without one.
const failKeys = (req, email) => [`fail:${email}:${clientIp(req)}`, `fail:${email}`];
async function failCount(req, email) {
  const [here, all] = failKeys(req, email);
  return { here: Number(await redis(["GET", here])) || 0, all: Number(await redis(["GET", all])) || 0 };
}
async function addFail(req, email) {
  for (const k of failKeys(req, email)) {
    await redis(["SET", k, "0", "NX", "EX", 900]);
    await redis(["INCR", k]);
  }
}
const locked = (f) => f.here >= MAX_FAILS || f.all >= MAX_FAILS_ANYWHERE;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const op = new URL(req.url, "http://x").searchParams.get("op") || "";
  if (!OPS.has(op)) return send(res, 404, { code: "not_found" });
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
      const recoveryCode = newRecoveryCode();
      const user = { id, email, name: cleanName(body.name), pw: hashPassword(body.password), rc: hashCode(recoveryCode), createdAt: Date.now() };
      // Write the account, then claim the email (SET NX) so two sign-ups for one email can't both win.
      await redis(["SET", `user:${id}`, JSON.stringify(user)]);
      if ((await redis(["SET", `user:email:${email}`, id, "NX"])) !== "OK") {
        await redis(["DEL", `user:${id}`]);
        return send(res, 409, { code: "email_taken" });
      }
      await startSession(req, res, id);
      return send(res, 200, { user: publicUser(user), recoveryCode });
    }

    // Forgot password, no email needed: email + recovery code + new password. The code is
    // replaced with a new one, and every other phone is signed out.
    if (op === "recover") {
      const email = normalEmail(body.email);
      const problem = passwordProblem(body.password);
      if (problem) return send(res, 400, { code: problem });
      if (email && locked(await failCount(req, email))) return send(res, 429, { code: "too_many_attempts" });
      const id = email ? await redis(["GET", `user:email:${email}`]) : null;
      const raw = typeof id === "string" ? await redis(["GET", `user:${id}`]) : null;
      const user = typeof raw === "string" ? JSON.parse(raw) : null;
      // Always one full hash check, so how long this takes never reveals whether the email has an account.
      const codeOk = user?.rc ? checkCode(body.code, user.rc) : (burnTime(body.code), false);
      if (!user || !codeOk) {
        if (email) await addFail(req, email);
        return send(res, 401, { code: "wrong_code" });
      }
      const recoveryCode = newRecoveryCode();
      const updated = { ...user, pw: hashPassword(body.password), rc: hashCode(recoveryCode) };
      await redis(["SET", `user:${user.id}`, JSON.stringify(updated)]);
      for (const k of failKeys(req, email)) await redis(["DEL", k]);
      await endAllSessions(user.id);
      await startSession(req, res, user.id);
      return send(res, 200, { user: publicUser(updated), recoveryCode });
    }

    // A fresh recovery code (signed in, with the password): the old one stops working.
    if (op === "recovery-code") {
      const user = await sessionUser(req);
      if (!user) return send(res, 401, { code: "signed_out" });
      if (locked(await failCount(req, user.email))) return send(res, 429, { code: "too_many_attempts" });
      if (!checkPassword(body.password, user.pw)) {
        await addFail(req, user.email);
        return send(res, 401, { code: "wrong_password" });
      }
      const recoveryCode = newRecoveryCode();
      const { sessionKey, ...stored } = user;
      await redis(["SET", `user:${user.id}`, JSON.stringify({ ...stored, rc: hashCode(recoveryCode) })]);
      return send(res, 200, { recoveryCode });
    }

    if (op === "login") {
      const email = normalEmail(body.email);
      if (email && locked(await failCount(req, email))) return send(res, 429, { code: "too_many_attempts" });
      const id = email ? await redis(["GET", `user:email:${email}`]) : null;
      const raw = typeof id === "string" ? await redis(["GET", `user:${id}`]) : null;
      const user = typeof raw === "string" ? JSON.parse(raw) : null;
      if (!user) burnTime(body.password);
      if (!user || !checkPassword(body.password, user.pw)) {
        if (email) await addFail(req, email);
        return send(res, 401, { code: "wrong_login" }); // same answer for unknown email and wrong password
      }
      await redis(["DEL", failKeys(req, email)[0]]);
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
        // One live link per account: a new request cancels the previous link.
        const old = await redis(["GET", `reset:user:${id}`]);
        if (typeof old === "string") await redis(["DEL", `reset:${old}`]);
        await redis(["SET", `reset:${sha256(token)}`, id, "EX", 3600]);
        await redis(["SET", `reset:user:${id}`, sha256(token), "EX", 3600]);
        await sendResetEmail(req, email, token);
      }
      return send(res, 200, { ok: true });
    }

    if (op === "reset") {
      const token = typeof body.token === "string" ? body.token : "";
      const problem = passwordProblem(body.password);
      if (problem) return send(res, 400, { code: problem });
      // GETDEL: read and spend the link in one step, so it works exactly once.
      const id = token && token.length < 100 ? await redis(["GETDEL", `reset:${sha256(token)}`]) : null;
      const raw = typeof id === "string" ? await redis(["GET", `user:${id}`]) : null;
      if (typeof raw !== "string") return send(res, 400, { code: "reset_expired" });
      await redis(["DEL", `reset:user:${id}`]);
      const user = { ...JSON.parse(raw), pw: hashPassword(body.password) };
      await redis(["SET", `user:${id}`, JSON.stringify(user)]);
      await redis(["DEL", `fail:${user.email}`]);
      await redis(["DEL", failKeys(req, user.email)[0]]);
      await endAllSessions(id);
      await startSession(req, res, id);
      return send(res, 200, { user: publicUser(user) });
    }

    if (op === "delete") {
      const user = await sessionUser(req);
      if (!user) return send(res, 401, { code: "signed_out" });
      if (locked(await failCount(req, user.email))) return send(res, 429, { code: "too_many_attempts" });
      if (!checkPassword(body.password, user.pw)) {
        await addFail(req, user.email); // the same limit as signing in
        return send(res, 401, { code: "wrong_password" });
      }
      await endAllSessions(user.id);
      await redis(["DEL", `chats:${user.id}`]);
      await redis(["DEL", `deleted:${user.id}`]);
      await redis(["DEL", `prefs:${user.id}`]);
      await redis(["DEL", `user:${user.id}`]);
      await redis(["DEL", `user:email:${user.email}`]);
      const reset = await redis(["GET", `reset:user:${user.id}`]);
      if (typeof reset === "string") await redis(["DEL", `reset:${reset}`]);
      await redis(["DEL", `reset:user:${user.id}`]);
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
