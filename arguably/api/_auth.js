// Accounts: email + password, sessions in an HttpOnly cookie. Passwords are never stored,
// only a salted scrypt hash; session tokens are stored only as SHA-256 hashes, so a leaked
// database can't be used to sign in.
import crypto from "node:crypto";
import { redis } from "./_store.js";

export const SESSION_COOKIE = "arguably_session";
export const SESSION_DAYS = 60;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
export const newId = () => crypto.randomBytes(16).toString("hex");
export const newToken = () => crypto.randomBytes(32).toString("base64url");

export function normalEmail(email) {
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : "";
}
export const passwordProblem = (pw) =>
  typeof pw !== "string" || pw.length < 8 ? "password_short" : pw.length > 200 ? "password_long" : "";

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw.normalize("NFKC"), salt, 64, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}
export function checkPassword(pw, stored) {
  const [kind, salt, hash] = String(stored || "").split("$");
  if (kind !== "scrypt" || !salt || !hash || typeof pw !== "string") return false;
  const want = Buffer.from(hash, "base64");
  const got = crypto.scryptSync(pw.normalize("NFKC"), Buffer.from(salt, "base64"), want.length, SCRYPT);
  return crypto.timingSafeEqual(got, want);
}
// Spend the same time on an unknown email as on a wrong password, so timing doesn't reveal accounts.
const DUMMY = hashPassword(crypto.randomBytes(12).toString("hex"));
export const burnTime = (pw) => void checkPassword(String(pw || "x"), DUMMY);

export function readCookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return ""; // a mangled cookie is just no cookie
      }
    }
  }
  return "";
}
const secure = (req) => req.headers["x-forwarded-proto"] === "https" || !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(String(req.headers.host || ""));
export function setSessionCookie(req, res, token) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure(req) ? "; Secure" : ""}`);
}
export function clearSessionCookie(req, res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(req) ? "; Secure" : ""}`);
}

export async function startSession(req, res, userId) {
  const token = newToken();
  const key = sha256(token);
  await redis(["SET", `session:${key}`, userId, "EX", SESSION_DAYS * 86400]);
  await redis(["SADD", `sessions:${userId}`, key]);
  setSessionCookie(req, res, token);
}
// The signed-in user for this request, or null.
export async function sessionUser(req) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const userId = await redis(["GET", `session:${sha256(token)}`]);
  if (typeof userId !== "string") return null;
  const raw = await redis(["GET", `user:${userId}`]);
  if (typeof raw !== "string") return null;
  try {
    return { ...JSON.parse(raw), sessionKey: sha256(token) };
  } catch {
    return null;
  }
}
// Sign out everywhere (after a password reset or account deletion).
export async function endAllSessions(userId) {
  const keys = (await redis(["SMEMBERS", `sessions:${userId}`])) || [];
  for (const k of keys) await redis(["DEL", `session:${k}`]);
  await redis(["DEL", `sessions:${userId}`]);
}
// Recovery codes: the no-email way back into an account. Shown once, stored only as a hash.
const RC_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
export function newRecoveryCode() {
  const bytes = crypto.randomBytes(20);
  const chars = [...bytes].map((b) => RC_ALPHABET[b % RC_ALPHABET.length]).join("");
  return chars.match(/.{5}/g).join("-");
}
export const normalCode = (code) => String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40);
export const hashCode = (code) => hashPassword(normalCode(code));
export const checkCode = (code, stored) => {
  const ok = checkPassword(normalCode(code), stored); // hash first, length second: same time either way
  return ok && normalCode(code).length === 20;
};

export const publicUser = (u) => ({ email: u.email, name: u.name || "", createdAt: u.createdAt });
