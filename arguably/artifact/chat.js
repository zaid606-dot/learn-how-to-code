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
const MAX_EDGE = 2000;
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
Below are the full transcript of the conversation (read from their screenshots, with speakers they confirmed) and the verdict(s) you gave as JSON. Answer their follow-up questions about this argument: explain your reasoning, quote the actual messages from the transcript (cite them like [m12]), help them see the other side, suggest what to say next, and reconsider fairly if they add context (say plainly when new context changes your view and when it doesn't).
Voice: clear, warm and grounded, like a thoughtful guide. Short paragraphs, concrete words, no exclamation marks. Judge the arguing, never the people, and never mock or shame anyone.
When asked to write a message, give the message itself, ready to send, then at most one line on why it works.
Format: plain text. You may use "- " bullet lines and **bold** sparingly. No headings, no tables.
If there is no verdict yet, tell them to import screenshots or paste the conversation as text.`;

const TRANSCRIBE_RULES = `Transcribe these screenshots of a text-message conversation so it can be judged later. Do not judge or summarize anything.

For each image, report the chat app (iMessage, WhatsApp, Instagram, Messenger, Discord, Slack, SMS, other) and the name or title shown in the chat header at the top. Use "" when no header is visible in that image (lower slices of a tall screenshot usually have none).

Then list every message bubble in reading order, top to bottom, image by image. For each message give:
- image: the image number
- side: "right" for bubbles sent by the phone's owner (usually right-aligned and colored), "left" for received bubbles, "center" for system notices
- sender_label: the name shown above or beside a left bubble in a group chat, else ""
- text: exactly as written, including emoji and typos. Describe photos, stickers, GIFs and voice notes in square brackets, e.g. "[photo: a sink full of dishes]", "[voice message 0:12]". Deleted messages: "[deleted message]"
- time: the time or date shown for it, if any (put a timestamp row like "Today 9:14 PM" on the next message instead of listing it separately)
- kind: "text", "photo", "voice", "sticker", "link", "deleted", "reaction" or "system"
- partial: true if the bubble is cut off at the top or bottom edge of the image
- y: the bubble's vertical center as a percentage of the image height (0 = top, 100 = bottom)

Reply with only one JSON object, for example:
{"images":[{"image":1,"app":"iMessage","header_name":"Jordan"}],"messages":[{"image":1,"side":"right","sender_label":"","text":"You said you'd do the dishes?","time":"Today 9:14 PM","kind":"text","partial":false,"y":22}]}`;

// Used when this view can't send images to Claude: the phone reads the text, Claude rebuilds the messages.
const OCR_RULES = `These are text lines read on the user's phone (by OCR) from screenshots of a text-message conversation. Rebuild the conversation's messages. Do not judge or summarize anything.

Each line is: y (top of the line, % of screenshot height), L and R (left and right edge, % of screenshot width), an optional "low" confidence flag, then the text.
How to read them:
- The first line or two (time, carrier, battery) is the phone's status bar. Ignore it.
- The chat header is the centered name near the top (often ending in ">" or "›"). Report it as header_name; "" if none.
- Sent bubbles (the phone owner's) are right-aligned: R is high (about 85 or more) and L is well away from the left edge. side = "right".
- Received bubbles are left-aligned: L is low (under about 25). side = "left". In group chats a short name line sits just above a received bubble; use it as sender_label for that bubble, not as a message.
- Centered short lines between bubbles are timestamps ("Today 9:58 AM") or notices. Put a timestamp on the next message's time field; other notices get side "center", kind "system".
- Lines close together vertically (y differs by about 3 or less) with the same alignment belong to one bubble: join them with a space.
- Fix obvious OCR slips (a lone "|" is usually "I"; "0k" is "Ok") but never change the wording. Drop fragments that are clearly icon or photo noise. If garbled text sits where a photo, link card or voice note would be, use a short bracketed description like "[photo]" or "[voice message]".
- "Replies", "Delivered", "Read", reaction counts and similar labels are not messages. Skip them.
- y for each message is the y of its first line.

Reply with only one JSON object, for example:
{"images":[{"image":1,"app":"iMessage","header_name":"Jordan"}],"messages":[{"image":1,"side":"right","sender_label":"","text":"You said you'd do the dishes?","time":"Today 9:14 PM","kind":"text","partial":false,"y":22}]}
Use the screenshot number as "image".`;

const SAMPLE_TRANSCRIPT = [
  ["Maya", "Today 9:14 PM", "You said you'd do the dishes last night?"],
  ["Jordan", "", "I was going to do them today"],
  ["Jordan", "", "It's literally just dishes, why is this a whole thing"],
  ["Maya", "", "You always do this, you're so unreliable"],
  ["Jordan", "", "Ok and you left your laundry in the dryer for 3 days so"],
  ["Maya", "9:21 PM", "This is literally the same thing that happened in March"],
  ["Jordan", "", "Wow ok sorry I'm not perfect like you"],
  ["Maya", "", "Can we just make a chore chart so this stops happening"],
].map(([sender, time, text], i) => ({ id: "m" + (i + 1), sender, time, text, kind: "text", shots: [i < 4 ? 1 : 2] }));

const SAMPLE_ERRORS = {
  not_granted: "Arguably needs permission to use Claude. Reload the page and choose Allow when asked.",
  sampling_disabled: "Claude isn't available for this account, so Arguably can't reply here.",
  session_expired: "Your Claude session expired. Sign in again, then try again.",
  rate_limited: "You've hit your Claude usage limit for now. Try again later.",
  image_rejected: "One of the screenshots couldn't be used. Remove it or try a different image.",
  images_unavailable: "This view can't send screenshots to Claude. Paste the conversation as text instead.",
  ocr_unavailable: "This phone couldn't read the screenshots. Try Arguably on claude.ai in a browser, or paste the conversation as text.",
  refused: "Claude couldn't review this. Try a different set of screenshots.",
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
let chat = null; // null = home screen
let pending = []; // screenshots attached to the next message: {id, url, hash}
let busy = null; // {ctl}
let sampler = null;
let maxImages = 0;

function newChatObject(saved = {}) {
  return { id: uid(), title: "New argument", createdAt: Date.now(), updatedAt: Date.now(), messages: [], readings: [], groups: [], you: "", transcript: [], raw: "", shotTotal: 0, ...saved };
}

function saveChats() {
  if (!chat || chat.example || !chat.messages.length) return;
  chat.updatedAt = Date.now();
  // Screenshots stay in memory only; saved chats keep text, transcript and verdicts.
  const clean = { ...chat, messages: chat.messages.filter((m) => !m.transient).map((m) => (m.shots ? { ...m, shots: undefined } : m)) };
  chats = [clean, ...chats.filter((c) => c.id !== chat.id)].slice(0, MAX_CHATS);
  storage(() => localStorage.setItem(STORE_KEY, JSON.stringify(chats)));
}

function goHome() {
  if (busy) busy.ctl.abort();
  chat = null;
  pending = [];
  $("messageInput").value = "";
  render();
}

function ensureChat() {
  if (!chat || chat.example) chat = newChatObject();
  return chat;
}

const verdictsOf = (c) => (c?.messages || []).filter((m) => m.kind === "verdict").map((m) => m.verdict);
const pendingWho = () => chat?.messages.find((m) => m.kind === "who" && m.status === "pending");

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

function sourceLabel(src) {
  return (
    {
      contact_header: "Contact name",
      signed_or_self_named: "Named themselves",
      mentioned_by_other: "Named by the other person",
      bubble_side_only: "No name visible",
    }[src] || "Source unknown"
  );
}

function verdictHTML(m, c) {
  const v = m.verdict;
  const unverified = new Set(m.unverified || []);
  const color = colorMap(v);
  const person = (n) => `<span class="person"><span class="dot" style="background:${color(n).bg}"></span>${esc(n)}</span>`;
  const quote = (text, who) =>
    `<div class="quote" style="box-shadow: inset 3px 0 0 ${color(who).bg}">“${esc(text)}”${
      unverified.has(text) ? '<span class="tag unverified">Not found in the screenshots</span>' : ""
    }</div>`;
  const tag = (value, labels) => `<span class="tag ${esc(value)}">${esc(labels[value] || value)}</span>`;
  const sev = (s) => tag(s, { low: "Low", medium: "Medium", high: "High" });
  const strength = (s) => tag(s, { strong: "Strong", mixed: "Mixed", weak: "Weak" });
  const empty = (msg) => `<p class="empty">${msg}</p>`;
  const sec = (title, count, body, open = false) =>
    `<details class="v-sec"${open ? " open" : ""}><summary>${title}${count != null ? ` <span class="count-badge">${count}</span>` : ""}</summary><div class="v-body">${body}</div></details>`;
  const w = v.winner || {};
  const conf = Math.max(0, Math.min(100, Number(w.confidence) || 0));
  const scores = [...(w.scores || [])].sort((a, b) => b.score - a.score);
  const o = v.origin || {};
  const transcript = m.transcript || c.transcript || [];

  return `
    ${c.example ? '<span class="tag example-tag">Example verdict</span>' : ""}
    <h2 class="v-title">${esc(v.title)}</h2>
    ${
      unverified.size
        ? `<p class="banner warn" role="note">${(m.unverified || []).length === 1 ? "1 quote" : `${(m.unverified || []).length} quotes`} in this verdict couldn't be matched to the screenshots. They're marked below.</p>`
        : transcript.length || c.raw
          ? `<p class="checked"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>Every quote checked against the ${transcript.length ? "screenshots" : "conversation"}</p>`
          : ""
    }
    ${v.safety_note?.trim() ? `<section class="card safety" role="note"><h2>A note on safety</h2><p>${esc(v.safety_note)}</p></section>` : ""}
    <section class="card winner-card">
      <div class="winner-head">
        <div class="ring" style="--p:${conf}" role="img" aria-label="${conf}% confidence"><span>${conf}%</span></div>
        <div>
          <div class="winner-label">${w.is_draw ? "Even match" : "Winner"}</div>
          <div class="winner-name">${esc(w.is_draw ? "No clear winner" : w.name)}</div>
        </div>
      </div>
      <p>${esc(w.reasoning)}</p>
    </section>
    <section class="card">
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
    <div class="you-row" role="radiogroup" aria-label="Which one are you?">
      <span class="label">Which one are you?</span>
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
    `<button type="button" role="radio" aria-checked="${m.you === "__none"}" class="you-chip${m.you === "__none" ? " on" : ""}" data-you="__none">Neither</button>`;
}

// ---------- rendering: messages and screens ----------
function messageHTML(m) {
  if (m.role === "user") {
    const shots = m.shots?.length
      ? `<div class="shots">${m.shots.map((s, i) => `<img src="${s}" alt="Screenshot ${i + 1}">`).join("")}</div>`
      : m.shotCount
        ? `<div class="shot-count">${plural(m.shotCount, "screenshot")}</div>`
        : "";
    return `<div class="msg user">${shots}${m.text ? `<div class="u-text">${esc(m.text.length > 600 ? m.text.slice(0, 600) + "…" : m.text)}</div>` : ""}</div>`;
  }
  if (m.kind === "verdict") return `<article class="msg verdict">${verdictHTML(m, chat)}</article>`;
  if (m.kind === "who") return whoHTML(m);
  if (m.kind === "error") return `<div class="msg error"><p class="banner" role="alert">${esc(m.text)}</p></div>`;
  if (m.kind === "thinking")
    return `<div class="msg reply" id="${m.id}"><div class="thinking"><span class="dots"><i></i><i></i><i></i></span><span class="step">${esc(m.text)}</span></div>${
      m.progress != null ? `<div class="progress" aria-hidden="true"><i style="width:${Math.round(m.progress * 100)}%"></i></div>` : ""
    }</div>`;
  return `<div class="msg reply" id="${m.id || ""}">${formatReply(m.text)}${m.interrupted ? '<p class="interrupted">Reply stopped before it finished.</p>' : ""}</div>`;
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

function homeHTML() {
  const recent = chats.slice(0, 8);
  const notice = !sampler
    ? '<p class="notice">Open Arguably on claude.ai while signed in to get verdicts. You can still see the example.</p>'
    : "";
  homeShownAt ||= performance.now();
  const since = Math.round(performance.now() - homeShownAt);
  const settle = since < 1200 ? ` style="animation-delay:${200 - since}ms"` : ' data-settled=""';
  return `<section class="home">
    ${notice}
    <div class="home-hero">
      <h1>Who's <em>actually</em> right?</h1>
      <p>Drop in the screenshots from both phones. Get a fair verdict, with receipts.</p>
    </div>
    <div class="demo">
      <div class="demo-phones" aria-hidden="true">
        <div class="demo-phone mine">
          <span class="demo-label"><i></i>Your phone</span>
          <span class="bub out">I said I'd do it after dinner</span>
          <span class="bub in">That was Tuesday</span>
          <span class="bub out ghost"></span>
        </div>
        <div class="demo-phone theirs">
          <span class="demo-label"><i></i>Their phone</span>
          <span class="bub out">The pans are still in there</span>
          <span class="bub in ghost"></span>
          <span class="bub out ghost"></span>
        </div>
      </div>
      <button class="demo-verdict" type="button" data-action="example" aria-label="See an example verdict"${settle}>
        <span class="dv-top"><span class="dv-eyebrow">Verdict</span><span class="dv-tag">Example</span></span>
        <span class="dv-title">You're mostly right.</span>
        <span class="dv-bar"><i style="flex:64"></i><i style="flex:36"></i></span>
        <span class="dv-scores"><span>You 64</span><span>Them 36</span></span>
        <span class="dv-check">${svg(ICON.check, 16)}3 quotes checked against the originals</span>
      </button>
    </div>
    <ul class="proof">
      <li>${svg(ICON.phones, 20)}<span><strong>Both phones</strong> merged in order</span></li>
      <li>${svg(ICON.people, 20)}<span><strong>You confirm</strong> who's who first</span></li>
      <li>${svg(ICON.quote, 20)}<span><strong>Every quote</strong> checked</span></li>
    </ul>
    <div class="home-sheet">
      <button class="import-btn" type="button" data-action="import">${svg(ICON.upload, 22)}Import screenshots</button>
      <p class="import-note">Both phones · any order · up to ${MAX_IMAGES}</p>
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
              const meta = v ? (v.winner?.is_draw ? "Even match" : `${esc(v.winner?.name)} won`) : "No verdict yet";
              return `<li><button type="button" data-chat="${esc(c.id)}">
                <span class="pair" aria-hidden="true">${(names.length ? names : ["?"])
                  .map((n, i) => `<span style="background:${PALETTE[i].bg};color:${PALETTE[i].fg}">${esc(String(n).trim().charAt(0).toUpperCase())}</span>`)
                  .join("")}</span>
                <span class="r-main"><span class="r-title">${esc(c.title)}</span><span class="r-meta">${meta} · ${relTime(c.updatedAt || c.createdAt)}</span></span>
                <span class="r-go">${svg(ICON.chevron, 18)}</span>
              </button></li>`;
            })
            .join("")}</ul></section>`
        : ""
    }
  </section>`;
}

function emptyChatHTML() {
  return `<section class="start-hint">
    <h2>New argument</h2>
    <p>${pending.length ? "Add a note if it helps, like how you know each other, then send." : "Import screenshots with the image button, or paste the conversation below. Include names if you paste, like “Maya: …”."}</p>
  </section>`;
}

function render() {
  const onHome = !chat;
  document.body.classList.toggle("on-home", onHome);
  $("backBtn").hidden = onHome;
  $("homeBtn").hidden = !onHome;
  $("chatTitle").hidden = onHome;
  $("newBtn").hidden = onHome;
  $("chatTitle").textContent = chat?.title || "";
  $("composer").hidden = onHome;

  const thread = $("thread");
  thread.innerHTML = onHome ? homeHTML() : chat.messages.length ? chat.messages.map(messageHTML).join("") : emptyChatHTML();
  const who = pendingWho();
  if (who) renderYouChips(who);
  renderSuggestions();
  renderComposer();
  // New verdicts and who's-who cards open at their top; everything else follows the latest message.
  requestAnimationFrame(() => {
    const last = !onHome && chat.messages.at(-1);
    let top = last ? document.documentElement.scrollHeight : 0;
    if (last && (last.kind === "verdict" || last.kind === "who")) {
      const el = thread.lastElementChild;
      if (el) top = el.getBoundingClientRect().top + window.scrollY - $("thread").offsetTop + 8;
    }
    window.scrollTo({ top });
  });
}

function renderSuggestions() {
  const box = $("suggestions");
  const last = chat?.messages.at(-1);
  const show = !busy && last?.kind === "verdict" && sampler;
  box.hidden = !show;
  box.innerHTML = show
    ? '<label class="import-chip" for="fileInput">Import more screenshots</label>' +
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
  form.classList.toggle("busy", !!busy);
  const waitingOnWho = !!pendingWho();
  const hasInput = pending.length > 0 || $("messageInput").value.trim().length > 0;
  $("sendBtn").disabled = !busy && (!sampler || !hasInput || waitingOnWho);
  $("sendBtn").setAttribute("aria-label", busy ? "Stop" : "Send");
  $("attachBtn").classList.toggle("disabled", !!busy || waitingOnWho);
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

// Small grayscale thumbnail for spotting the same screenshot imported twice. Chat screenshots
// all share one layout, so this must be detailed enough that different conversations differ.
function imageHash(img) {
  const c = document.createElement("canvas");
  c.width = 48;
  c.height = 96;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, 48, 96);
  const d = ctx.getImageData(0, 0, 48, 96).data;
  const lum = new Uint8Array(48 * 96);
  for (let i = 0; i < lum.length; i++) lum[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
  return lum;
}
// Mean brightness difference per pixel (0-255). A re-imported screenshot scores about 0-1.
const hashDistance = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
};

async function fileToShot(file) {
  const src = URL.createObjectURL(file);
  try {
    const img = await loadImage(src);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return { id: uid(), url: c.toDataURL("image/jpeg", 0.88), hash: imageHash(c) };
  } finally {
    URL.revokeObjectURL(src);
  }
}

async function addFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
  if (!files.length) return;
  ensureChat();
  const room = MAX_IMAGES - pending.length;
  if (room <= 0) return toast(`You can import up to ${MAX_IMAGES} screenshots at a time.`);
  if (files.length > room) toast(`Added ${room}. The limit is ${MAX_IMAGES} screenshots at a time.`);
  let failed = 0;
  let dupes = 0;
  for (const f of files.slice(0, room)) {
    try {
      const shot = await fileToShot(f);
      if (pending.some((p) => hashDistance(p.hash, shot.hash) < 1.5)) dupes++;
      else pending.push(shot);
    } catch {
      failed++;
    }
  }
  render();
  const notes = [];
  if (failed) notes.push(`${failed} couldn't be opened`);
  if (dupes) notes.push(`skipped ${plural(dupes, "duplicate")}`);
  toast(pending.length ? `${plural(pending.length, "screenshot")} ready${notes.length ? ` (${notes.join(", ")})` : ""}. Tap send.` : "We couldn't open those images. Try PNG or JPEG.");
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
    const parts = Math.max(1, Math.min(4, Math.ceil(im.height / (im.width * 1.15))));
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
      slices.push({ n: s.n, part: p + 1, parts, blob: await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9)) });
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
  const scale = img.width < 1200 ? Math.min(2, 1200 / img.width) : 1; // small text reads better enlarged
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

async function ocrRecognize(url) {
  await ocrStart();
  const { png, width, height } = await ocrImage(url);
  const id = uid();
  const tsv = await new Promise((resolve, reject) => {
    ocr.waiting.set(id, { resolve, reject });
    ocr.worker.postMessage({ type: "ocr", id, png }, [png]);
  });
  return parseTsv(tsv, width, height);
}

async function readWithOcr(shots, thinking, signal) {
  updateThinking(thinking, "Getting the reader ready on this phone", 0.02);
  try {
    await ocrStart();
  } catch {
    throw { code: "ocr_unavailable" };
  }
  const blocks = [];
  for (let i = 0; i < shots.length; i++) {
    if (signal.aborted) throw { code: "cancelled" };
    updateThinking(thinking, `Reading screenshot ${i + 1} of ${shots.length} on this phone`, (i / shots.length) * 0.6);
    const lines = await ocrRecognize(shots[i].url).catch(() => []);
    blocks.push({ n: shots[i].n, text: ocrBlock(shots[i].n, lines), count: lines.length });
  }
  if (!blocks.some((b) => b.count)) throw { code: "no_messages" };
  // Send the lines to Claude in text-only batches that stay well under the request limit.
  const batches = [];
  let cur = [];
  let size = 0;
  for (const b of blocks) {
    if (cur.length && size + b.text.length > 36000) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(b);
    size += b.text.length;
  }
  if (cur.length) batches.push(cur);
  const readings = [];
  for (let k = 0; k < batches.length; k++) {
    updateThinking(thinking, batches.length > 1 ? `Sorting out the messages · part ${k + 1} of ${batches.length}` : "Sorting out the messages", 0.6 + (k / batches.length) * 0.35);
    const out = await sampler.json(`${OCR_RULES}\n\n${batches[k].map((b) => b.text).join("\n\n")}`, { modelTier: "default", signal });
    if (!out || !Array.isArray(out.messages)) throw { code: "invalid_json" };
    for (const b of batches[k]) {
      const info = (out.images || []).find((x) => Number(x.image) === b.n) || {};
      const msgs = out.messages
        .filter((m) => Number(m.image) === b.n)
        .map((m) => ({ ...m, part: 1, text: String(m.text ?? "") }))
        .sort((a, c) => (Number(a.y) || 0) - (Number(c.y) || 0));
      readings.push({
        n: b.n,
        header: String(info.header_name || "").trim(),
        app: info.app || "",
        isGroup: msgs.some((m) => m.side === "left" && String(m.sender_label || "").trim()),
        msgs,
      });
    }
  }
  return readings;
}

// Claude reads the screenshots itself when this view can send images; otherwise the phone does.
function readScreenshots(shots, thinking, signal) {
  return maxImages ? readWithVision(shots, thinking, signal) : readWithOcr(shots, thinking, signal);
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
      const msgs = out.messages
        .filter((m) => Number(m.image) === i + 1)
        .map((m) => ({ ...m, part: s.part, text: String(m.text ?? "") }))
        .sort((a, c) => (Number(a.y) || 0) - (Number(c.y) || 0));
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

async function runImport(shots, note) {
  const thinking = { id: uid(), role: "assistant", kind: "thinking", text: "Preparing screenshots", progress: 0, transient: true };
  chat.messages.push(thinking);
  busy = { ctl: new AbortController() };
  render();
  try {
    const numbered = shots.map((s, i) => ({ ...s, n: chat.shotTotal + i + 1 }));
    const readings = await readScreenshots(numbered, thinking, busy.ctl.signal);
    const messageCount = readings.reduce((a, r) => a + r.msgs.filter((m) => m.side !== "center").length, 0);
    if (!messageCount) throw { code: "no_messages" };
    chat.shotTotal += shots.length;
    chat.readings.push(...readings);
    const groups = defaultMapping(phoneGroups(readings), chat.groups);
    chat.messages = chat.messages.filter((m) => m !== thinking);
    chat.messages.push({
      id: uid(), role: "assistant", kind: "who", status: "pending", groups, note, readingNs: readings.map((r) => r.n),
      you: chat.you || "", shotCount: shots.length, messageCount,
    });
  } catch (err) {
    chat.messages = chat.messages.filter((m) => m !== thinking);
    if (err?.code !== "cancelled") chat.messages.push({ id: uid(), role: "assistant", kind: "error", text: errorCopy(err?.code), transient: true });
  } finally {
    busy = null;
    saveChats();
    render();
  }
}

function confirmWho(id) {
  const m = chat.messages.find((x) => x.id === id);
  if (!m || m.status !== "pending") return;
  m.groups.forEach((g, i) => {
    for (const side of ["them", "me"]) {
      const input = document.getElementById(`who-${m.id}-${i}-${side}`);
      if (input) g[side] = input.value.trim() || (side === "me" ? "Me" : "Them");
    }
  });
  m.status = "done";
  chat.you = m.you === "__none" ? "" : m.you;
  m.you = chat.you;
  // Remember names per phone for the next import in this chat.
  chat.groups = [...m.groups, ...chat.groups.filter((g) => !m.groups.some((x) => x.key === g.key))];
  const readings = chat.readings.filter((r) => m.readingNs.includes(r.n));
  chat.transcript = buildTranscript(readings, m.groups, chat.transcript);
  runVerdict(m.note);
}

function verdictPrompt(note) {
  const earlier = verdictsOf(chat).at(-1);
  const convo = chat.transcript.length ? transcriptText(chat.transcript) : chat.raw;
  let p = SYSTEM_PROMPT;
  p += chat.transcript.length
    ? "\n\nThe screenshots have already been read for you. Below is the full transcript, with both phones merged and speakers confirmed by the person who uploaded them. Work only from this transcript and quote messages exactly as written in it."
    : "\n\nThe conversation was pasted as text instead of screenshots. Quote messages exactly as written in it.";
  p += `\n\n<conversation>\n${convo.slice(-45000)}\n</conversation>`;
  if (chat.you) p += `\n\nThe person asking is ${chat.you}. Judge both sides by the same standard regardless.`;
  if (earlier) p += `\n\nYou gave an earlier verdict in this chat ("${earlier.title}"). New screenshots were added since; judge the whole conversation as it stands now.`;
  if (note) p += `\n\nNote from the person who uploaded this (background, not evidence):\n${note.slice(0, 2000)}`;
  p += `\n\nReply with only one JSON object that matches this JSON Schema exactly (every key present, no extra keys):\n${JSON.stringify(VERDICT_SCHEMA)}`;
  return p;
}

const looksLikeVerdict = (v) => v && typeof v === "object" && v.winner && v.origin && Array.isArray(v.participants);

async function runVerdict(note) {
  const thinking = { id: uid(), role: "assistant", kind: "thinking", text: VERDICT_STEPS[0], transient: true };
  chat.messages.push(thinking);
  busy = { ctl: new AbortController() };
  render();
  let step = 0;
  const timer = setInterval(() => {
    step = Math.min(step + 1, VERDICT_STEPS.length - 1);
    updateThinking(thinking, VERDICT_STEPS[step]);
  }, 7000);
  try {
    const verdict = await sampler.json(verdictPrompt(note), { modelTier: "complex", signal: busy.ctl.signal });
    if (!looksLikeVerdict(verdict)) throw { code: "invalid_json" };
    for (const k of ["subjects", "grudges", "personal_shots", "fallacies"]) if (!Array.isArray(verdict[k])) verdict[k] = [];
    chat.messages = chat.messages.filter((m) => m !== thinking);
    chat.messages.push({
      id: uid(), role: "assistant", kind: "verdict", verdict,
      unverified: unverifiedQuotes(verdict, chat.transcript, chat.raw),
      transcript: chat.transcript.length ? chat.transcript.slice() : undefined,
    });
    chat.title = verdict.title || chat.title;
  } catch (err) {
    chat.messages = chat.messages.filter((m) => m !== thinking);
    if (err?.code !== "cancelled") chat.messages.push({ id: uid(), role: "assistant", kind: "error", text: errorCopy(err?.code), transient: true });
  } finally {
    clearInterval(timer);
    busy = null;
    saveChats();
    render();
  }
}

function chatTurns() {
  const verdicts = verdictsOf(chat).slice(-2);
  let convo = chat.transcript.length ? transcriptText(chat.transcript) : chat.raw;
  if (convo.length > 30000) convo = convo.slice(0, 4000) + "\n[...middle of the conversation omitted...]\n" + convo.slice(-26000);
  const context =
    CHAT_RULES +
    (chat.you ? `\n\nThe person you're talking with is ${chat.you}.` : "") +
    (convo ? `\n\n<conversation>\n${convo}\n</conversation>` : "") +
    (verdicts.length ? "\n\n" + verdicts.map((v, i) => `Verdict ${i + 1} (JSON):\n${JSON.stringify(v)}`).join("\n\n") : "\n\nNo verdict has been given yet.");
  const turns = [];
  for (const m of chat.messages) {
    if (m.transient || m.kind === "error" || m.kind === "thinking" || m.kind === "who") continue;
    if (m.role === "user") {
      const n = m.shotCount || m.shots?.length;
      const content = ((n ? `(imported ${plural(n, "screenshot")}) ` : "") + (m.text || "")).trim();
      if (content) turns.push({ role: "user", content: content.slice(0, 4000) });
    } else if (m.kind === "verdict") {
      const w = m.verdict.winner || {};
      turns.push({ role: "assistant", content: `I gave my verdict "${m.verdict.title}": ${w.is_draw ? "an even match" : `${w.name} made the stronger case`} (${w.confidence}% confidence). Full details are in the verdict JSON above.` });
    } else if (m.text) {
      turns.push({ role: "assistant", content: m.text });
    }
  }
  // Stay under the 64 KiB limit: drop the oldest turns, never the context.
  let recent = turns.slice(-24);
  const size = () => new TextEncoder().encode(context + JSON.stringify(recent)).length;
  while (recent.length > 1 && size() > 60000) recent = recent.slice(1);
  while (recent.length && recent[0].role !== "user") recent = recent.slice(1);
  return [{ role: "user", content: context }, ...recent];
}

async function runChat() {
  const reply = { id: uid(), role: "assistant", kind: "thinking", text: "Thinking", transient: true };
  chat.messages.push(reply);
  busy = { ctl: new AbortController() };
  render();
  let streamed = "";
  try {
    const { text, truncated } = await sampler(chatTurns(), {
      cache: false,
      signal: busy.ctl.signal,
      onText: ({ text }) => {
        streamed = text;
        const el = document.getElementById(reply.id);
        if (el) el.outerHTML = `<div class="msg reply" id="${reply.id}">${formatReply(text)}</div>`;
        window.scrollTo({ top: document.documentElement.scrollHeight });
      },
    });
    Object.assign(reply, { kind: "text", text, transient: false, interrupted: truncated });
  } catch (err) {
    const kept = err?.text || (err?.code === "cancelled" ? streamed : "");
    if (kept) Object.assign(reply, { kind: "text", text: kept, transient: false, interrupted: true });
    else chat.messages = chat.messages.filter((m) => m !== reply);
    if (err?.code !== "cancelled") chat.messages.push({ id: uid(), role: "assistant", kind: "error", text: errorCopy(err?.code), transient: true });
  } finally {
    busy = null;
    saveChats();
    render();
  }
}

async function runPasted(text) {
  chat.raw = (chat.raw ? chat.raw + "\n" : "") + text;
  return runVerdict("");
}

async function send(textOverride) {
  if (busy || !sampler || pendingWho()) return;
  const input = $("messageInput");
  const text = (textOverride ?? input.value).trim();
  const shots = pending.slice();
  if (!text && !shots.length) return;
  ensureChat();
  chat.messages = chat.messages.filter((m) => m.kind !== "error");
  chat.messages.push({ id: uid(), role: "user", text, shots: shots.map((s) => s.url), shotCount: shots.length });
  pending = [];
  input.value = "";
  autosize();
  if (shots.length) return runImport(shots, text);
  // A long paste before any verdict is treated as the conversation itself.
  if (!verdictsOf(chat).length && text.length >= 80) return runPasted(text);
  return runChat();
}

function openExample() {
  chat = {
    ...newChatObject(),
    id: "example",
    example: true,
    title: SAMPLE_VERDICT.title,
    transcript: SAMPLE_TRANSCRIPT,
    you: "Maya",
    messages: [
      { id: uid(), role: "user", text: "Who's right here? We're roommates.", shotCount: 2 },
      { id: uid(), role: "assistant", kind: "who", status: "done", groups: [{ me: "Maya", them: "Jordan" }], you: "Maya" },
      { id: uid(), role: "assistant", kind: "verdict", verdict: SAMPLE_VERDICT, unverified: [], transcript: SAMPLE_TRANSCRIPT },
    ],
  };
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
  if (busy) busy.ctl.abort();
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
  if (files.length && !busy && !pendingWho()) {
    e.preventDefault();
    addFiles(files);
  }
});
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer?.files?.length && !busy && !pendingWho()) addFiles(e.dataTransfer.files);
});
$("attachStrip").addEventListener("click", (e) => {
  const b = e.target.closest("[data-remove]");
  if (!b) return;
  pending = pending.filter((p) => p.id !== b.dataset.remove);
  render();
});
$("suggestions").addEventListener("click", (e) => {
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
  if (action === "example") return openExample();
  if (action === "import") return $("fileInput").click();
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
  if (open) {
    const saved = chats.find((c) => c.id === open.dataset.chat);
    chat = saved ? newChatObject(saved) : null;
    render();
  }
});
$("newBtn").addEventListener("click", () => {
  goHome();
  ensureChat();
  render();
});
$("backBtn").addEventListener("click", goHome);
$("homeBtn").addEventListener("click", goHome);
window.addEventListener("resize", renderComposer);

render();

(async () => {
  try {
    sampler = window.claude ? await window.claude.use("sample") : null;
    const limits = sampler ? await sampler.limits().catch(() => null) : null;
    maxImages = limits?.images?.maxCount || 0;
  } catch {
    sampler = null;
  }
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
