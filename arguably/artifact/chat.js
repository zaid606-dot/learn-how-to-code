/* Arguably chat, for the claude.ai Artifact build.
 * Claude is reached through the Artifact `sample` capability (the viewer's own account).
 * The build injects VERDICT_SCHEMA, SAMPLE_VERDICT and SYSTEM_PROMPT, and inlines
 * pipeline.cjs (normText, joinSlices, phoneGroups, defaultMapping, buildTranscript,
 * transcriptText, unverifiedQuotes, ...) ahead of this file.
 *
 * Screenshot flow:
 *   import -> dedupe + smart slicing (on device) -> Claude reads every message in batches
 *   -> "Who's who" check -> merge both phones into one transcript -> Claude judges the
 *   transcript -> quotes checked against the transcript -> follow-ups see the transcript. */
/*__CONSTANTS__*/

const MAX_IMAGES = 30;
// Shown in Settings > Support. Replace with the real support inbox before App Store submission.
const SUPPORT_EMAIL = "support@arguably.app";
// Set to the numeric App Store ID once the listing exists; the rating notification links to it.
const APP_STORE_ID = "";
const APP_VERSION = "1.0";
// Bump when the Privacy Policy or Terms change: everyone is asked to agree again.
const POLICY_VERSION = "2026-09-25";
const POLICY_DATE = "September 25, 2026";
// App Store build only (node scripts/build-artifact.mjs --store). On claude.ai, verdicts run on
// the viewer's own Claude plan, so there is nothing to gate.
// Hard paywall, Cal AI style: Pro (with a free trial) right after onboarding, no free verdicts.
const FREE_VERDICTS = 0;
const PRO_FAIR_USE = 50; // verdicts per calendar month
const PLANS = {
  yearly: { id: "arguably.pro.yearly", price: "$29.99", per: "year", trialDays: 3 },
  monthly: { id: "arguably.pro.monthly", price: "$9.99", per: "month" },
};
const MAX_EDGE = 1400; // max width; tall scrolling captures keep full height
const STORE_KEY = "arguably.chats.v2";
const MAX_CHATS = 20;
const PALETTE = [
  { bg: "#FF5A47", fg: "#24100E" }, // logo coral
  { bg: "#252668", fg: "#FFFFFF" }, // logo navy
  { bg: "#9E321F", fg: "#FFFFFF" },
  { bg: "#266B8C", fg: "#FFFFFF" },
  { bg: "#665B57", fg: "#FFFFFF" },
  { bg: "#A86112", fg: "#FFFFFF" },
];
const NEUTRAL = { bg: "#D8CBC3", fg: "#1F1B1A" };
const VERDICT_STEPS = [
  "Finding where it started",
  "Comparing each side",
  "Checking for grudges and personal shots",
  "Checking for logical fallacies",
  "Putting the verdict together",
];
const SUGGESTIONS = [
  "Who should apologize first?",
  "Write a reply that calms this down",
  "Explain the fallacies simply",
  "What am I missing about the other side?",
];
const CHAT_RULES = `You are Arguably, a fair referee for text-message arguments, talking with the person who uploaded the conversation.
Below are the full transcript of the conversation (read from their screenshots, with speakers they confirmed) and the verdict(s) you gave as JSON. Answer their follow-up questions about this argument: explain your reasoning, quote the actual messages from the transcript word for word in quotation marks (never show message IDs like [m12] to them), help them see the other side, suggest what to say next, and reconsider fairly if they add context (say plainly when new context changes your view and when it doesn't).
Voice: clear, warm and grounded, like a thoughtful guide. Short paragraphs, concrete words, no exclamation marks. Judge the arguing, never the people, and never mock or shame anyone.
When asked to write a message, give the message itself, ready to send, then at most one line on why it works.
Format: plain text. You may use "- " bullet lines and **bold** sparingly. No headings, no tables.
If there is no verdict yet, tell them to import screenshots or paste the conversation as text.`;

const TRANSCRIBE_RULES = `Transcribe these screenshots of a text-message conversation so it can be judged later. Do not judge or summarize anything.

For each image, report the chat app (iMessage, WhatsApp, Instagram, Messenger, Discord, Slack, SMS, other) and the name or title shown in the chat header at the top. Use "" when no header is visible in that image (lower slices of a tall screenshot usually have none).

Then list every message bubble in reading order, top to bottom, image by image. For each message give:
- image: the image number
- side: "right" for bubbles sent by the phone's owner (usually right-aligned and colored), "left" for received bubbles, "center" for system notices
- sender_label: in a group chat, who sent a left bubble. Apps show the name only on the first bubble of a run, so repeat it on every bubble in that run. Else ""
- text: exactly as written, including emoji and typos. Describe photos, stickers, GIFs and voice notes in square brackets, e.g. "[photo: a sink full of dishes]", "[voice message 0:12]". Deleted messages: "[deleted message]"
- time: the time or date shown for it, if any (put a timestamp row like "Today 9:14 PM" on the next message instead of listing it separately)
- kind: "text", "photo", "voice", "sticker", "link", "deleted", "reaction" or "system"
- partial: true if the bubble is cut off at the top or bottom edge of the image
- y: the bubble's vertical center as a percentage of the image height (0 = top, 100 = bottom)

Reply with only one JSON object, for example:
{"images":[{"image":1,"app":"iMessage","header_name":"Jordan"}],"messages":[{"image":1,"side":"right","sender_label":"","text":"You said you'd do the dishes?","time":"Today 9:14 PM","kind":"text","partial":false,"y":22}]}`;

// Used when this view can't send images to Claude: the phone reads and sorts the text itself
// (linesToMessages), and only screenshots that read poorly go to Claude as text lines.
const OCR_RULES = `These are text lines read on the user's phone (by OCR) from screenshots of a text-message conversation. The reading was poor, so some text is garbled. Rebuild each screenshot's messages. Do not judge or summarize anything.

Each line is: y (top of the line, % of screenshot height), L and R (left and right edge, % of screenshot width), an optional "low" confidence flag, then the text.
How to read them:
- The first line or two (time, carrier, battery) is the phone's status bar. Ignore it.
- The chat header is the name near the top (often centered, often ending in ">" or "›").
- Sent bubbles (the phone owner's) are right-aligned: R is high and L is well away from the left edge. Received bubbles are left-aligned: L is low. A wrapped line keeps its bubble's L even when it is short.
- In group chats a short name line sits just above a received bubble: it is that bubble's sender label, not a message.
- Centered short lines between bubbles are timestamps ("Today 9:58 AM"): put them on the next message. Other centered notices are C messages.
- Lines close together vertically with the same L belong to one bubble: join them with a space.
- Fix obvious OCR slips (a lone "|" is "I"; "0k" is "Ok") but never change the wording. Drop icon, avatar and photo noise. If garbled text sits where a photo, link card or voice note would be, write "[photo]", "[link]" or "[voice message]".
- "Delivered", "Read", "Edited", "Replies", reaction counts and similar labels are not messages.

Reply in plain text, no JSON, no commentary. For every screenshot, first one header line, then one line per message, top to bottom:
<screenshot>|H|<header name, or nothing if none is visible>
<screenshot>|<R, L or C>|<sender label or nothing>|<time or nothing>|<message text>
Example:
3|H|Jordan
3|R||Today 9:14 PM|You said you'd do the dishes?
3|L|||I was going to do them today
If a screenshot has no readable messages, give only its H line.`;

const SAMPLE_TRANSCRIPT = [
  ["Maya", "Today 11:48 PM", "So you were 'asleep' but liking Brianna's pics at 2am? 👀"],
  ["Jordan", "", "It's literally just a like, why is this a whole thing"],
  ["Maya", "", "Honestly you're such a liar"],
  ["Jordan", "", "You literally left me on read for 6 hours yesterday"],
  ["Maya", "11:52 PM", "This is literally the same thing that happened in March"],
  ["Jordan", "", "Wow ok sorry I'm not perfect like you 🙄"],
  ["Maya", "", "I just want a straight answer"],
].map(([sender, time, text], i) => ({ id: "m" + (i + 1), sender, time, text, kind: "text", shots: [i < 4 ? 1 : 2] }));

const SAMPLE_ERRORS = {
  not_granted: `Arguably needs permission to use ${AI_NAME}. Reload the page and choose Allow when asked.`,
  sampling_disabled: `${AI_NAME} isn't available right now, so Arguably can't reply here.`,
  session_expired: `Your ${AI_NAME} session expired. Sign in again, then try again.`,
  rate_limited: HOSTED ? "The AI is at its limit for this minute. Wait a minute, then try again; your screenshots are kept." : `You've hit your ${AI_NAME} usage limit for now. Try again later.`,
  timeout: "That took too long to finish. Try again; your screenshots are kept.",
  image_rejected: "One of the screenshots couldn't be used. Remove it or try a different image.",
  images_unavailable: `This view can't send screenshots to ${AI_NAME}. Paste the conversation as text instead.`,
  ocr_unavailable: HOSTED ? "This phone couldn't read the screenshots. Turn off “Read screenshots on this phone” in Settings, or paste the conversation as text." : "This phone couldn't read the screenshots. Try Arguably on claude.ai in a browser, or paste the conversation as text.",
  refused: `${AI_NAME} couldn't review this. Try a different set of screenshots.`,
  prompt_too_large: "That's too much to review at once. Try fewer screenshots or a shorter paste.",
  invalid_json: "The reply came back incomplete. Try again.",
  no_messages: "We couldn't find any messages in those screenshots. Check they show the conversation and try again.",
};
const errorCopy = (code) => SAMPLE_ERRORS[code] || "We couldn't finish that. Try again.";

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
function storage(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}
function relTime(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return "Yesterday";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Minimal, safe formatting for Claude's replies: paragraphs, "- " bullets, **bold**.
function formatReply(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  return String(text)
    .replace(/\s*[\[(]\s*m\d+(?:\s*(?:[,–-]|and|&|to)\s*m?\d+)*\s*[\])]/gi, "")
    .replace(/\s*\[m?\d*$/i, "") // a reference still streaming in
    .trim()
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-•*]\s+/, ""))}</li>`).join("")}</ul>`;
      }
      return `<p>${lines.map(inline).join("<br>")}</p>`;
    })
    .join("");
}

// ---------- state ----------
// Chats saved by the previous version (v1) are carried over.
let chats = storage(() => JSON.parse(localStorage.getItem(STORE_KEY)) || JSON.parse(localStorage.getItem("arguably.chats.v1")) || [], []);
if (!Array.isArray(chats)) chats = [];
chats = chats.filter((c) => c && typeof c === "object" && Array.isArray(c.messages));
// Saved verdicts from older versions (or damaged storage) are cleaned the same way as new ones.
for (const c of chats) {
  c.messages = c.messages.filter((m) => m && typeof m === "object" && (m.kind !== "verdict" || (m.verdict = normalizeVerdict(m.verdict))));
  for (const k of ["transcript", "readings", "groups"]) if (!Array.isArray(c[k])) c[k] = [];
  if (typeof c.raw !== "string") c.raw = "";
}
let chat = null; // null = home screen
let page = null; // null, "onboarding", "settings" or "inbox": a full page shown instead of home/chat
let pending = []; // screenshots attached to the next message: {id, url, key}
let busy = null; // {ctl, chatId}: one reading/verdict/reply job at a time; it keeps running if you leave the chat
const live = new Map(); // chat id -> chat object with a job in progress, so reopening it shows the progress
let sampler = null;
let maxPromptBytes = 65536; // updated from the host's limits
let claudeChecked = false; // until the connection check finishes, don't claim you're signed out
let maxImages = 0;

// Preferences and the notification inbox live on this device only.
const PREFS_KEY = "arguably.prefs.v1";
const INBOX_KEY = "arguably.inbox.v1";
const DEFAULT_PREFS = { onboarded: false, policy: null, photos: false, aiConsent: false, freeUsed: 0, pro: null, proUsage: { month: "", n: 0 }, name: "", tone: "straight", readOnPhone: false, notify: { verdict: true, who: true, tips: true } };
const savedPrefs = storage(() => JSON.parse(localStorage.getItem(PREFS_KEY)) || {}, {});
let prefs = { ...DEFAULT_PREFS, ...savedPrefs, notify: { ...DEFAULT_PREFS.notify, ...(savedPrefs.notify || {}) } };
if (!prefs.proUsage || typeof prefs.proUsage !== "object") prefs.proUsage = { month: "", n: 0 };
if (!Number.isFinite(prefs.freeUsed)) prefs.freeUsed = 0;
let inbox = storage(() => JSON.parse(localStorage.getItem(INBOX_KEY)) || [], []);
if (!Array.isArray(inbox)) inbox = [];
let onboardStep = 0;
let onboardDir = 1; // 1 = moving forward, -1 = back; sets which way the next step slides in
let docReturn = null; // {page, chat}: where a policy or help page goes back to
let confirmingDelete = false;
const policyOk = () => prefs.policy?.version === POLICY_VERSION;
if (!prefs.onboarded && !chats.length) page = "onboarding";
// Anyone who hasn't agreed to the current Privacy Policy and Terms sees that step first.
// People who finished the intro before only see the agreement step (gate mode).
let gateMode = false;
if (page !== "onboarding" && !policyOk()) {
  page = "onboarding";
  gateMode = true;
}

function savePrefs() {
  storage(() => localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)));
}
function saveInbox() {
  storage(() => localStorage.setItem(INBOX_KEY, JSON.stringify(inbox.slice(0, 50))));
}
const unreadCount = () => inbox.filter((n) => !n.read).length;

// Add a notification. It's marked read straight away if you're already looking at that chat.
// Chats deleted while their work was still running. Nothing may save or notify for them again.
const deletedIds = new Set();
function forget(c) {
  if (!c) return;
  c.deleted = true;
  deletedIds.add(c.id);
  live.delete(c.id);
  if (busy?.chatId === c.id) busy.ctl.abort();
}

function notify(kind, title, body, chatId) {
  if (chatId && deletedIds.has(chatId)) return;
  if (kind !== "rate" && !prefs.notify[kind]) return;
  const seen = !page && chatId && chat?.id === chatId && document.visibilityState === "visible";
  inbox.unshift({ id: uid(), kind, title, body, chatId: chatId || "", at: Date.now(), read: !!seen });
  inbox = inbox.slice(0, 50);
  saveInbox();
  renderHeader();
  if (page === "inbox") render(); // show it right away if you're looking at Notifications
  if (!seen) toast(title);
}

function newChatObject(saved = {}) {
  return { id: uid(), title: "New argument", createdAt: Date.now(), updatedAt: Date.now(), messages: [], readings: [], groups: [], you: "", transcript: [], raw: "", shotTotal: 0, ...saved };
}

function saveChats(c = chat) {
  if (!c || c.example || c.deleted || deletedIds.has(c.id) || !c.messages.length) return;
  c.updatedAt = Date.now();
  // Screenshots stay in memory only; saved chats keep text, transcript and verdicts.
  const clean = { ...c, messages: c.messages.filter((m) => !m.transient).map((m) => (m.shots ? { ...m, shots: undefined } : m)) };
  // Screenshot readings are only needed until who's who is confirmed.
  const waiting = new Set(c.messages.filter((m) => m.kind === "who" && m.status === "pending").flatMap((m) => m.readingNs || []));
  clean.readings = (c.readings || []).filter((r) => waiting.has(r.n));
  const all = [clean, ...chats.filter((x) => x.id !== c.id)];
  chats = all.slice(0, MAX_CHATS);
  let dropped = all.slice(MAX_CHATS);
  let saved = storage(() => (localStorage.setItem(STORE_KEY, JSON.stringify(chats)), true), false);
  // Out of room: drop the oldest chats until it fits.
  while (!saved && chats.length > 1) {
    dropped = [chats.at(-1), ...dropped];
    chats = chats.slice(0, -1);
    saved = storage(() => (localStorage.setItem(STORE_KEY, JSON.stringify(chats)), true), false);
  }
  if (dropped.length) {
    const ids = new Set(dropped.map((x) => x.id));
    inbox = inbox.filter((n) => !ids.has(n.chatId));
    saveInbox();
    toast(dropped.length === 1 ? `To make room, your oldest chat (“${dropped[0].title}”) was removed.` : `To make room, your ${dropped.length} oldest chats were removed.`);
  }
  if (!saved) toast("This chat is too big to save on this device. It stays open until you leave.");
}

// Leaving a chat doesn't stop its work: the result is saved and shows up in Notifications.
function goHome() {
  if (page === "onboarding" && (!policyOk() || gateMode)) return nudgeAgree();
  paywallFor = null;
  chat = null;
  page = null;
  pending = [];
  $("messageInput").value = "";
  render();
}

let consentReturn = null; // {chat, text} or {chat, verdictNote}: what to do after AI consent
function openPage(name) {
  if (DOC_PAGES.includes(name) && !DOC_PAGES.includes(page) && page !== "settings") docReturn = { page, chat };
  page = name;
  confirmingDelete = false;
  if (name === "onboarding") {
    gateMode = false;
    onboardStep = 0;
    onboardDir = 1;
  }
  render();
}

function openChat(id) {
  const saved = live.get(id) || chats.find((c) => c.id === id);
  if (!saved) return toast("That chat isn't on this device anymore.");
  page = null;
  chat = live.get(id) || newChatObject(saved);
  inbox.forEach((n) => { if (n.chatId === id) n.read = true; });
  saveInbox();
  render();
}

const busyHere = () => !!busy && busy.chatId === chat?.id;

function ensureChat() {
  if (!chat || chat.example) chat = newChatObject();
  return chat;
}

const verdictsOf = (c) => (c?.messages || []).filter((m) => m.kind === "verdict").map((m) => m.verdict);
const pendingWho = (c = chat) => c?.messages.find((m) => m.kind === "who" && m.status === "pending");

// ---------- rendering: verdict ----------
function colorMap(v) {
  const names = [];
  const add = (n) => {
    const key = String(n || "").trim().toLowerCase();
    if (key && key !== "even" && key !== "draw" && !names.includes(key)) names.push(key);
  };
  (v.participants || []).forEach((p) => add(p.name));
  (v.winner?.scores || []).forEach((s) => add(s.participant));
  return (n) => {
    const i = names.indexOf(String(n || "").trim().toLowerCase());
    return i === -1 ? NEUTRAL : PALETTE[i % PALETTE.length];
  };
}

const SOURCE_LABELS = {
  contact_header: "Contact name",
  signed_or_self_named: "Named themselves",
  mentioned_by_other: "Named by the other person",
  bubble_side_only: "No name visible",
};
const sourceLabel = (src) => (Object.hasOwn(SOURCE_LABELS, src) ? SOURCE_LABELS[src] : "Source unknown");

// Who won and by how much. Older saved verdicts may be draws, so the scores settle those.
function winnerOf(v) {
  const w = v?.winner || {};
  const scores = [...(w.scores || [])].sort((a, b) => b.score - a.score);
  const name = (!w.is_draw && w.name) || scores[0]?.participant || "";
  const mine = scores.find((sc) => sc.participant.toLowerCase() === name.toLowerCase());
  const rest = scores.filter((sc) => sc !== mine);
  const margin = mine && rest.length ? Math.max(0, mine.score - rest[0].score) : 0;
  return { name, margin, score: mine?.score, next: rest[0]?.score };
}
const byPoints = (n) => (n === 1 ? "by 1 point" : `by ${n} points`);

function verdictHTML(m, c) {
  const v = m.verdict;
  const unverified = new Set(m.unverified || []);
  // Older chats stored plain quote text; newer ones key each quote by who it's attributed to.
  const isUnverified = (text, who) => unverified.has(quoteKey(who || "", text)) || unverified.has(text);
  const color = colorMap(v);
  const person = (n) => `<span class="person"><span class="dot" style="background:${color(n).bg}"></span>${esc(n)}</span>`;
  const quote = (text, who) =>
    `<div class="quote" style="box-shadow: inset 3px 0 0 ${color(who).bg}">“${esc(text)}”${
      isUnverified(text, who) ? '<span class="tag unverified">Couldn’t verify</span>' : ""
    }</div>`;
  const tag = (value, labels) => `<span class="tag ${esc(value)}">${esc(Object.hasOwn(labels, value) ? labels[value] : value)}</span>`;
  const sev = (s) => tag(s, { low: "Low", medium: "Medium", high: "High" });
  const strength = (s) => tag(s, { strong: "Strong", mixed: "Mixed", weak: "Weak" });
  const empty = (msg) => `<p class="empty">${msg}</p>`;
  let secN = 0;
  const sec = (title, count, body, open = false) => {
    const key = secN++;
    const isOpen = m.open && key in m.open ? m.open[key] : open;
    return `<details class="v-sec" data-msg="${esc(m.id || "")}" data-sec="${key}"${isOpen ? " open" : ""}><summary>${title}${count != null ? ` <span class="count-badge">${count}</span>` : ""}</summary><div class="v-body">${body}</div></details>`;
  };
  const w = v.winner || {};
  const win = winnerOf(v);
  const conf = Math.max(0, Math.min(100, Number(w.confidence) || 0));
  const scores = [...(w.scores || [])].sort((a, b) => b.score - a.score);
  const o = v.origin || {};
  const transcript = m.transcript || (m.source === "paste" ? [] : c.transcript || []);

  return `
    ${c.example ? '<span class="tag example-tag">Example verdict</span>' : ""}
    ${m.repeat ? '<p class="checked repeat" role="note">You’ve judged this conversation before. Same conversation, same verdict.</p>' : ""}
    <h2 class="v-title">${esc(v.title)}</h2>
    ${
      unverified.size
        ? `<p class="banner warn" role="note">${(m.unverified || []).length === 1 ? "1 quote" : `${(m.unverified || []).length} quotes`} in this verdict couldn't be matched to the ${m.transcript ? "screenshots" : "conversation"}, or to the person who wrote them. They're marked below.</p>`
        : transcript.length || c.raw
          ? `<p class="checked"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>Every quote checked against the ${transcript.length ? "screenshots" : "conversation"}</p>`
          : ""
    }
    ${v.safety_note?.trim() ? `<section class="card safety" role="note"><h2>A note on safety</h2><p>${esc(v.safety_note)}</p><button class="cta" type="button" data-doc="safety">Find support</button><p class="safety-fine">Arguably doesn't score conversations like this one.</p></section>` : ""}
    <section class="card winner-card">
      <div class="winner-head">
        <div class="ring" style="--p:${conf}" role="img" aria-label="${conf}% sure"><span>${conf}%<small>sure</small></span></div>
        <div>
          <div class="winner-label">Winner</div>
          <div class="winner-name">${esc(win.name)}</div>
          ${win.margin ? `<div class="winner-margin">Wins ${byPoints(win.margin)} <span>${win.score}–${win.next}</span></div>` : ""}
        </div>
      </div>
      <p>${esc(w.reasoning)}</p>
    </section>
    <section class="card scorecard">
      <h2>Scorecard</h2>
      ${scores
        .map(
          (s) => `
        <div class="score">
          <div class="score-top">${person(s.participant)}<span class="score-num"><b>${Number(s.score) || 0}</b> / 100</span></div>
          <div class="bar"><i style="width:${Math.max(0, Math.min(100, Number(s.score) || 0))}%;background:${color(s.participant).bg}"></i></div>
          <div class="proscons">
            <div><h4>Helped their case</h4><ul class="plus">${(s.strengths || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
            <div><h4>Hurt their case</h4><ul class="minus">${(s.weaknesses || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
          </div>
        </div>`
        )
        .join("")}
    </section>
    ${sec(
      "Where it started",
      null,
      `<p>${esc(o.summary)}</p>
       <div class="spark"><div class="label">First message · ${person(o.spark_speaker)}</div>${quote(o.spark_quote, o.spark_speaker)}</div>
       <div class="label">What it's really about</div><p>${esc(o.root_cause)}</p>
       ${
         o.escalation_points?.length
           ? `<div class="label" style="margin-top:16px">How it escalated</div><ol class="timeline">${o.escalation_points
               .map((e) => `<li>${person(e.speaker)}${quote(e.quote, e.speaker)}<div class="why">${esc(e.why)}</div></li>`)
               .join("")}</ol>`
           : ""
       }`,
      true
    )}
    ${sec(
      "Main subjects compared",
      v.subjects?.length || 0,
      (v.subjects || [])
        .map(
          (s) => `
        <div class="subject">
          <h3>${esc(s.topic)}</h3>
          <span class="edge">${s.edge && s.edge !== "Even" ? `Stronger case: ${esc(s.edge)}` : "Both sides even"}</span>
          <div class="positions">${(s.positions || [])
            .map(
              (p) => `<div class="position" style="box-shadow: inset 3px 0 0 ${color(p.participant).bg}">
                <div class="position-head">${person(p.participant)}${strength(p.strength)}</div>${esc(p.position)}</div>`
            )
            .join("")}</div>
        </div>`
        )
        .join("") || empty("We didn't find a clear subject.")
    )}
    ${sec(
      "People in this conversation",
      v.participants?.length || 0,
      `<div class="names">${(v.participants || [])
        .map(
          (p) => `<div class="name-row">
            <div class="avatar" style="background:${color(p.name).bg};color:${color(p.name).fg}" aria-hidden="true">${esc(String(p.name || "?").trim().charAt(0).toUpperCase())}</div>
            <div><div class="position-head"><strong>${esc(p.name)}</strong><span class="tag">${esc(sourceLabel(p.name_source))}</span></div>
            <div>${esc(p.overall_tone)}</div><div class="src">${esc(p.evidence)}</div></div>
          </div>`
        )
        .join("")}</div>`
    )}
    ${sec(
      "Grudges",
      v.grudges?.length || 0,
      (v.grudges || [])
        .map(
          (g) => `<div class="item"><div class="item-head">${person(g.holder)}<span class="arrow">→</span>${person(g.target)}${sev(g.severity)}</div>
            <p>${esc(g.grudge)}</p>${quote(g.evidence_quote, g.holder)}</div>`
        )
        .join("") || empty("No old grudges came up in this conversation.")
    )}
    ${sec(
      "Personal shots",
      v.personal_shots?.length || 0,
      (v.personal_shots || [])
        .map(
          (s) => `<div class="item"><div class="item-head">${person(s.from)}<span class="arrow">→</span>${person(s.to)}${sev(s.severity)}</div>
            ${quote(s.quote, s.from)}<p class="expl">${esc(s.why_its_personal)}</p></div>`
        )
        .join("") || empty("No personal shots. Both sides stayed on the issue.")
    )}
    ${sec(
      "Logical fallacies",
      v.fallacies?.length || 0,
      (v.fallacies || [])
        .map(
          (f) => `<div class="item"><span class="fallacy-name">${esc(f.fallacy)}</span><div class="item-head">${person(f.speaker)}</div>
            ${quote(f.quote, f.speaker)}<p class="expl">${esc(f.explanation)}</p></div>`
        )
        .join("") || empty("No logical fallacies found.")
    )}
    ${
      transcript.length
        ? sec(
            "What we read",
            transcript.filter((t) => t.kind !== "gap").length,
            `<p class="expl">Every message read from the screenshots, in order, with both phones merged. Check this if something in the verdict looks off.</p>
            <ol class="transcript">${transcript
              .map((t) =>
                t.kind === "gap"
                  ? '<li class="gap">Possible missing messages here. These screenshots don\'t overlap.</li>'
                  : `<li><div class="t-head">${person(t.sender)}${t.time ? `<span class="t-time">${esc(t.time)}</span>` : ""}<span class="t-src">${t.shots?.length ? `Screenshot ${t.shots.join(", ")}` : ""}</span></div><div class="t-text">${esc(t.text)}</div></li>`
              )
              .join("")}</ol>`
          )
        : ""
    }
    <section class="card takeaway-card"><h2>How to move forward</h2><p class="takeaway">${esc(v.takeaway)}</p></section>`;
}

// ---------- rendering: who's who ----------
function whoHTML(m) {
  if (m.status === "done") {
    const names = [...new Set(m.groups.flatMap((g) => [g.me, g.them]).filter(Boolean))];
    return `<div class="msg who done"><span class="who-icon" aria-hidden="true">✓</span><div><strong>Who's who confirmed</strong><div class="who-line">${esc(
      names.join(" and ")
    )}${m.you ? ` · You're ${esc(m.you)}` : ""}</div></div></div>`;
  }
  const phones = m.groups.length;
  return `<div class="msg who" id="${m.id}">
    <h3>Check who's who</h3>
    <p class="who-sub">We read ${plural(m.messageCount, "message")} from ${plural(m.shotCount, "screenshot")}${
      phones > 1 ? ` taken on ${phones} phones` : ""
    }. Each phone shows its owner on the right, so check the names before the verdict.</p>
    ${m.groups
      .map(
        (g, i) => `<fieldset class="who-group">
        <legend>${g.shots.length > 1 ? "Screenshots" : "Screenshot"} ${g.shots.join(", ")}${g.header ? ` · chat with “${esc(g.header)}”` : ""}</legend>
        <label class="side-row"><span class="side-chip left">Left side</span>
          ${
            g.isGroup
              ? '<span class="group-note">Group chat: names come from the labels above each bubble</span>'
              : `<input type="text" id="who-${m.id}-${i}-them" data-g="${i}" data-side="them" value="${esc(g.them)}" autocomplete="off" aria-label="Name for the left bubbles">`
          }
        </label>
        <label class="side-row"><span class="side-chip right">Right side</span>
          <input type="text" id="who-${m.id}-${i}-me" data-g="${i}" data-side="me" value="${esc(g.me)}" autocomplete="off" aria-label="Name for the right bubbles">
        </label>
      </fieldset>`
      )
      .join("")}
    <div class="you-row" role="radiogroup" aria-label="Are you in this argument?">
      <span class="label">Are you in this argument?</span>
      <div class="you-chips" id="you-${m.id}"></div>
    </div>
    <button class="cta" type="button" data-confirm="${m.id}">Looks right, get the verdict</button>
  </div>`;
}

function renderYouChips(m) {
  const box = document.getElementById("you-" + m.id);
  if (!box) return;
  const names = [...new Set(m.groups.flatMap((g) => [g.me, g.them]).map((s) => String(s || "").trim()).filter(Boolean))];
  if (m.you && m.you !== "__none" && !names.includes(m.you)) m.you = "";
  box.innerHTML =
    names
      .map((n) => `<button type="button" role="radio" aria-checked="${m.you === n}" class="you-chip${m.you === n ? " on" : ""}" data-you="${esc(n)}">${esc(n)}</button>`)
      .join("") +
    `<button type="button" role="radio" aria-checked="${m.you === "__none"}" class="you-chip${m.you === "__none" ? " on" : ""}" data-you="__none">I'm not in it</button>`;
}

// ---------- rendering: messages and screens ----------
function messageHTML(m) {
  if (m.role === "user") {
    const shots = m.shots?.length
      ? `<div class="shots">${m.shots.map((s, i) => `<img src="${s}" alt="Screenshot ${i + 1}">`).join("")}</div>`
      : m.shotCount
        ? `<div class="shot-count">${plural(m.shotCount, "screenshot")}</div>`
        : "";
    return `<div class="msg user${!m.text && m.shots?.length ? " only-shots" : ""}">${shots}${m.text ? `<div class="u-text">${esc(m.text.length > 600 ? m.text.slice(0, 600) + "…" : m.text)}</div>` : ""}</div>`;
  }
  if (m.kind === "verdict") return `<article class="msg verdict${m.verdict?.safety_note?.trim() ? " has-safety" : ""}">${verdictHTML(m, chat)}</article>`;
  if (m.kind === "who") return whoHTML(m);
  if (m.kind === "nudge") return nudgeHTML();
  if (m.kind === "resume") return resumeHTML(m);
  if (m.kind === "error") return `<div class="msg error"><p class="banner" role="alert">${esc(m.text)}</p></div>`;
  if (m.kind === "thinking")
    return `<div class="msg reply" id="${m.id}"><div class="thinking"><span class="dots"><i></i><i></i><i></i></span><span class="step">${esc(m.text)}</span></div>${
      m.progress != null ? `<div class="progress" aria-hidden="true"><i style="width:${Math.round(m.progress * 100)}%"></i></div>` : ""
    }</div>`;
  return `<div class="msg reply" id="${m.id || ""}">${formatReply(m.text)}${m.interrupted ? '<p class="interrupted">Reply stopped before it finished.</p>' : ""}</div>`;
}

// Closes the example: gets people thinking about their own last argument, then sends them to grab it.
const JOGGERS = [
  ["💬", "The one you replayed in the shower"],
  ["🌙", "The late-night text you almost didn't send"],
  ["👀", "The one where they said “whatever”"],
  ["🧾", "The one they swear went differently"],
];
function nudgeHTML() {
  return `<section class="msg nudge" aria-labelledby="nudgeTitle">
    <span class="nudge-eyebrow">Your turn</span>
    <h2 id="nudgeTitle">Think of your last argument.</h2>
    <p>You know the one. It's probably still sitting in your messages.</p>
    <ul class="joggers">${JOGGERS.map(([e, t]) => `<li><span aria-hidden="true">${e}</span>${t}</li>`).join("")}</ul>
    <ol class="grab">
      <li><b>1</b>Open that chat and scroll to where it started.</li>
      <li><b>2</b>Screenshot down to the last message.</li>
      <li><b>3</b>Got their side too? Add those. Any order works.</li>
    </ol>
    <button class="cta" type="button" data-action="import">${svg(ICON.upload, 20)}Import my screenshots</button>
    <button class="nudge-alt" type="button" data-action="paste-new">Or paste the text instead</button>
  </section>`;
}

const ICON = {
  upload: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  paste: '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h4"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="m10 8.5 5 3.5-5 3.5z"/>',
  phones: '<rect x="3" y="4" width="8" height="15" rx="2"/><rect x="14" y="7" width="7" height="13" rx="2"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 20a5 5 0 0 1 5.5-5"/>',
  quote: '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
};
const svg = (d, size = 22) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

// The example card settles in once per page load; a re-render picks the animation up where it was.
let homeShownAt = 0;
let showAllRecent = false;

function homeHTML() {
  const recent = showAllRecent ? chats : chats.slice(0, 8);
  const notice = claudeChecked && !sampler
    ? '<p class="notice">Open Arguably on claude.ai while signed in to get verdicts. You can still see the example.</p>'
    : "";
  // The demo plays once per page load; re-renders during startup continue it where it was.
  homeShownAt ||= performance.now();
  const since = Math.round(performance.now() - homeShownAt);
  const play = since < 3500 ? ` data-play="" style="--t0:-${since}ms"` : "";
  const d = (ms) => ` style="--d:${ms}ms"`;
  return `<section class="home">
    ${notice}
    <div class="home-hero">
      <h1>Who's <em>actually</em> right?</h1>
      <p>Drop in the screenshots from both phones. Get a fair verdict, with receipts.</p>
    </div>
    <div class="demo"${play}>
      <div class="demo-phones" aria-hidden="true">
        <div class="demo-phone maya">
          <span class="demo-label"><i></i>Maya's phone</span>
          <span class="demo-chat">Jordan</span>
          <span class="bub out"${d(150)}>So you were 'asleep' but liking Brianna's pics at 2am? 👀</span>
          <span class="bub in"${d(500)}>You literally left me on read for 6 hours yesterday<b class="stamp fallacy"${d(1350)}>Whataboutism</b></span>
          <span class="bub out"${d(850)}>This is literally the same thing that happened in March<b class="stamp grudge"${d(1500)}>Grudge</b></span>
        </div>
        <div class="demo-phone jordan">
          <span class="demo-label"><i></i>Jordan's phone</span>
          <span class="demo-chat">Maya</span>
          <span class="bub in"${d(700)}>This is literally the same thing that happened in March</span>
          <span class="bub out"${d(1050)}>Wow ok sorry I'm not perfect like you 🙄<b class="stamp shot"${d(1650)}>Personal shot</b></span>
          <span class="bub in typing"${d(1250)}><i></i><i></i><i></i></span>
        </div>
      </div>
      <button class="demo-verdict" type="button" data-action="example" aria-label="See an example verdict: Maya has the stronger case"${d(1800)}>
        <span class="dv-top"><span class="dv-eyebrow">Verdict</span><span class="dv-tag">Example</span></span>
        <span class="dv-title">Maya has the stronger case.</span>
        <span class="dv-bar"><i style="flex:72;--d:2000ms"></i><i style="flex:41;--d:2000ms"></i></span>
        <span class="dv-scores"><span><i class="dot maya"></i>Maya 72</span><span>Jordan 41<i class="dot jordan"></i></span></span>
        <span class="dv-chips"${d(2300)}><span>3 fallacies</span><span>2 personal shots</span><span>1 grudge</span><span class="ok">${svg(ICON.check, 13)}Quotes checked</span></span>
      </button>
    </div>
    <ul class="proof">
      <li>${svg(ICON.phones, 20)}<span><strong>Both phones</strong> merged in order</span></li>
      <li>${svg(ICON.people, 20)}<span><strong>You confirm</strong> who's who first</span></li>
      <li>${svg(ICON.quote, 20)}<span><strong>Every quote</strong> checked</span></li>
    </ul>
    <div class="home-sheet">
      <p class="sheet-prompt">Still thinking about your last argument? <span>Start there.</span></p>
      <button class="import-btn" type="button" data-action="import">${svg(ICON.upload, 22)}Import screenshots</button>
      <p class="import-note">Both phones · any order · ${STORE_BUILD && !prefs.pro ? `try Pro free for ${PLANS.yearly.trialDays} days` : `up to ${MAX_IMAGES}`}</p>
      <div class="sheet-row">
        <button class="sheet-btn" type="button" data-action="paste">${svg(ICON.paste, 20)}Paste text</button>
        <button class="sheet-btn" type="button" data-action="example">${svg(ICON.play, 20)}Try an example</button>
      </div>
    </div>
    ${
      recent.length
        ? `<section class="recent"><h2>Recent</h2><ul>${recent
            .map((c) => {
              const v = verdictsOf(c).at(-1);
              const names = v ? (v.participants || []).map((p) => p.name).slice(0, 2) : [];
              const meta = live.has(c.id) ? "Working on it…" : pendingWho(c) ? "Check who's who" : v ? (v.safety_note?.trim() ? "Note on safety" : `${esc(winnerOf(v).name)} won${winnerOf(v).margin ? ` ${byPoints(winnerOf(v).margin)}` : ""}`) : "No verdict yet";
              return `<li><button type="button" data-chat="${esc(c.id)}">
                <span class="pair" aria-hidden="true">${(names.length ? names : ["?"])
                  .map((n, i) => `<span style="background:${PALETTE[i].bg};color:${PALETTE[i].fg}">${esc(String(n).trim().charAt(0).toUpperCase())}</span>`)
                  .join("")}</span>
                <span class="r-main"><span class="r-title">${esc(c.title)}</span><span class="r-meta">${meta} · ${relTime(c.updatedAt || c.createdAt)}</span></span>
                <span class="r-go">${svg(ICON.chevron, 18)}</span>
              </button></li>`;
            })
            .join("")}</ul>${chats.length > 8 ? `<button class="see-all" type="button" data-action="all-recent">${showAllRecent ? "Show less" : `See all ${chats.length}`}</button>` : ""}</section>`
        : ""
    }
  </section>`;
}

const PAGE_ICON = {
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  device: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  scale: '<path d="M12 3v18M5 7h14M7 7l-3 7a3 3 0 0 0 6 0L7 7zM17 7l-3 7a3 3 0 0 0 6 0l-3-7z"/>',
  who: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 3.5a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6"/>',
};
const pageSvg = (d, size = 22) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const OB_STEPS = 4;
const PHOTO_ICON = '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>';
const VIDEO_ICON = '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-3v10l-6-3z"/>';
function onboardingHTML() {
  // Someone who finished the intro before only sees the agreement step.
  if (gateMode) onboardStep = 1;
  const agreed = policyOk();
  const dots = gateMode
    ? ""
    : `<div class="ob-dots" role="tablist" aria-label="Intro steps">${Array.from({ length: OB_STEPS }, (_, i) =>
        `<button type="button" role="tab" aria-selected="${i === onboardStep}" aria-label="Step ${i + 1} of ${OB_STEPS}" data-step="${i}"><i class="${i === onboardStep ? "on" : ""}"></i></button>`
      ).join("")}</div>`;
  const steps = [
    `<div class="ob-art ob-logo"><img src="${MARK_URI}" alt="" width="84" height="77"></div>
     <h1>Settle it.<br><em>With receipts.</em></h1>
     <p>Import screenshots of any argument, yours or someone else's. See where it started, who made the stronger case, and every cheap shot along the way.</p>
     ${dots}
     <div class="ob-actions"><button class="cta" type="button" data-action="next">Get started</button></div>`,
    `<div class="ob-art">${pageSvg(PAGE_ICON.lock, 40)}</div>
     <h1>${gateMode ? "Before you continue" : "Private by default"}</h1>
     <ul class="ob-list">
       <li>${pageSvg(PAGE_ICON.device)}<span><strong>Screenshots aren't saved.</strong> They're read, then let go.</span></li>
       <li>${pageSvg(PAGE_ICON.lock)}<span><strong>Chats stay on this device.</strong> Delete them anytime in Settings.</span></li>
       <li>${pageSvg(PAGE_ICON.spark)}<span>${HOSTED ? "<strong>No account needed.</strong> Import and go." : `<strong>Runs on your ${AI_NAME} account.</strong> Verdicts use your ${AI_NAME} plan. No subscription here.`}</span></li>
     </ul>
     <label class="ob-agree${agreed ? " on" : ""}" id="obAgreeRow">
       <input type="checkbox" id="obAgree"${agreed ? " checked" : ""}>
       <span class="ob-check" aria-hidden="true">${svg(ICON.check, 16)}</span>
       <span>I agree to the Privacy Policy and Terms of Use.</span>
     </label>
     <p class="ob-docs">Read the <button type="button" class="ob-link" data-ob-doc="privacy">Privacy Policy</button> · <button type="button" class="ob-link" data-ob-doc="terms">Terms of Use</button></p>
     <p class="ob-fine">Verdicts are written by ${AI_NAME}, an AI by ${AI_MAKER}. Allowing sends only the conversations you import. Change it in Settings.</p>
     ${dots}
     <div class="ob-actions${agreed ? "" : " locked"}">
       <button class="cta" type="button" data-action="consent-next" aria-disabled="${!agreed}">Allow and continue</button>
       <button class="ob-secondary" type="button" data-action="agree-next" aria-disabled="${!agreed}">Continue without ${AI_NAME}</button>
     </div>`,
    `<div class="ob-art">${pageSvg(PAGE_ICON.who, 40)}</div>
     <h1>What should we call you?</h1>
     <p>So we can spot you in screenshots. Leave it blank if you're mostly judging other people's arguments.</p>
     <label class="field"><span>Your name</span><input id="obName" type="text" autocomplete="given-name" maxlength="40" value="${esc(prefs.name)}" placeholder="e.g. Maya"></label>
     ${dots}
     <div class="ob-actions"><button class="cta" type="button" data-action="next">Next</button></div>`,
    `<div class="ob-art">${pageSvg(PHOTO_ICON, 40)}</div>
     <h1>Your photos,<br><em>your pick.</em></h1>
     <ul class="ob-list">
       <li>${pageSvg(PHOTO_ICON)}<span><strong>Screenshots from both phones.</strong> Any order. We line them up.</span></li>
       <li>${pageSvg(VIDEO_ICON)}<span><strong>Screen recordings work too.</strong> Scroll through the chat once and we pull every message out.</span></li>
       <li>${pageSvg(PAGE_ICON.lock)}<span><strong>Only what you choose.</strong> Arguably never browses the rest of your Photos.</span></li>
     </ul>
     ${dots}
     <div class="ob-actions">
       <button class="cta" type="button" data-action="photos">Allow access to Photos</button>
       <button class="ob-secondary" type="button" data-action="example">Show me an example first</button>
     </div>`,
  ];
  return `<section class="onboard${onboardDir < 0 ? " back" : ""}${gateMode ? " policy-only" : ""}" aria-live="polite">${steps[onboardStep]}</section>`;
}

const SET_ICON = {
  scale: '<path d="M12 3v18M5 7h14M7 7l-3 7a3 3 0 0 0 6 0L7 7zM17 7l-3 7a3 3 0 0 0 6 0l-3-7z"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  tone: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  claude: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  flag: '<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',
  replay: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="m10 8.5 5 3.5-5 3.5z"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
};
const tile = (icon, tint) => `<span class="tile ${tint}" aria-hidden="true">${pageSvg(SET_ICON[icon], 17)}</span>`;
const chev = `<span class="set-chev" aria-hidden="true">${svg(ICON.chevron, 16)}</span>`;
const DOC_PAGES = ["privacy", "ai", "terms", "safety", "licenses"];

function settingsHTML() {
  const text = (title, sub) => `<span class="set-text"><span class="set-title">${title}</span>${sub ? `<span class="set-sub">${sub}</span>` : ""}</span>`;
  const sw = (key, on, icon, tint, title, sub) => `<button class="set-row" type="button" role="switch" aria-checked="${on}" data-toggle="${key}">
      ${tile(icon, tint)}${text(title, sub)}<span class="switch${on ? " on" : ""}" aria-hidden="true"><i></i></span></button>`;
  const link = (attrs, icon, tint, title, sub = "", extra = "") => `<button class="set-row" type="button" ${attrs}>${tile(icon, tint)}${text(title, sub)}${extra}${chev}</button>`;
  const mail = (subject, icon, tint, title, sub) =>
    `<a class="set-row" href="mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}">${tile(icon, tint)}${text(title, sub)}${chev}</a>`;
  const saved = chats.length;
  return `<section class="settings">
    <h1 class="page-title">Settings</h1>
    <div class="set-group">
      <label class="set-card profile">
        <span class="avatar" aria-hidden="true">${esc((prefs.name || "?").charAt(0).toUpperCase())}</span>
        <span class="profile-main"><span class="set-sub">Your name</span>
        <input id="setName" type="text" autocomplete="given-name" maxlength="40" value="${esc(prefs.name)}" placeholder="Add your name"></span>
      </label>
      <p class="set-foot">Used to spot you in screenshots. Leave it blank if you mostly judge other people's arguments.</p>
    </div>

    ${STORE_BUILD ? proSettingsHTML(link) : ""}
    <div class="set-group">
      <h2>Verdicts</h2>
      <div class="set-card">
        <div class="set-row static">${tile("tone", "ember")}${text("Tone", "How Arguably talks to you.")}</div>
        <div class="seg-wrap"><div class="segmented" role="radiogroup" aria-label="Verdict tone">
          <button type="button" role="radio" aria-checked="${prefs.tone === "straight"}" data-tone="straight" class="${prefs.tone === "straight" ? "on" : ""}">Straight talk</button>
          <button type="button" role="radio" aria-checked="${prefs.tone === "gentle"}" data-tone="gentle" class="${prefs.tone === "gentle" ? "on" : ""}">Gentle</button>
        </div></div>
      </div>
    </div>

    <div class="set-group">
      <h2>AI &amp; screenshots</h2>
      <div class="set-card">
        ${sw("aiConsent", prefs.aiConsent, "claude", "navy", `Send chats to ${AI_NAME}`, `Needed for verdicts. ${AI_NAME} is an AI by ${AI_MAKER}.`)}
        ${sw("readOnPhone", prefs.readOnPhone, "phone", "sand", "Read screenshots on this phone", `${AI_NAME} gets the text, never the images.`)}
        ${link('data-doc="ai"', "info", "blue", "How AI is used")}
      </div>
    </div>

    <div class="set-group">
      <h2>Notifications</h2>
      <div class="set-card">
        ${sw("verdict", prefs.notify.verdict, "bell", "ember", "Verdict ready", "When a verdict finishes while you're elsewhere.")}
        ${sw("who", prefs.notify.who, "bell", "blue", "Screenshots read", "When it's time to check who's who.")}
        ${sw("tips", prefs.notify.tips, "bell", "green", "Tips", "Now and then. Never marketing.")}
        ${link('data-action="inbox"', "bell", "sand", "All notifications")}
      </div>
    </div>

    <div class="set-group">
      <h2>Privacy &amp; data</h2>
      <div class="set-card">
        ${link('data-doc="privacy"', "shield", "green", "Privacy Policy")}
        ${link('data-action="export"', "download", "blue", "Export my data", `${plural(saved, "chat")} on this device`)}
        ${
          confirmingDelete
            ? `<div class="confirm-row" role="alert"><span>Erase all chats, notifications and settings on this device? This can't be undone.</span>
                 <button class="ghost-btn" type="button" data-action="delete-cancel">Cancel</button>
                 <button class="danger-btn" type="button" data-action="delete-confirm">Erase everything</button></div>`
            : `<button class="set-row danger-row" type="button" data-action="delete-all">${tile("trash", "red")}${text("Delete all data")}</button>`
        }
      </div>
      <p class="set-foot">No account. No ads. No tracking. Screenshots are never saved.</p>
    </div>

    <div class="set-group">
      <h2>Support</h2>
      <div class="set-card">
        ${link('data-doc="safety"', "heart", "red", "If an argument doesn't feel safe")}
        ${mail("Arguably support", "mail", "blue", "Contact support")}
        ${mail("Report a verdict", "flag", "ember", "Report a verdict", "Wrong, unfair or harmful? Tell us.")}
        ${link('data-action="example"', "play", "navy", "See an example verdict")}
        ${link('data-action="replay"', "replay", "sand", "Replay the intro")}
      </div>
    </div>

    <div class="set-group">
      <h2>About</h2>
      <div class="set-card">
        ${link('data-doc="terms"', "doc", "sand", "Terms of Use")}
        ${link('data-doc="licenses"', "code", "sand", "Open-source licenses")}
        <div class="set-row static">${tile("info", "sand")}${text("Version")}<span class="set-value">${APP_VERSION}</span></div>
      </div>
      <p class="set-about"><img src="${MARK_URI}" alt="" width="22" height="20">Arguably · Verdicts by ${AI_NAME}</p>
    </div>
  </section>`;
}

function proSettingsHTML(link) {
  const used = prefs.proUsage.month === monthKey() ? prefs.proUsage.n : 0;
  return `<div class="set-group">
      <h2>Arguably Pro</h2>
      <div class="set-card">
        ${
          prefs.pro
            ? `<div class="set-row static">${tile("scale", "ember")}<span class="set-text"><span class="set-title">Pro · ${prefs.pro.plan === "monthly" ? "Monthly" : "Yearly"}</span><span class="set-sub">${used} of ${PRO_FAIR_USE} verdicts this month</span></span></div>
               <a class="set-row" href="https://apps.apple.com/account/subscriptions" target="_blank" rel="noopener">${tile("doc", "sand")}<span class="set-text"><span class="set-title">Manage subscription</span></span>${chev}</a>`
            : link('data-action="paywall"', "scale", "ember", "Go Pro", `Start your ${PLANS.yearly.trialDays}-day free trial`)
        }
        <button class="set-row" type="button" data-action="restore">${tile("replay", "sand")}<span class="set-text"><span class="set-title">Restore purchases</span></span></button>
      </div>
    </div>`;
}

// In-app policy pages. Drafts: have them reviewed before submission.
const DOCS = {
  privacy: {
    title: "Privacy Policy",
    body: () => `<p class="doc-date">Effective ${POLICY_DATE}</p>
      <p class="doc-lede">Short version: your arguments stay yours. No account, no ads, no tracking, and nothing sold.</p>
      <h2>What Arguably keeps</h2><p>Only on this device: your chats (the conversation text, who's who and verdicts), your name if you add one, notifications and settings. Arguably has no account system and keeps no copy on a server.</p>
      <h2>Photos and videos</h2><p>Arguably only sees the screenshots and screen recordings you pick. It never browses the rest of your photo library. Screen recordings are turned into still frames on your device; the video itself is never uploaded or saved. Screenshots are read, then let go. They aren't stored with your chats.</p>
      <h2>What leaves your device</h2><p>When you ask for a verdict, the conversation, and the screenshots unless “Read screenshots on this phone” is on, is sent to ${AI_NAME}, an AI by ${AI_MAKER}, to write the verdict. It's sent only after you allow it, and only to answer you.</p>
      ${HOSTED
        ? `<h2>How ${AI_NAME} is run</h2><p>On this website, requests pass through Arguably's server, which keeps no copy, to Groq, which runs the model. Groq doesn't use your conversations to train AI and doesn't keep them by default. It may keep logs for up to 30 days to investigate abuse or keep the service reliable.</p>`
        : `<h2>How ${AI_NAME} is run</h2><p>On claude.ai, verdicts run on your own ${AI_NAME} account, under Anthropic's terms and privacy policy for that account.</p>`}
      <h2>Tracking and ads</h2><p>Arguably doesn't track you across apps or websites, doesn't show ads, and doesn't sell or share your data with data brokers or advertisers.</p>
      <h2>Your choices</h2><p>Turn off “Send chats to ${AI_NAME}” anytime. Export or delete everything from Settings › Privacy &amp; data. Deleting is immediate and permanent.</p>
      <h2>Children</h2><p>Arguably isn't for children under 13, and doesn't knowingly collect anything from them.</p>
      <h2>Changes</h2><p>If this policy changes, Arguably asks you to agree again before you keep using it.</p>
      <h2>Contact</h2><ul class="help-list"><li><a href="mailto:${SUPPORT_EMAIL}">Email us<span>${SUPPORT_EMAIL}</span></a></li></ul>
      ${policyOk() ? `<p class="doc-state ok">${svg(ICON.check, 16)}You agreed on ${new Date(prefs.policy.at).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}.</p>` : ""}`,
  },
  ai: {
    title: "How AI is used",
    body: () => `<p class="doc-lede">Arguably uses ${AI_NAME}, an AI made by ${AI_MAKER}, to read arguments and write verdicts.</p>
      <h2>What ${AI_NAME} gets</h2><ul><li>The conversation text from your screenshots or paste</li><li>The screenshots themselves, unless “Read screenshots on this phone” is on</li><li>Names you confirm on the who's-who step, and any note you add</li></ul>
      <h2>What ${AI_NAME} doesn't get</h2><ul><li>Your contacts, photo library or location</li><li>Other chats on this device</li></ul>
      <h2>What to keep in mind</h2><p>Verdicts are an AI's opinion, not a fact or professional advice. Every quote in a verdict is checked against the conversation, and anything that doesn't match is flagged. If a verdict looks wrong or unfair, report it from Settings.</p>
      ${prefs.aiConsent ? `<p class="doc-state ok">${svg(ICON.check, 16)}You've allowed sending chats to ${AI_NAME}.</p>` : `<button class="cta" type="button" data-action="consent">Allow sending chats to ${AI_NAME}</button>`}`,
  },
  terms: {
    title: "Terms of Use",
    body: () => `<p class="doc-date">Effective ${POLICY_DATE}</p>
      <p class="doc-lede">By using Arguably you agree to these terms.</p>
      <h2>For fun and perspective</h2><p>Verdicts are AI opinions for entertainment and reflection. They aren't legal, medical, mental-health or relationship advice.</p>
      <h2>Your content</h2><p>Only import conversations you have the right to share. Don't use Arguably to harass, shame or threaten anyone.</p>
      <h2>Age</h2><p>You must be at least 13, and old enough to consent where you live.</p>
      <h2>No warranty</h2><p>Arguably is provided as is. The AI can make mistakes.</p>
      ${STORE_BUILD ? `<h2>Arguably Pro</h2><p>Pro is an auto-renewing subscription: ${PLANS.monthly.price}/month, or ${PLANS.yearly.price}/year with a ${PLANS.yearly.trialDays}-day free trial. Payment is charged to your Apple ID at confirmation. It renews automatically unless canceled at least 24 hours before the end of the period. Manage or cancel in your App Store account settings. Pro includes up to ${PRO_FAIR_USE} verdicts per month.</p>` : ""}
      ${HOSTED ? "" : "<h2>Apple</h2><p>If you got Arguably from the App Store, Apple's Licensed Application End User License Agreement also applies.</p>"}`,
  },
  safety: {
    title: "Staying safe",
    body: () => `<p class="doc-lede">Some arguments aren't about who's right. If someone threatens you, controls who you see or what you do, or you feel afraid, that matters more than any verdict.</p>
      <h2>Talk to someone now</h2><ul class="help-list">
        <li><a href="https://findahelpline.com" target="_blank" rel="noopener">Find a free, confidential helpline in your country<span>findahelpline.com</span></a></li>
        <li><a href="tel:988">988 Suicide &amp; Crisis Lifeline (US)<span>Call or text 988</span></a></li>
        <li><a href="https://www.thehotline.org" target="_blank" rel="noopener">National Domestic Violence Hotline (US)<span>1-800-799-7233 · text START to 88788</span></a></li>
      </ul>
      <p>In immediate danger, call your local emergency number.</p>`,
  },
  licenses: {
    title: "Open-source licenses",
    body: () => `<p class="doc-lede">Arguably is built with open-source software. Thank you to its authors.</p>
      <h2>Tesseract OCR</h2><p>tesseract.js-core and tessdata_fast English data. Apache License 2.0. Copyright Google Inc. and the Tesseract contributors.</p>
      <ul class="help-list"><li><a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noopener">Apache License 2.0<span>apache.org</span></a></li></ul>`,
  },
};
function docHTML(name) {
  const d = DOCS[name];
  return `<article class="doc"><h1 class="page-title">${d.title}</h1>${d.body()}</article>`;
}

function inboxHTML() {
  const unread = unreadCount();
  const icon = { verdict: PAGE_ICON.scale, who: PAGE_ICON.who, tips: PAGE_ICON.spark, rate: PAGE_ICON.star };
  return `<section class="inbox">
    <h1 class="page-title">Notifications</h1>
    <div class="inbox-top">
      <p>${unread ? `${plural(unread, "new notification")}` : "You're all caught up."}</p>
      ${unread ? '<button class="ghost-btn" type="button" data-action="read-all">Mark all as read</button>' : ""}
    </div>
    ${
      inbox.length
        ? `<ul class="notes">${inbox
            .map(
              (n) => `<li><button type="button" class="note${n.read ? "" : " unread"}" data-note="${esc(n.id)}">
                <span class="note-icon ${esc(n.kind)}">${pageSvg(icon[n.kind] || PAGE_ICON.bell, 20)}</span>
                <span class="note-main"><span class="note-title">${esc(n.title)}</span><span class="note-body">${esc(n.body)}</span><span class="note-time">${relTime(n.at)}</span></span>
                ${n.read ? "" : '<span class="note-dot" aria-label="Unread"></span>'}
              </button></li>`
            )
            .join("")}</ul>`
        : `<div class="inbox-empty">${pageSvg(PAGE_ICON.bell, 36)}<h2>Nothing yet</h2><p>When screenshots are read or a verdict is ready, it shows up here. You can leave a chat while it works.</p></div>`
    }
    <p class="inbox-note">${HOSTED ? "Updates show here and as a badge on the bell. Add Arguably to your Home Screen to open it like an app." : "Phone notifications come with the App Store version. For now, updates show here and as a badge on the bell."}</p>
  </section>`;
}

function emptyChatHTML() {
  return `<section class="start-hint">
    <h2>New argument</h2>
    <p>${pending.length ? "Add a note if it helps, like how you know each other, then send." : "Import screenshots with the image button, or paste the conversation below. Include names if you paste, like “Maya: …”."}</p>
  </section>`;
}

const PAGE_TITLES = { settings: "Settings", inbox: "Notifications", onboarding: "", paywall: "", privacy: "Privacy Policy", ai: "How AI is used", terms: "Terms of Use", safety: "Staying safe", licenses: "Licenses" };

function renderHeader() {
  const onHome = !chat && !page;
  $("backBtn").hidden = onHome || page === "onboarding" || page === "paywall";
  $("backBtn").setAttribute("aria-label", DOC_PAGES.includes(page) ? (docReturn ? "Back" : "Back to Settings") : consentReturn ? "Back to the chat" : "Back to home");
  $("homeBtn").hidden = !onHome && page !== "onboarding";
  // On the intro the logo is just a logo until the policy is agreed.
  $("homeBtn").disabled = page === "onboarding" && (!policyOk() || gateMode);
  $("chatTitle").hidden = onHome || page === "onboarding";
  $("chatTitle").textContent = page ? PAGE_TITLES[page] : chat?.title || "";
  $("newBtn").hidden = !!page || onHome;
  const deletable = !page && !!chat && !chat.example && chats.some((x) => x.id === chat.id);
  $("deleteBtn").hidden = !deletable;
  if (!deletable) $("deleteBtn").classList.remove("confirm");
  $("topActions").hidden = !onHome;
  $("skipBtn").hidden = page !== "onboarding" || gateMode;
  const unread = unreadCount();
  $("inboxBadge").hidden = !unread;
  $("inboxBadge").textContent = unread > 9 ? "9+" : String(unread);
  $("inboxBtn").setAttribute("aria-label", unread ? `Notifications, ${unread} unread` : "Notifications");
}

function render() {
  const onHome = !chat && !page;
  document.body.classList.toggle("on-home", onHome);
  document.body.classList.toggle("on-page", !!page);
  document.body.classList.toggle("on-paywall", page === "paywall");
  renderHeader();
  $("composer").hidden = onHome || !!page;

  const thread = $("thread");
  thread.innerHTML = page === "onboarding"
    ? onboardingHTML()
    : page === "settings"
      ? settingsHTML()
      : page === "inbox"
        ? inboxHTML()
        : page === "paywall"
          ? paywallHTML()
        : DOC_PAGES.includes(page)
          ? docHTML(page)
        : onHome
          ? homeHTML()
          : chat.messages.length
            ? chat.messages.map(messageHTML).join("")
            : emptyChatHTML();
  if (page) {
    requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    return;
  }
  const who = pendingWho();
  if (who) renderYouChips(who);
  renderSuggestions();
  renderComposer();
  // New verdicts and who's-who cards open at their top; everything else follows the latest message.
  requestAnimationFrame(() => {
    const trail = !onHome && chat?.messages.at(-1)?.kind === "nudge";
    const last = !onHome && chat?.messages.at(trail ? -2 : -1);
    let top = last ? document.documentElement.scrollHeight : 0;
    if (last && (last.kind === "verdict" || last.kind === "who")) {
      const el = trail ? thread.lastElementChild?.previousElementSibling : thread.lastElementChild;
      if (el) top = el.getBoundingClientRect().top + window.scrollY - (document.querySelector(".topbar")?.offsetHeight || 0) - 12;
    }
    window.scrollTo({ top });
  });
}

function renderSuggestions() {
  const box = $("suggestions");
  const last = chat?.messages.at(-1);
  const show = !busyHere() && last?.kind === "verdict" && sampler;
  box.hidden = !show;
  box.innerHTML = show
    ? '<button type="button" class="import-chip" data-pick="">Import more screenshots</button>' +
      SUGGESTIONS.map((s) => `<button type="button" data-say="${esc(s)}">${esc(s)}</button>`).join("")
    : "";
}

function renderComposer() {
  const strip = $("attachStrip");
  strip.hidden = pending.length === 0;
  strip.innerHTML =
    pending
      .map(
        (p, i) => `<div class="attach-item"><img src="${p.url}" alt="Screenshot ${i + 1}"><span class="num">${i + 1}</span>
        <button class="remove" type="button" data-remove="${p.id}" aria-label="Remove screenshot ${i + 1}"><span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></span></button></div>`
      )
      .join("") + (pending.length ? '<span class="attach-hint">Any order works. We line them up by the messages.</span>' : "");
  const form = $("composer");
  const here = busyHere();
  form.classList.toggle("busy", here);
  const waitingOnWho = !!pendingWho();
  const hasInput = pending.length > 0 || $("messageInput").value.trim().length > 0;
  $("sendBtn").disabled = !here && (!sampler || !hasInput || waitingOnWho);
  $("sendBtn").setAttribute("aria-label", here ? "Stop" : "Send");
  $("attachBtn").classList.toggle("disabled", here || waitingOnWho);
  $("messageInput").disabled = waitingOnWho;
  $("messageInput").placeholder = waitingOnWho
    ? "Confirm who's who first"
    : pending.length
      ? "Add a note, or just send"
      : verdictsOf(chat).length
        ? "Ask about this argument"
        : "Or paste the conversation";
  document.documentElement.style.setProperty("--composer-h", (form.hidden ? 0 : form.offsetHeight) + "px");
}

function updateThinking(m, text, progress) {
  m.text = text;
  if (progress != null) m.progress = progress;
  const el = document.getElementById(m.id);
  if (el) el.outerHTML = messageHTML(m);
}

// ---------- screenshots: import, dedupe, smart slicing ----------
function loadImage(url) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
}

// Fingerprint of every pixel. Chat screenshots differ by a few lines of text, which a
// thumbnail can't see, so only a true re-import of the same image counts as a duplicate.
function pixelKey(c) {
  const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] >> 2) | ((d[i + 1] >> 2) << 6) | ((d[i + 2] >> 2) << 12);
    h1 = Math.imul(h1 ^ v, 16777619);
    h2 = Math.imul(h2 ^ (v + i), 2246822519);
  }
  return `${c.width}x${c.height}:${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

// iOS Safari won't draw canvases over about 16.7 million pixels; stay under that everywhere.
const MAX_CANVAS_PX = 16_000_000;
async function fileToShot(file) {
  const src = URL.createObjectURL(file);
  try {
    const img = await loadImage(src);
    const scale = Math.min(1, MAX_EDGE / img.width);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    // A very tall scrolling capture is split into several shots at full width, rather than
    // shrunk until the text is unreadable.
    const pieceH = Math.min(h, Math.floor(MAX_CANVAS_PX / w), 11000);
    const shots = [];
    for (let y = 0; y < h; y += pieceH - (y + pieceH < h ? 200 : 0)) {
      const ph = Math.min(pieceH, h - y);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = ph;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, ph);
      ctx.drawImage(img, 0, y / scale, img.width, ph / scale, 0, 0, w, ph);
      shots.push({ id: uid(), url: c.toDataURL("image/jpeg", 0.88), key: pixelKey(c) });
      c.width = c.height = 0;
      if (y + ph >= h) break;
    }
    return shots;
  } finally {
    URL.revokeObjectURL(src);
  }
}

// Screen recordings: step through the video on the phone and keep a frame whenever the
// screen has changed, so scrolling through a chat once becomes a set of screenshots.
// The video itself is never uploaded or saved.
const isVideo = (f) => f.type.startsWith("video/") || /\.(mov|mp4|m4v|webm)$/i.test(f.name);
async function videoToShots(file, room, onProgress) {
  const src = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = src;
  const waitFor = (event, ms) =>
    new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("timeout")), ms);
      v.addEventListener(event, () => { clearTimeout(t); res(); }, { once: true });
      v.addEventListener("error", () => { clearTimeout(t); rej(new Error("video")); }, { once: true });
    });
  const seek = async (t) => {
    const done = waitFor("seeked", 4000);
    v.currentTime = t;
    await done;
  };
  try {
    await waitFor("loadedmetadata", 15000);
    // iPhones don't load a video's frames until it has played; a muted play-and-pause does it.
    try {
      await v.play();
      v.pause();
    } catch {}
    if (v.readyState < 2) await waitFor("loadeddata", 15000);
    // Some recordings don't state their length up front; seeking far ahead makes the browser work it out.
    if (!Number.isFinite(v.duration)) {
      await seek(1e7).catch(() => {});
    }
    const duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    if (!duration || !v.videoWidth) throw new Error("empty");
    const scale = Math.min(1, MAX_EDGE / v.videoWidth, Math.sqrt(MAX_CANVAS_PX / (v.videoWidth * v.videoHeight)));
    const W = Math.round(v.videoWidth * scale);
    const H = Math.round(v.videoHeight * scale);
    // Pass 1: a small brightness profile of each moment, to see how far the chat has scrolled.
    const PW = 24;
    const PH = 192;
    const small = document.createElement("canvas");
    small.width = PW;
    small.height = PH;
    const sctx = small.getContext("2d", { willReadFrequently: true });
    const profileAt = async (t) => {
      await seek(t);
      sctx.drawImage(v, 0, 0, PW, PH);
      const d = sctx.getImageData(0, 0, PW, PH).data;
      const rows = new Float32Array(PH);
      for (let y = 0; y < PH; y++) {
        let sum = 0;
        for (let x = 0; x < PW; x++) {
          const i = (y * PW + x) * 4;
          sum += d[i] + d[i + 1] + d[i + 2];
        }
        rows[y] = sum / (PW * 3);
      }
      return rows;
    };
    // How many rows the content moved between two profiles (the best-matching shift), and how
    // well it matched there. Scrolling down moves content up, so b[y] ≈ a[y + shift].
    const motion = (a, b) => {
      let best = { shift: 0, err: Infinity };
      const top = 12; // ignore the status bar and header, which don't scroll
      for (let sh = -PH / 3; sh <= PH / 3; sh++) {
        let err = 0;
        let n = 0;
        for (let y = top; y < PH - 8; y++) {
          const ya = y + sh;
          if (ya < top || ya >= PH - 8) continue;
          err += Math.abs(a[ya] - b[y]);
          n++;
        }
        if (n > PH / 3 && err / n < best.err) best = { shift: sh, err: err / n };
      }
      return best;
    };
    const start = duration > 3 ? 0.8 : 0; // skip the start (Control Center closing)
    const step = Math.max(0.1, (duration - start) / 300);
    const times = [];
    for (let t = start; t < duration - 0.05; t += step) times.push(t);
    times.push(Math.max(start, duration - 0.05));
    // Scrolling is measured between neighboring samples (small, unambiguous steps) and added
    // up; a frame is kept once about half a screen has gone by since the last one, so every
    // message appears in at least two frames and the transcript can stitch them together.
    const keep = [];
    let prev = null;
    let moved = 0;
    for (let k = 0; k < times.length; k++) {
      const prof = await profileAt(times[k]);
      onProgress?.(k / times.length);
      if (!prev) {
        keep.push(times[k]);
        prev = prof;
        continue;
      }
      const m = motion(prev, prof);
      prev = prof;
      if (m.err > 18) {
        // Not a scroll: the screen changed (another chat, a new message). Keep it.
        keep.push(times[k]);
        moved = 0;
        continue;
      }
      moved += Math.abs(m.shift);
      if (moved >= PH * 0.45) {
        keep.push(times[k]);
        moved = 0;
      }
    }
    if (keep.at(-1) !== times.at(-1)) keep.push(times.at(-1)); // always the end of the chat
    // More frames than room: spread the picks across the whole recording, first and last included.
    let picked = keep;
    let cut = false;
    if (keep.length > room) {
      cut = true;
      picked = Array.from({ length: room }, (_, i) => keep[Math.round((i * (keep.length - 1)) / Math.max(1, room - 1))]);
      picked = [...new Set(picked)];
    }
    // Pass 2: the chosen frames at full size.
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const shots = [];
    for (const t of picked) {
      await seek(t);
      ctx.drawImage(v, 0, 0, W, H);
      shots.push({ id: uid(), url: c.toDataURL("image/jpeg", 0.88), key: pixelKey(c), fromVideo: true });
    }
    c.width = c.height = 0;
    shots.cut = cut;
    return shots;
  } finally {
    v.removeAttribute("src");
    v.load();
    URL.revokeObjectURL(src);
  }
}

let addGeneration = 0;
async function addFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith("image/") || isVideo(f) || /\.(heic|heif)$/i.test(f.name));
  if (!files.length) return fileList.length ? toast("Only photos and screen recordings can be imported.") : undefined;
  ensureChat();
  // Everything below belongs to the chat that was open when you picked. If you leave it or
  // start another before this finishes, the results are dropped rather than landing elsewhere.
  const target = chat;
  const gen = ++addGeneration;
  const stillHere = () => chat === target && gen === addGeneration;
  if (MAX_IMAGES - pending.length <= 0) return toast(`You can import up to ${MAX_IMAGES} screenshots at a time.`);
  let failedImages = 0;
  let failedVideos = 0;
  let dupes = 0;
  let frames = 0;
  let over = 0;
  let cut = false;
  const add = (shot) => {
    if (pending.some((p) => p.key === shot.key)) return dupes++, false;
    if (pending.length >= MAX_IMAGES) return over++, false;
    pending.push(shot);
    return true;
  };
  const images = files.filter((f) => !isVideo(f));
  const videos = files.filter(isVideo);
  // Photos first, so a recording can't crowd them out; then recordings share what's left.
  for (const f of images) {
    try {
      const shots = await fileToShot(f);
      if (!stillHere()) return;
      shots.forEach(add);
    } catch {
      failedImages++;
    }
  }
  for (let i = 0; i < videos.length; i++) {
    const room = Math.floor((MAX_IMAGES - pending.length) / (videos.length - i));
    if (room <= 0) {
      over++;
      continue;
    }
    try {
      toast("Pulling the messages out of your screen recording…");
      const shots = await videoToShots(videos[i], room, (p) => {
        if (stillHere()) $("toast").textContent = `Pulling the messages out of your screen recording… ${Math.round(p * 100)}%`;
      });
      if (!stillHere()) return;
      if (shots.cut) cut = true;
      for (const shot of shots) if (add(shot)) frames++;
    } catch {
      failedVideos++;
    }
  }
  if (!stillHere()) return;
  render();
  const notes = [];
  if (frames) notes.push(`${plural(frames, "frame")} from your recording${cut ? ", which was too long to cover every part" : ""}`);
  if (failedImages) notes.push(`${plural(failedImages, "photo")} couldn't be opened`);
  if (failedVideos) notes.push(`${failedVideos === 1 ? "a recording" : `${failedVideos} recordings`} couldn't be read`);
  if (dupes) notes.push(`skipped ${plural(dupes, "duplicate")}`);
  if (over) notes.push(`${over} didn't fit (limit ${MAX_IMAGES})`);
  if (!pending.length) return toast(failedVideos && !failedImages ? "That screen recording couldn't be read. Try screenshots instead." : "We couldn't open those images. Try PNG or JPEG.");
  toast(`${plural(pending.length, "screenshot")} ready${notes.length ? ` (${notes.join("; ")})` : ""}. ${sampler ? "Tap send." : "Open Arguably on claude.ai while signed in to get a verdict."}`);
}

// Where to cut a tall screenshot: blank rows between bubbles, close to evenly spaced.
function findCuts(img, parts) {
  const W = 96;
  const H = Math.max(1, Math.round((img.height * W) / img.width));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const spread = [];
  for (let y = 0; y < H; y++) {
    let min = 255;
    let max = 0;
    for (let x = 6; x < W - 6; x++) {
      const i = (y * W + x) * 4;
      const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
      if (l < min) min = l;
      if (l > max) max = l;
    }
    spread.push(max - min);
  }
  const cuts = [];
  const step = H / parts;
  for (let k = 1; k < parts; k++) {
    const target = k * step;
    const win = step * 0.18;
    let best = null;
    for (let y = Math.max(2, Math.floor(target - win)); y <= Math.min(H - 3, Math.ceil(target + win)); y++) {
      const blank = spread[y - 1] < 10 && spread[y] < 10 && spread[y + 1] < 10;
      if (blank && (best === null || Math.abs(y - target) < Math.abs(best - target))) best = y;
    }
    cuts.push({ y: Math.round(((best ?? target) * img.height) / H), clean: best !== null });
  }
  return cuts;
}

// Claude sees each image at about 1.2 megapixels, so tall screenshots are cut into
// readable slices: in the blank space between bubbles where possible.
async function sliceShots(shots) {
  const slices = [];
  for (const s of shots) {
    const im = await loadImage(s.url);
    const parts = Math.max(1, Math.min(6, Math.ceil(im.height / (im.width * 2.4))));
    const cuts = parts > 1 ? findCuts(im, parts) : [];
    const bounds = [0, ...cuts.map((c) => c.y), im.height];
    for (let p = 0; p < parts; p++) {
      const overlapTop = p > 0 && !cuts[p - 1].clean ? Math.round(im.width * 0.06) : 0;
      const overlapBottom = p < parts - 1 && !cuts[p].clean ? Math.round(im.width * 0.06) : 0;
      const y0 = Math.max(0, bounds[p] - overlapTop);
      const y1 = Math.min(im.height, bounds[p + 1] + overlapBottom);
      const c = document.createElement("canvas");
      c.width = im.width;
      c.height = y1 - y0;
      c.getContext("2d").drawImage(im, 0, y0, im.width, c.height, 0, 0, im.width, c.height);
      slices.push({ n: s.n, part: p + 1, parts, overlapTop: overlapTop > 0, blob: await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9)) });
    }
  }
  return slices;
}

// ---------- Claude: reading, judging, chatting ----------
function batchSlices(slices, size) {
  // Keep a screenshot's slices together when that doesn't overflow a batch.
  const batches = [];
  let cur = [];
  for (let i = 0; i < slices.length; ) {
    const shot = slices.filter((s) => s.n === slices[i].n);
    if (cur.length && cur.length + shot.length > size) {
      batches.push(cur);
      cur = [];
    }
    for (const s of shot) {
      if (cur.length === size) {
        batches.push(cur);
        cur = [];
      }
      cur.push(s);
    }
    i += shot.length;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

// ---------- on-device reading (OCR) ----------
let ocr = null; // { worker, ready: Promise, waiting: Map }
const SIMD_TEST = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

function ocrStart() {
  if (ocr) return ocr.ready;
  const simd = typeof WebAssembly === "object" && WebAssembly.validate(SIMD_TEST);
  const abs = (p) => new URL(p, location.href).href;
  const worker = new Worker(abs("ocr/ocr-worker.js"));
  const waiting = new Map();
  const state = { worker, waiting, ready: null };
  ocr = state;
  state.ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("OCR start timed out")), 90000);
    worker.onmessage = ({ data }) => {
      if (data.type === "ready") {
        clearTimeout(timer);
        resolve();
      } else if (data.type === "result" && waiting.has(data.id)) {
        waiting.get(data.id).resolve(data.tsv);
        waiting.delete(data.id);
      } else if (data.type === "error") {
        if (data.id != null && waiting.has(data.id)) {
          waiting.get(data.id).reject(new Error(data.message));
          waiting.delete(data.id);
        } else {
          clearTimeout(timer);
          reject(new Error(data.message));
        }
      }
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      reject(new Error(e.message || "OCR worker failed"));
    };
    worker.postMessage({
      type: "init",
      coreUrl: abs(simd ? "ocr/tesseract-core-simd-lstm.wasm.js" : "ocr/tesseract-core-lstm.wasm.js"),
      langUrl: abs("ocr/eng-traineddata.js"),
    });
  });
  state.ready.catch(() => {
    state.worker.terminate();
    if (ocr === state) ocr = null;
  });
  return state.ready;
}

// Prepare a screenshot for text recognition: dark text on a light background everywhere.
// Dark mode: all text is white, so "how white is this pixel" (the smallest channel) is inverted,
// which keeps white text on blue bubbles. Light mode: grayscale, with colored bubbles flattened.
async function ocrImage(url) {
  const img = await loadImage(url);
  let scale = img.width < 1200 ? Math.min(2, 1200 / img.width) : 1; // small text reads better enlarged
  scale = Math.min(scale, Math.sqrt(MAX_CANVAS_PX / (img.width * img.height)));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 16) sum += px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11;
  const dark = sum / (px.length / 16) < 110;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const l = dark ? 255 - Math.min(r, g, b) : Math.max(r, g, b) - Math.min(r, g, b) > 60 ? 150 : r * 0.3 + g * 0.59 + b * 0.11;
    px[i] = px[i + 1] = px[i + 2] = l;
  }
  ctx.putImageData(d, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  return { png: await blob.arrayBuffer(), width: c.width, height: c.height };
}

// One reading on the phone. Gives up after a minute or when stopped, and restarts the reader
// if it stopped answering, so a stuck reader can never lock the app.
async function ocrRecognize(url, signal) {
  await ocrStart();
  const { png, width, height } = await ocrImage(url);
  const id = uid();
  const state = ocr;
  const tsv = await new Promise((resolve, reject) => {
    const finish = (fn, v) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      state.waiting.delete(id);
      fn(v);
    };
    const onAbort = () => finish(reject, { code: "cancelled" });
    const timer = setTimeout(() => {
      finish(reject, new Error("OCR timed out"));
      // A reader that stops answering is replaced on the next use.
      state.worker.terminate();
      state.waiting.forEach((w) => w.reject(new Error("OCR reset")));
      if (ocr === state) ocr = null;
    }, 60000);
    signal?.addEventListener("abort", onAbort, { once: true });
    state.waiting.set(id, { resolve: (v) => finish(resolve, v), reject: (e) => finish(reject, e) });
    state.worker.postMessage({ type: "ocr", id, png }, [png]);
  });
  return parseTsv(tsv, width, height);
}

// A tall screenshot, cut into phone-shaped pieces (with a little overlap) for the phone's reader,
// whose layout rules assume one screen's worth of chat.
async function phonePieces(url) {
  const img = await loadImage(url);
  const pieceH = Math.round(img.width * 2.2);
  if (img.height <= pieceH * 1.15) return [url];
  const out = [];
  const overlap = Math.round(pieceH * 0.12);
  for (let y = 0; y < img.height; y += pieceH - overlap) {
    const h = Math.min(pieceH, img.height - y);
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = h;
    c.getContext("2d").drawImage(img, 0, y, img.width, h, 0, 0, img.width, h);
    out.push(c.toDataURL("image/png"));
    c.width = c.height = 0;
    if (y + h >= img.height) break;
  }
  return out;
}

async function readWithOcr(shots, thinking, signal) {
  updateThinking(thinking, "Getting the reader ready on this phone", 0.02);
  try {
    await ocrStart();
  } catch {
    throw { code: "ocr_unavailable" };
  }
  // Each screenshot is read and sorted into messages right here (linesToMessages). Only the ones
  // that read poorly go to Claude, as text lines, for a quick second look.
  const readings = [];
  const waiting = []; // poorly read screenshots not yet sent: { n, text }
  const looks = []; // second looks in flight
  let poorCount = 0;
  let lineCount = 0;
  const count = () => readings.reduce((a, r) => a + r.msgs.filter((m) => m.side !== "center").length, 0);
  updateThinking(thinking, shots.length > 1 ? `Reading ${shots.length} screenshots on this phone` : "Reading the screenshot on this phone", 0.05);
  for (let i = 0; i < shots.length; i++) {
    if (signal.aborted) throw { code: "cancelled" };
    const n = shots[i].n;
    const pieces = await phonePieces(shots[i].url);
    let lines = [];
    const pieceMsgs = [];
    for (let k = 0; k < pieces.length; k++) {
      const got = await ocrRecognize(pieces[k], signal).catch((err) => {
        if (err?.code === "cancelled") throw err;
        return [];
      });
      if (signal.aborted) throw { code: "cancelled" };
      if (k === 0) lines = got;
      pieceMsgs.push(...linesToMessages(got).map((m) => ({ ...m, part: k + 1, overlapTop: k > 0 })));
    }
    lineCount += lines.length || pieceMsgs.length;
    const msgs = pieces.length > 1 ? joinSlices(pieceMsgs) : pieceMsgs;
    readings.push({ n, header: headerOf(lines), app: "", isGroup: msgs.some((m) => m.side === "left" && m.sender_label), msgs });
    if (readingQuality(lines, msgs).poor) {
      poorCount++;
      waiting.push({ n, text: ocrBlock(n, lines) });
      // The first poor screenshot goes to Claude straight away while the rest are read;
      // any found after that go together once reading is done.
      if (!looks.length) looks.push(closerLook(waiting.splice(0), signal));
    }
    updateThinking(thinking, `Read ${plural(count(), "message")} from ${shots.length > 1 ? `${i + 1} of ${shots.length} screenshots` : "the screenshot"}`, 0.05 + ((i + 1) / shots.length) * 0.85);
  }
  if (!lineCount) throw { code: "no_messages" };
  if (waiting.length) looks.push(closerLook(waiting, signal));
  if (looks.length) {
    updateThinking(thinking, `Taking a closer look at ${plural(poorCount, "screenshot")}`, 0.92);
    for (const found of await Promise.all(looks)) {
      // Claude's reading replaces the phone's for the screenshots it answered; the rest keep theirs.
      for (const [n, r] of found) {
        const reading = readings.find((x) => x.n === n);
        if (!reading) continue;
        if (r.header) reading.header = r.header;
        reading.msgs = r.msgs;
        reading.isGroup = r.msgs.some((m) => m.side === "left" && m.sender_label);
      }
    }
    if (signal.aborted) throw { code: "cancelled" };
  }
  return readings;
}

// One quick, text-only request for the screenshots that read poorly. Resolves to a Map of
// screenshot number -> { header, msgs }, or an empty Map when it fails (the phone's reading is kept).
function closerLook(blocks, signal) {
  const sent = [];
  let size = 0;
  for (const b of blocks) {
    if (size + b.text.length > 40000) break; // stay well under the request limit
    sent.push(b);
    size += b.text.length;
  }
  if (!sent.length) return Promise.resolve(new Map());
  const ns = new Set(sent.map((b) => b.n));
  const prompt = `${OCR_RULES}\n\n${sent.map((b) => b.text).join("\n\n")}`;
  const look = sampler([{ role: "user", content: prompt }], { modelTier: "quick", signal })
    .then(({ text }) => new Map([...parseOcrReply(text)].filter(([n]) => ns.has(n))))
    .catch((err) => {
      if (err?.code === "cancelled" || signal.aborted) throw { code: "cancelled" };
      return new Map();
    });
  look.catch(() => {}); // awaited later; don't report a cancel as unhandled while reading continues
  return look;
}

// Claude reads the screenshots itself when this view can send images; otherwise the phone does.
function readScreenshots(shots, thinking, signal) {
  return maxImages && !prefs.readOnPhone ? readWithVision(shots, thinking, signal) : readWithOcr(shots, thinking, signal);
}

async function readWithVision(shots, thinking, signal) {
  const slices = await sliceShots(shots);
  const batches = batchSlices(slices, Math.max(1, maxImages));
  const bySlice = [];
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    updateThinking(thinking, batches.length > 1 ? `Reading screenshots · part ${b + 1} of ${batches.length}` : "Reading every message", b / (batches.length + 1));
    const labels = batch.map((s, i) => `Image ${i + 1}: screenshot ${s.n}${s.parts > 1 ? `, slice ${s.part} of ${s.parts} (top to bottom)` : ""}`);
    const out = await sampler.json(`${TRANSCRIBE_RULES}\n\nImages in this batch:\n${labels.join("\n")}`, {
      images: batch.map((s) => s.blob),
      modelTier: "default",
      signal,
    });
    if (!out || !Array.isArray(out.messages)) throw { code: "invalid_json" };
    batch.forEach((s, i) => {
      const info = (out.images || []).find((x) => Number(x.image) === i + 1) || {};
      // A one-image batch owns every message, whatever number the reply gave it.
      let lastLabel = "";
      const msgs = out.messages
        .filter((m) => m && (batch.length === 1 || Number(m.image) === i + 1))
        .map((m) => {
          // Group chats name only the first bubble of a run; the rest belong to the same sender.
          let label = String(m.sender_label || "").trim();
          if (m.side === "left") {
            if (label) lastLabel = label;
            else label = lastLabel;
          } else lastLabel = "";
          return { ...m, sender_label: label, part: s.part, overlapTop: s.overlapTop, text: String(m.text ?? "") };
        });
      // (The reply lists messages top to bottom; its rough y values aren't precise enough to re-sort.)
      bySlice.push({ n: s.n, part: s.part, header: String(info.header_name || "").trim(), app: info.app || "", msgs });
    });
  }
  // One reading per screenshot: header from its top slice, slices joined without repeats.
  return shots.map((s) => {
    const parts = bySlice.filter((x) => x.n === s.n).sort((a, b) => a.part - b.part);
    const msgs = joinSlices(parts.flatMap((p) => p.msgs));
    return {
      n: s.n,
      header: parts.find((p) => p.header)?.header || "",
      app: parts[0]?.app || "",
      isGroup: msgs.some((m) => m.side === "left" && String(m.sender_label || "").trim()),
      msgs,
    };
  });
}

// Start a job for chat c. Returns its abort signal.
function startJob(c) {
  busy = { ctl: new AbortController(), chatId: c.id };
  live.set(c.id, c);
  saveChats(c);
  return busy.ctl.signal;
}
function endJob(c) {
  if (busy?.chatId === c.id) busy = null;
  live.delete(c.id);
  saveChats(c);
  if (chat?.id === c.id || (!chat && !page) || page === "inbox") render();
  else renderHeader();
}

async function runImport(c, shots, note) {
  const thinking = { id: uid(), role: "assistant", kind: "thinking", text: "Preparing screenshots", progress: 0, transient: true };
  c.messages.push(thinking);
  const signal = startJob(c);
  render();
  try {
    const numbered = shots.map((s, i) => ({ ...s, n: c.shotTotal + i + 1 }));
    const readings = await readScreenshots(numbered, thinking, signal);
    const messageCount = readings.reduce((a, r) => a + r.msgs.filter((m) => m.side !== "center").length, 0);
    if (!messageCount) throw { code: "no_messages" };
    c.shotTotal += shots.length;
    c.readings.push(...readings);
    const groups = defaultMapping(phoneGroups(readings), c.groups);
    // Your name from Settings stands in for "Me" on your own phone's screenshots.
    if (prefs.name) groups.forEach((g) => { if (g.me === "Me") g.me = prefs.name; });
    const names = groups.flatMap((g) => [g.me, g.them]);
    const you = c.you || (prefs.name && names.includes(prefs.name) ? prefs.name : "");
    c.messages = c.messages.filter((m) => m !== thinking);
    c.messages.push({
      id: uid(), role: "assistant", kind: "who", status: "pending", groups, note, readingNs: readings.map((r) => r.n),
      you, shotCount: shots.length, messageCount,
    });
    notify("who", "Screenshots read. Check who's who", `${plural(messageCount, "message")} from ${plural(shots.length, "screenshot")}.`, c.id);
  } catch (err) {
    c.messages = c.messages.filter((m) => m !== thinking);
    // Put the screenshots and note back so trying again is one tap.
    const sent = c.messages.findLast((m) => m.role === "user" && m.shotCount === shots.length);
    if (sent) c.messages = c.messages.filter((m) => m !== sent);
    if (chat === c) {
      pending = [...shots, ...pending].slice(0, MAX_IMAGES);
      if (note && !$("messageInput").value) $("messageInput").value = note;
    }
    if (err?.code !== "cancelled") c.messages.push({ id: uid(), role: "assistant", kind: "error", text: errorCopy(err?.code), transient: true });
  } finally {
    endJob(c);
  }
}

function confirmWho(id) {
  if (busy) return toast("Arguably is finishing another argument. Try again in a moment.");
  const c = chat;
  const m = c.messages.find((x) => x.id === id);
  if (!m || m.status !== "pending") return;
  const named = m.groups.map((g, i) => {
    const pick = (side, fallback) => document.getElementById(`who-${m.id}-${i}-${side}`)?.value.trim() || g[side] || fallback;
    return { me: pick("me", "Me"), them: pick("them", "Them") };
  });
  if (named.some((g) => g.me.toLowerCase() === g.them.toLowerCase())) return toast("Each side needs a different name.");
  m.groups.forEach((g, i) => Object.assign(g, named[i]));
  m.status = "done";
  c.you = m.you === "__none" ? "" : m.you;
  m.you = c.you;
  // Remember names per phone for the next import in this chat.
  c.groups = [...m.groups, ...c.groups.filter((g) => !m.groups.some((x) => x.key === g.key))];
  const readings = c.readings.filter((r) => m.readingNs.includes(r.n));
  c.transcript = buildTranscript(readings, m.groups, c.transcript);
  startVerdict(c, m.note);
}

// Every verdict starts here. A verdict that can't run yet (stopped, failed, or waiting on Pro)
// leaves a "resume" card in the chat, which is saved, so it survives leaving and reloading.
const monthKey = () => {
  const d = new Date(); // the 1st in the person's own time zone, not UTC
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
function verdictBlock() {
  if (!STORE_BUILD) return "";
  if (!prefs.pro) return prefs.freeUsed >= FREE_VERDICTS ? "locked" : "";
  const u = prefs.proUsage.month === monthKey() ? prefs.proUsage.n : 0;
  return u >= PRO_FAIR_USE ? "fair" : "";
}
const freeLeft = () => Math.max(0, FREE_VERDICTS - prefs.freeUsed);
let paywallFor = null; // {c, note} waiting on a purchase
// Nothing goes to the AI without the current policy agreement and AI consent, however it
// was started (send, Try again, Looks right). Returns true when it's allowed.
function allowedToSend(retry) {
  if (!policyOk()) {
    page = "onboarding";
    onboardStep = 1;
    onboardDir = 1;
    gateMode = prefs.onboarded;
    render();
    nudgeAgree();
    return false;
  }
  if (!prefs.aiConsent) {
    consentReturn = retry;
    openPage("ai");
    return false;
  }
  return true;
}

// Same conversation, same verdict: a verdict is saved with a fingerprint of everything that
// shaped it, and a later match reuses it instead of asking the AI again.
function hash(text) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}
const JUDGE_VERSION = hash(SYSTEM_PROMPT + JSON.stringify(VERDICT_SCHEMA));
function fingerprint(c, note) {
  const convo = conversationText(c).replace(/\s+/g, " ").trim();
  return hash([JUDGE_VERSION, AI_NAME, prefs.tone || "straight", note.trim(), convo].join("\u0000"));
}
function judgedBefore(fp) {
  for (const chat of chats) for (const m of chat.messages) if (m.kind === "verdict" && m.fp === fp && m.verdict) return m.verdict;
  return null;
}
function reuseVerdict(c, note) {
  const fp = fingerprint(c, note);
  const earlier = judgedBefore(fp);
  if (!earlier) return false;
  const verdict = JSON.parse(JSON.stringify(earlier));
  c.messages.push({
    id: uid(), role: "assistant", kind: "verdict", verdict, fp, repeat: true,
    unverified: unverifiedQuotes(verdict, c.transcript, c.raw),
    transcript: c.transcript.length ? c.transcript.map((t) => ({ ...t })) : undefined,
    source: c.transcript.length ? (c.raw ? "both" : "screens") : "paste",
  });
  c.title = verdict.title || c.title;
  saveChats(c);
  render();
  return true;
}

function startVerdict(c, note = "") {
  if (busy && busy.chatId !== c.id) {
    c.messages = c.messages.filter((m) => m.kind !== "resume");
    c.messages.push({ id: uid(), role: "assistant", kind: "resume", reason: "stopped", note });
    saveChats(c);
    render();
    return toast("Arguably is finishing another argument. Try again in a moment.");
  }
  if (!allowedToSend({ chat: c, verdictNote: note })) {
    c.messages = c.messages.filter((m) => m.kind !== "resume");
    c.messages.push({ id: uid(), role: "assistant", kind: "resume", reason: "consent", note });
    saveChats(c);
    return;
  }
  c.messages = c.messages.filter((m) => m.kind !== "resume");
  // A conversation judged before gets the same verdict back, free and instantly.
  if (reuseVerdict(c, note)) return;
  const block = verdictBlock();
  if (block) {
    c.messages.push({ id: uid(), role: "assistant", kind: "resume", reason: block, note });
    saveChats(c);
    if (block === "locked") {
      paywallFor = { c, note };
      return openPage("paywall");
    }
    return render();
  }
  return runVerdict(c, note);
}
function countVerdict() {
  if (!STORE_BUILD) return;
  if (prefs.pro) {
    const m = monthKey();
    prefs.proUsage = { month: m, n: (prefs.proUsage.month === m ? prefs.proUsage.n : 0) + 1 };
  } else prefs.freeUsed += 1;
  savePrefs();
}

function resumeHTML(m) {
  // A card saved as "locked" or "fair" becomes runnable once Pro is bought or the month resets.
  const reason = (m.reason === "locked" || m.reason === "fair") && !verdictBlock() ? "ready" : m.reason;
  const copy = {
    ready: ["Your verdict is ready to run", "Your screenshots are already read."],
    stopped: ["Verdict stopped", "Pick up where you left off. Your screenshots are already read."],
    consent: ["Your verdict is waiting", `Allow sending chats to ${AI_NAME} to get it. Your screenshots are already read.`],
    failed: ["The verdict didn't come through", m.error || "Something went wrong on the way. Your screenshots are already read."],
    locked: ["Your verdict is one tap away", `Start your ${PLANS.yearly.trialDays}-day free trial to see who's right.`],
    fair: ["You've hit this month's fair-use limit", `Pro includes ${PRO_FAIR_USE} verdicts a month. It resets on the 1st.`],
  }[reason] || ["Verdict didn't finish", ""];
  const button = reason === "fair" ? "" : reason === "locked"
    ? `<button class="cta" type="button" data-action="paywall" data-resume="${m.id}">See Pro</button>`
    : `<button class="cta" type="button" data-resume="${m.id}">${reason === "ready" ? "Get the verdict" : "Try again"}</button>`;
  return `<div class="msg resume ${reason}" role="status"><div class="resume-text"><strong>${esc(copy[0])}</strong><span>${esc(copy[1])}</span></div>${button}</div>`;
}

const TONES = {
  straight: "Tone: straight talk. Be plain and direct about who argued better, without cushioning, and never cruel.",
  gentle: "Tone: gentle. Lead with what each person got right, soften how criticism is worded, and make the takeaway especially kind.",
};

// Fit text into a byte budget (not characters: non-Latin text is 2-3 bytes a character),
// keeping the opening (where arguments start) and the latest part.
const byteLen = (s) => new TextEncoder().encode(s).length;
function fitBytes(text, budget) {
  if (byteLen(text) <= budget) return text;
  const gap = "\n[...middle of the conversation omitted...]\n";
  let head = Math.floor(text.length * 0.25);
  let tail = Math.floor(text.length * 0.5);
  while (head + tail > 0 && byteLen(text.slice(0, head) + gap + text.slice(-tail)) > budget) {
    head = Math.floor(head * 0.9);
    tail = Math.floor(tail * 0.9);
  }
  return text.slice(0, head) + gap + text.slice(-tail);
}
// The whole conversation this chat holds: screenshots and pasted text together.
function conversationText(chat) {
  const screens = chat.transcript.length ? transcriptText(chat.transcript) : "";
  if (screens && chat.raw) return `${screens}\n\n(Also pasted as text:)\n${chat.raw}`;
  return screens || chat.raw || "";
}

function verdictPrompt(chat, note) {
  const earlier = verdictsOf(chat).at(-1);
  const convo = conversationText(chat);
  let before = SYSTEM_PROMPT;
  before += chat.transcript.length
    ? "\n\nThe screenshots have already been read for you. Below is the full transcript, with both phones merged and speakers confirmed by the person who uploaded them. Work only from this transcript and quote messages exactly as written in it."
    : "\n\nThe conversation was pasted as text instead of screenshots. Quote messages exactly as written in it.";
  // Who uploaded it stays out of the verdict prompt so it can't tilt the result.
  let after = "\n\nWrite about everyone in the third person, and address the takeaway to both sides.";
  if (earlier) after += `\n\nYou gave an earlier verdict in this chat ("${earlier.title}"). New screenshots were added since; judge the whole conversation as it stands now.`;
  if (note) after += `\n\nNote from the person who uploaded this (background, not evidence):\n${note.slice(0, 2000)}`;
  after += `\n\n${TONES[prefs.tone] || TONES.straight}`;
  after += `\n\nReply with only one JSON object that matches this JSON Schema exactly (every key present, no extra keys):\n${JSON.stringify(VERDICT_SCHEMA)}`;
  // The conversation gets whatever room the rest of the prompt leaves, measured exactly.
  const room = maxPromptBytes - byteLen(before + after) - 300;
  return `${before}\n\n<conversation>\n${fitBytes(convo, Math.max(2000, room))}\n</conversation>${after}`;
}

async function runVerdict(c, note) {
  const thinking = { id: uid(), role: "assistant", kind: "thinking", text: VERDICT_STEPS[0], transient: true };
  c.messages.push(thinking);
  const signal = startJob(c);
  render();
  let step = 0;
  const timer = setInterval(() => {
    step = Math.min(step + 1, VERDICT_STEPS.length - 1);
    updateThinking(thinking, VERDICT_STEPS[step]);
  }, 7000);
  const fp = fingerprint(c, note);
  try {
    const verdict = normalizeVerdict(await sampler.json(verdictPrompt(c, note), { modelTier: "complex", signal }));
    if (!verdict) throw { code: "invalid_json" };
    c.messages = c.messages.filter((m) => m !== thinking);
    c.messages.push({
      id: uid(), role: "assistant", kind: "verdict", verdict, fp,
      unverified: unverifiedQuotes(verdict, c.transcript, c.raw),
      transcript: c.transcript.length ? c.transcript.map((t) => ({ ...t })) : undefined,
      source: c.transcript.length ? (c.raw ? "both" : "screens") : "paste",
    });
    c.title = verdict.title || c.title;
    countVerdict();
    const win = winnerOf(verdict);
    notify("verdict", `Verdict ready: ${c.title}`, verdict.safety_note?.trim() ? "There's a note on safety." : `${win.name} wins${win.margin ? ` ${byPoints(win.margin)}` : ""}.`, c.id);
  } catch (err) {
    c.messages = c.messages.filter((m) => m !== thinking);
    const stopped = err?.code === "cancelled";
    c.messages.push({ id: uid(), role: "assistant", kind: "resume", reason: stopped ? "stopped" : "failed", note, error: stopped ? "" : errorCopy(err?.code) });
  } finally {
    clearInterval(timer);
    endJob(c);
  }
}

function chatTurns(chat) {
  const verdicts = verdictsOf(chat).slice(-2);
  const convo = fitBytes(conversationText(chat), Math.min(30000, maxPromptBytes / 2));
  const context =
    CHAT_RULES +
    `\n\n${TONES[prefs.tone] || TONES.straight}` +
    (chat.you ? `\n\nThe person you're talking with is ${chat.you}.` : "\n\nThe person you're talking with isn't part of this conversation (or didn't say which one they are). Refer to everyone by name.") +
    (convo ? `\n\n<conversation>\n${convo}\n</conversation>` : "") +
    (verdicts.length ? "\n\n" + verdicts.map((v, i) => `Verdict ${i + 1} (JSON):\n${JSON.stringify(v)}`).join("\n\n") : "\n\nNo verdict has been given yet.");
  const turns = [];
  for (const m of chat.messages) {
    if (m.transient || m.kind === "error" || m.kind === "thinking" || m.kind === "who" || m.kind === "nudge" || m.kind === "resume") continue;
    if (m.role === "user") {
      const n = m.shotCount || m.shots?.length;
      const content = ((n ? `(imported ${plural(n, "screenshot")}) ` : "") + (m.text || "")).trim();
      if (content) turns.push({ role: "user", content: content.slice(0, 4000) });
    } else if (m.kind === "verdict") {
      const w = m.verdict.winner || {};
      const win = winnerOf(m.verdict);
      turns.push({ role: "assistant", content: m.verdict.safety_note?.trim()
        ? `I didn't score "${m.verdict.title}". I gave a note on safety instead, because the messages showed threats, control or abuse. Full details are in the verdict JSON above.`
        : `I gave my verdict "${m.verdict.title}": ${win.name} made the stronger case${win.margin ? `, winning ${byPoints(win.margin)}` : ""} (${w.confidence}% confidence). Full details are in the verdict JSON above.` });
    } else if (m.text) {
      turns.push({ role: "assistant", content: m.text });
    }
  }
  // Stay under the 64 KiB limit: drop the oldest turns, never the context.
  let recent = turns.slice(-24);
  const size = () => new TextEncoder().encode(context + JSON.stringify(recent)).length;
  while (recent.length > 1 && size() > 60000) recent = recent.slice(1);
  while (recent.length && recent[0].role !== "user") recent = recent.slice(1);
  // Turns must alternate: fold back-to-back turns from the same side into one.
  const out = [];
  for (const t of [{ role: "user", content: context }, ...recent]) {
    if (out.length && out.at(-1).role === t.role) out.at(-1).content += "\n\n" + t.content;
    else out.push({ ...t });
  }
  return out;
}

async function runChat(c) {
  const reply = { id: uid(), role: "assistant", kind: "thinking", text: "Thinking", transient: true };
  c.messages.push(reply);
  const signal = startJob(c);
  render();
  let streamed = "";
  try {
    const { text, truncated } = await sampler(chatTurns(c), {
      cache: false,
      signal,
      onText: ({ text }) => {
        streamed = text;
        Object.assign(reply, { kind: "text", text, transient: true }); // a re-render keeps the text so far
        const el = document.getElementById(reply.id);
        if (!el) return;
        // Follow the reply only if you're already at the bottom; reading back up isn't interrupted.
        const following = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120;
        el.outerHTML = `<div class="msg reply" id="${reply.id}">${formatReply(text)}</div>`;
        if (following) window.scrollTo({ top: document.documentElement.scrollHeight });
      },
    });
    Object.assign(reply, { kind: "text", text, transient: false, interrupted: truncated });
  } catch (err) {
    const kept = err?.text || (err?.code === "cancelled" ? streamed : "");
    if (kept) Object.assign(reply, { kind: "text", text: kept, transient: false, interrupted: true });
    else c.messages = c.messages.filter((m) => m !== reply);
    if (err?.code !== "cancelled") c.messages.push({ id: uid(), role: "assistant", kind: "error", text: errorCopy(err?.code), transient: true });
  } finally {
    endJob(c);
  }
}

async function runPasted(c, text) {
  if (!c.raw.endsWith(text)) c.raw = (c.raw ? c.raw + "\n" : "") + text;
  return startVerdict(c, "");
}

// A pasted conversation has at least two "Name: message" lines. A long question doesn't.
const speakerLines = (text) => (String(text).match(/^[^:\n]{1,30}:\s*\S/gm) || []).length;
async function send(textOverride) {
  if (busy && !busyHere()) return toast("Arguably is finishing another argument. You'll get a notification when it's done.");
  if (busy || !sampler || pendingWho()) return;
  if (!allowedToSend({ chat, text: textOverride })) return;
  const input = $("messageInput");
  const text = (textOverride ?? input.value).trim();
  const shots = pending.slice();
  if (!text && !shots.length) return;
  const isPaste = !shots.length && speakerLines(text) >= 2 && !verdictsOf(chat).length;
  // App Store build: reading screenshots and follow-up questions use the AI too, so they're
  // Pro like verdicts. (A pasted conversation goes on to the verdict, which has its own gate.)
  if (STORE_BUILD && !isPaste && (!prefs.pro || verdictBlock() === "fair")) {
    if (prefs.pro) return toast(`You've used this month's ${PRO_FAIR_USE} Pro verdicts. It resets on the 1st.`);
    paywallFor = null;
    return openPage("paywall"); // the screenshots and the typed text stay where they are
  }
  if (chat?.example && !shots.length) {
    const ex = chat;
    chat = { ...newChatObject(), title: ex.title, transcript: ex.transcript.slice(), you: "", messages: ex.messages.filter((m) => m.kind !== "nudge") };
  }
  ensureChat();
  chat.messages = chat.messages.filter((m) => m.kind !== "error");
  chat.messages.push({ id: uid(), role: "user", text, shots: shots.map((s) => s.url), shotCount: shots.length });
  pending = [];
  input.value = "";
  autosize();
  $("toast").hidden = true;
  const c = chat;
  if (shots.length) return runImport(c, shots, text);
  if (isPaste) return runPasted(c, text);
  return runChat(c);
}

function openExample() {
  page = null;
  chat = {
    ...newChatObject(),
    id: "example",
    example: true,
    title: SAMPLE_VERDICT.title,
    transcript: SAMPLE_TRANSCRIPT,
    you: "Maya",
    messages: [
      { id: uid(), role: "user", text: "Who's right here? We've been dating a year.", shotCount: 2 },
      { id: uid(), role: "assistant", kind: "who", status: "done", groups: [{ me: "Maya", them: "Jordan" }], you: "Maya" },
      { id: uid(), role: "assistant", kind: "verdict", verdict: SAMPLE_VERDICT, unverified: [], transcript: SAMPLE_TRANSCRIPT },
      { id: uid(), role: "assistant", kind: "nudge" },
    ],
  };
  render();
}

// ---------- Pro (App Store build) ----------
let paywallPlan = "yearly";
const nextYearDate = (days) => new Date(Date.now() + days * 864e5).toLocaleDateString(undefined, { month: "long", day: "numeric" });
function paywallHTML() {
  const y = PLANS.yearly, mo = PLANS.monthly;
  const plan = PLANS[paywallPlan];
  const save = Math.round((1 - parseFloat(y.price.slice(1)) / (parseFloat(mo.price.slice(1)) * 12)) * 100);
  const trial = paywallPlan === "yearly" && y.trialDays;
  const radio = (key, title, price, sub, badge = "") => `<button type="button" role="radio" aria-checked="${paywallPlan === key}" class="plan${paywallPlan === key ? " on" : ""}" data-plan="${key}">
      <span class="plan-dot" aria-hidden="true"></span>
      <span class="plan-main"><span class="plan-title">${title}${badge ? `<b>${badge}</b>` : ""}</span><span class="plan-sub">${sub}</span></span>
      <span class="plan-price">${price}</span></button>`;
  return `<section class="paywall" aria-labelledby="pwTitle">
    <button class="pw-close" type="button" data-action="paywall-close" aria-label="Close">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    <div class="pw-icon"><img src="${MARK_URI}" alt="" width="64" height="59"></div>
    <span class="pw-eyebrow">Arguably Pro</span>
    <h1 id="pwTitle">Unlimited verdicts.<br><em>Settle every one.</em></h1>
    ${paywallFor ? `<p class="pw-waiting">${svg(ICON.check, 16)}Your screenshots are read. The verdict runs the moment you unlock.</p>` : ""}
    <ul class="pw-benefits">
      <li>${pageSvg(PAGE_ICON.scale, 22)}<span><strong>Every argument, judged</strong>Up to ${PRO_FAIR_USE} verdicts a month.</span></li>
      <li>${pageSvg(SET_ICON.replay, 22)}<span><strong>Rematches</strong>Add new screenshots anytime and get a fresh verdict.</span></li>
      <li>${pageSvg(PAGE_ICON.spark, 22)}<span><strong>New features first</strong>Everything we ship next is included.</span></li>
    </ul>
    <div class="plans" role="radiogroup" aria-label="Choose a plan">
      ${radio("yearly", "Yearly", `${y.price}<small>/yr</small>`, `${y.trialDays}-day free trial`, `Save ${save}%`)}
      ${radio("monthly", "Monthly", `${mo.price}<small>/mo</small>`, "Cancel anytime")}
    </div>
    <button class="cta pw-cta" type="button" data-action="purchase">${trial ? `Start ${y.trialDays}-day free trial` : `Subscribe for ${plan.price}/${plan.per}`}</button>
    <p class="pw-terms">${
      trial
        ? `Free until ${nextYearDate(y.trialDays)}, then ${y.price} per year.`
        : `${plan.price} per ${plan.per}.`
    } Renews automatically unless canceled at least 24 hours before the end of the period. Manage or cancel anytime in your App Store account settings.</p>
    <div class="pw-links">
      <button type="button" data-action="restore">Restore purchases</button><span aria-hidden="true">·</span>
      <button type="button" data-doc="terms">Terms</button><span aria-hidden="true">·</span>
      <button type="button" data-doc="privacy">Privacy</button>
    </div>
  </section>`;
}

// StoreKit lives in the native wrapper; it answers through window.ArguablyStore.
// Without it (a browser preview) purchases are simulated so the flow can be tried end to end.
const storeBridge = () => window.webkit?.messageHandlers?.storekit || null;
function storeCall(msg) {
  const bridge = storeBridge();
  // Purchases are only simulated in a browser preview. Inside the native app a missing
  // StoreKit bridge is an error, never free Pro.
  if (!bridge) return Promise.resolve(msg.type === "purchase" && !window.webkit ? { ok: true, plan: msg.plan, preview: true } : { ok: false });
  return new Promise((resolve) => {
    const id = uid();
    (window.ArguablyStore ||= { pending: {}, reply: (rid, res) => { window.ArguablyStore.pending[rid]?.(res); delete window.ArguablyStore.pending[rid]; } });
    window.ArguablyStore.pending[id] = resolve;
    bridge.postMessage({ ...msg, id });
  });
}
let purchasing = false;
async function purchase() {
  if (purchasing) return;
  purchasing = true;
  document.querySelector(".pw-cta")?.setAttribute("aria-busy", "true");
  const plan = PLANS[paywallPlan];
  let res;
  try {
    res = await storeCall({ type: "purchase", plan: paywallPlan, productId: plan.id });
  } finally {
    purchasing = false;
  }
  if (!res?.ok) return res?.cancelled ? undefined : toast("The purchase didn't go through. You weren't charged.");
  unlockPro(res.plan || paywallPlan, res.preview ? "Preview: purchase simulated. You're Pro." : "You're Pro. Welcome in.");
}
async function restore() {
  const res = await storeCall({ type: "restore" });
  if (res?.ok && res.plan) return unlockPro(res.plan, "Purchases restored. You're Pro.");
  toast("No purchases to restore on this Apple ID.");
}
function unlockPro(plan, message) {
  prefs.pro = { plan, since: Date.now() };
  savePrefs();
  toast(message);
  const waiting = paywallFor;
  paywallFor = null;
  if (waiting) {
    page = null;
    chat = live.get(waiting.c.id) || waiting.c;
    return startVerdict(chat, waiting.note);
  }
  if (page === "paywall") page = null;
  render();
}
function closePaywall() {
  const waiting = paywallFor;
  paywallFor = null;
  page = null;
  if (waiting) chat = waiting.c;
  render();
}

// ---------- wiring ----------
function autosize() {
  const t = $("messageInput");
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight + 2, 160) + "px";
  renderComposer();
}

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  if (busyHere()) busy.ctl.abort();
  else send();
});
$("messageInput").addEventListener("input", autosize);
$("messageInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer: fine)").matches) {
    e.preventDefault();
    $("composer").requestSubmit();
  }
});
$("fileInput").addEventListener("change", async (e) => {
  await addFiles(e.target.files);
  e.target.value = "";
});
document.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length && !busyHere() && !pendingWho() && page !== "settings") {
    e.preventDefault();
    addFiles(files);
  }
});
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer?.files?.length && !busyHere() && !pendingWho()) addFiles(e.dataTransfer.files);
});
$("attachStrip").addEventListener("click", (e) => {
  const b = e.target.closest("[data-remove]");
  if (!b) return;
  pending = pending.filter((p) => p.id !== b.dataset.remove);
  render();
});
$("suggestions").addEventListener("click", (e) => {
  if (e.target.closest("[data-pick]")) return $("fileInput").click();
  const b = e.target.closest("[data-say]");
  if (b) send(b.dataset.say);
});
$("thread").addEventListener("input", (e) => {
  const input = e.target.closest(".who input");
  if (!input) return;
  const m = pendingWho();
  if (!m) return;
  m.groups[Number(input.dataset.g)][input.dataset.side] = input.value.trim();
  renderYouChips(m);
});
$("thread").addEventListener("click", (e) => {
  const t = e.target;
  const action = t.closest("[data-action]")?.dataset.action;
  if (action === "example") {
    const fromIntro = page === "onboarding";
    if (fromIntro) {
      finishOnboarding();
      if (page !== null) return; // the agreement, or the store build's paywall, comes first
    }
    return openExample();
  }
  if (action === "import") {
    if (page === "onboarding") {
      finishOnboarding();
      if (page === "paywall") return; // App Store build: the trial comes first
    }
    return $("fileInput").click();
  }
  if (action === "next") return goStep(onboardStep + 1);
  const step = t.closest("[data-step]");
  if (step) return goStep(Number(step.dataset.step));
  if (action === "replay") return openPage("onboarding");
  const obDoc = t.closest("[data-ob-doc]");
  if (obDoc) {
    e.preventDefault();
    docReturn = { page: "onboarding" };
    page = obDoc.dataset.obDoc;
    return render();
  }
  if ((action === "consent-next" || action === "agree-next") && !policyOk()) return nudgeAgree();
  if (action === "agree-next") {
    prefs.aiConsent = false; // "Continue without" means no AI, even if it was allowed before
    savePrefs();
    if (gateMode) return finishOnboarding();
    return goStep(onboardStep + 1);
  }
  if (action === "photos") {
    prefs.photos = true;
    savePrefs();
    finishOnboarding();
    if (page === "paywall") return; // App Store build: the trial comes first
    return $("fileInput").click();
  }
  if (action === "consent-next" && gateMode) {
    prefs.aiConsent = true;
    savePrefs();
    return finishOnboarding();
  }
  if (action === "consent-next") {
    prefs.aiConsent = true;
    savePrefs();
    return goStep(onboardStep + 1);
  }
  if (action === "consent") {
    prefs.aiConsent = true;
    savePrefs();
    if (consentReturn) {
      const back = consentReturn;
      consentReturn = null;
      page = null;
      chat = back.chat;
      render();
      if (back.verdictNote !== undefined && chat) return startVerdict(chat, back.verdictNote);
      return send(back.text);
    }
    return render();
  }
  if (action === "export") return exportData();
  if (action === "all-recent") {
    showAllRecent = !showAllRecent;
    return render();
  }
  if (action === "paywall") {
    const r = t.closest("[data-resume]");
    const m = r && chat?.messages.find((x) => x.id === r.dataset.resume);
    paywallFor = m ? { c: chat, note: m.note } : null;
    return openPage("paywall");
  }
  if (action === "paywall-close") return closePaywall();
  if (action === "purchase") return purchase();
  if (action === "restore") return restore();
  const plan = t.closest("[data-plan]");
  if (plan) {
    paywallPlan = plan.dataset.plan;
    return render();
  }
  const resume = t.closest("[data-resume]");
  if (resume && chat) {
    if (busy) return toast("Arguably is finishing another argument. Try again in a moment.");
    const m = chat.messages.find((x) => x.id === resume.dataset.resume);
    if (m) return startVerdict(chat, m.note);
  }
  if (action === "paste-new") {
    chat = null;
    ensureChat();
    render();
    return $("messageInput").focus();
  }
  const doc = t.closest("[data-doc]");
  if (doc) return openPage(doc.dataset.doc);
  if (action === "inbox") return openPage("inbox");
  if (action === "read-all") {
    inbox.forEach((n) => (n.read = true));
    saveInbox();
    return render();
  }
  if (action === "delete-all") {
    confirmingDelete = true;
    return render();
  }
  if (action === "delete-cancel") {
    confirmingDelete = false;
    return render();
  }
  if (action === "delete-confirm") {
    [...chats, ...live.values(), chat].forEach(forget);
    if (busy) busy.ctl.abort();
    busy = null;
    chat = null;
    pending = [];
    paywallFor = null;
    consentReturn = null;
    docReturn = null;
    chats = [];
    inbox = [];
    storage(() => [STORE_KEY, INBOX_KEY, PREFS_KEY, "arguably.chats.v1"].forEach((k) => localStorage.removeItem(k)));
    // Your content goes; the record that you agreed to the policy and any purchase stay,
    // so erasing can't be used to reset a subscription's monthly allowance.
    prefs = { ...DEFAULT_PREFS, onboarded: true, notify: { ...DEFAULT_PREFS.notify }, policy: prefs.policy, pro: prefs.pro, proUsage: prefs.proUsage, freeUsed: prefs.freeUsed };
    savePrefs();
    confirmingDelete = false;
    render();
    return toast("Everything on this device is erased.");
  }
  const tone = t.closest("[data-tone]");
  if (tone) {
    prefs.tone = tone.dataset.tone;
    savePrefs();
    return render();
  }
  const toggle = t.closest("[data-toggle]");
  if (toggle) {
    const key = toggle.dataset.toggle;
    if (key === "readOnPhone" || key === "aiConsent") prefs[key] = !prefs[key];
    else prefs.notify[key] = !prefs.notify[key];
    savePrefs();
    return render();
  }
  const note = t.closest("[data-note]");
  if (note) {
    const n = inbox.find((x) => x.id === note.dataset.note);
    if (!n) return;
    n.read = true;
    saveInbox();
    if (n.kind === "rate") {
      if (APP_STORE_ID) window.open(`https://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`, "_blank", "noopener");
      else toast("Ratings open once Arguably is on the App Store. Thank you!");
      return render();
    }
    if (n.chatId) return openChat(n.chatId);
    return render();
  }
  if (action === "paste") {
    ensureChat();
    render();
    $("messageInput").focus();
    return;
  }
  const you = t.closest("[data-you]");
  if (you) {
    const m = pendingWho();
    if (m) {
      m.you = m.you === you.dataset.you ? "" : you.dataset.you;
      renderYouChips(m);
    }
    return;
  }
  const confirm = t.closest("[data-confirm]");
  if (confirm) return confirmWho(confirm.dataset.confirm);
  const open = t.closest("[data-chat]");
  if (open) openChat(open.dataset.chat);
});

// Verdict sections stay open or closed the way you left them, across re-renders.
$("thread").addEventListener("toggle", (e) => {
  const d = e.target;
  if (!d.matches?.("details[data-sec]") || !chat) return;
  const m = chat.messages.find((x) => x.id === d.dataset.msg);
  if (!m) return;
  m.open = { ...(m.open || {}), [d.dataset.sec]: d.open };
}, true);

// Settings: your name saves as you type.
$("thread").addEventListener("input", (e) => {
  if (e.target.id === "setName" || e.target.id === "obName") {
    prefs.name = e.target.value.trim().slice(0, 40);
    savePrefs();
  }
});
$("thread").addEventListener("keydown", (e) => {
  if (e.target.id === "obName" && e.key === "Enter") {
    e.preventDefault();
    goStep(onboardStep + 1); // same as Next: the photos step comes after the name
  }
});

// Settings › Export my data: everything Arguably keeps, as one JSON file.
async function exportData() {
  const data = { app: "Arguably", version: APP_VERSION, exportedAt: new Date().toISOString(), settings: prefs, chats, notifications: inbox };
  const json = JSON.stringify(data, null, 2);
  const name = `arguably-export-${new Date().toISOString().slice(0, 10)}.json`;
  try {
    const file = new File([json], name, { type: "application/json" });
    if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file], title: "Arguably export" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("Export downloaded.");
  } catch (err) {
    if (err?.name === "AbortError") return;
    try {
      await navigator.clipboard.writeText(json);
      toast("Couldn't save a file here, so your data was copied instead.");
    } catch {
      toast("Couldn't export here. Try from a browser.");
    }
  }
}

function nudgeAgree() {
  toast("Agree to the Privacy Policy and Terms to continue.");
  const row = $("obAgreeRow");
  if (row) {
    row.classList.remove("shake");
    void row.offsetWidth;
    row.classList.add("shake");
  }
}
function agreePolicy() {
  prefs.policy = { version: POLICY_VERSION, at: Date.now() };
  savePrefs();
}
function goStep(n) {
  n = Math.max(0, Math.min(OB_STEPS - 1, n));
  if (n > 1 && !policyOk()) {
    if (onboardStep !== 1) {
      onboardDir = 1;
      onboardStep = 1;
      render();
    }
    return nudgeAgree();
  }
  if (n === onboardStep) return;
  onboardDir = n > onboardStep ? 1 : -1;
  onboardStep = n;
  render();
  // Move focus to the new step's heading so screen readers announce it.
  const h = document.querySelector(".onboard h1");
  if (h && document.activeElement && document.activeElement !== document.body) {
    h.tabIndex = -1;
    h.focus({ preventScroll: true });
  }
}

// Swipe through the intro: the screen follows your finger, and a clear sideways flick
// (not a vertical scroll) moves to the next or previous step. Swiping forward past the
// Claude step is the same as "Not now"; nothing is ever allowed by a swipe.
let swipe = null;
$("thread").addEventListener("touchstart", (e) => {
  if (page !== "onboarding" || e.touches.length !== 1 || e.target.closest("input")) return;
  swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, locked: null };
}, { passive: true });
$("thread").addEventListener("touchmove", (e) => {
  if (!swipe) return;
  swipe.dx = e.touches[0].clientX - swipe.x;
  const dy = e.touches[0].clientY - swipe.y;
  if (swipe.locked == null && Math.abs(swipe.dx) + Math.abs(dy) > 10) swipe.locked = Math.abs(swipe.dx) > Math.abs(dy);
  if (!swipe.locked) return;
  const edge = (swipe.dx > 0 && onboardStep === 0) || (swipe.dx < 0 && onboardStep === OB_STEPS - 1);
  const el = document.querySelector(".onboard");
  if (el) el.style.transform = `translateX(${swipe.dx * (edge ? 0.15 : 0.5)}px)`;
}, { passive: true });
$("thread").addEventListener("touchend", () => {
  if (!swipe) return;
  const { dx, locked } = swipe;
  swipe = null;
  const el = document.querySelector(".onboard");
  if (el) {
    el.style.transition = "transform 220ms var(--ease-out)";
    el.style.transform = "";
  }
  if (locked && Math.abs(dx) > 50) goStep(onboardStep + (dx < 0 ? 1 : -1));
});
document.addEventListener("keydown", (e) => {
  if (page !== "onboarding" || e.target.closest?.("input, textarea")) return;
  if (e.key === "ArrowRight") goStep(onboardStep + 1);
  if (e.key === "ArrowLeft") goStep(onboardStep - 1);
});

function finishOnboarding() {
  if (!policyOk()) {
    goStep(1);
    return nudgeAgree();
  }
  gateMode = false;
  if (prefs.onboarded) {
    if (page === "onboarding") page = null;
    return render();
  }
  prefs.onboarded = true;
  savePrefs();
  page = STORE_BUILD && !prefs.pro ? "paywall" : null;
  if (STORE_BUILD) notify("rate", "Hey, welcome to Arguably!", "Give us a rating on the App Store. It helps more people settle it.");
  else if (HOSTED) notify("tips", "Hey, welcome to Arguably!", "Put it on your Home Screen: tap Share, then Add to Home Screen. It opens like an app.");
  else notify("tips", "Hey, welcome to Arguably!", "Import screenshots from both phones for the fairest verdict. You can judge arguments you're not in, too.");
  render();
}
$("newBtn").addEventListener("click", () => {
  chat = null;
  page = null;
  pending = [];
  ensureChat();
  render();
});
$("backBtn").addEventListener("click", () => {
  if (consentReturn) {
    page = null;
    chat = consentReturn.chat;
    consentReturn = null;
    return render();
  }
  // A policy or help page goes back to wherever it was opened from.
  if (DOC_PAGES.includes(page) && docReturn) {
    const back = docReturn;
    docReturn = null;
    page = back.page;
    if (back.chat !== undefined) chat = back.chat;
    return render();
  }
  return DOC_PAGES.includes(page) ? openPage("settings") : goHome();
});
$("homeBtn").addEventListener("click", goHome);
$("inboxBtn").addEventListener("click", () => openPage("inbox"));
$("settingsBtn").addEventListener("click", () => openPage("settings"));
$("skipBtn").addEventListener("click", () => {
  if (policyOk()) return finishOnboarding();
  onboardDir = 1;
  onboardStep = 1;
  render();
  nudgeAgree();
});
// The agreement checkbox on the privacy step.
$("thread").addEventListener("change", (e) => {
  if (e.target.id !== "obAgree") return;
  if (e.target.checked) agreePolicy();
  else {
    prefs.policy = null;
    savePrefs();
  }
  render();
  $("obAgree")?.focus(); // keyboard and VoiceOver users stay on the checkbox
});
// Delete one chat: the first tap asks, the second (within a few seconds) deletes.
let deleteTimer = 0;
$("deleteBtn").addEventListener("click", () => {
  const b = $("deleteBtn");
  if (!b.classList.contains("confirm")) {
    b.classList.add("confirm");
    b.setAttribute("aria-label", "Tap again to delete this chat");
    clearTimeout(deleteTimer);
    deleteTimer = setTimeout(() => { b.classList.remove("confirm"); b.setAttribute("aria-label", "Delete this chat"); }, 3500);
    return;
  }
  clearTimeout(deleteTimer);
  b.classList.remove("confirm");
  b.setAttribute("aria-label", "Delete this chat");
  if (!chat) return;
  const id = chat.id;
  forget(chat);
  chats = chats.filter((x) => x.id !== id);
  storage(() => localStorage.setItem(STORE_KEY, JSON.stringify(chats)));
  inbox = inbox.filter((n) => n.chatId !== id);
  saveInbox();
  goHome();
  toast("Chat deleted.");
});
window.addEventListener("resize", renderComposer);
// The header only shows a (soft) edge once something scrolls under it.
window.addEventListener("scroll", () => document.body.classList.toggle("scrolled", window.scrollY > 4), { passive: true });

render();

(async () => {
  try {
    sampler = window.claude ? await window.claude.use("sample") : null;
    const limits = sampler ? await sampler.limits().catch(() => null) : null;
    maxImages = limits?.images?.maxCount || 0;
    if (limits?.maxPromptBytes > 20000) maxPromptBytes = limits.maxPromptBytes;
  } catch {
    sampler = null;
  }
  claudeChecked = true;
  const notice = $("notice");
  if (!sampler) {
    notice.textContent = "Open Arguably on claude.ai while signed in to get verdicts. You can still see the example.";
    notice.hidden = false;
  } else if (!maxImages) {
    // Warm up the on-device reader in the background so the first import starts sooner.
    ocrStart().catch(() => {});
  }
  render();
})();
