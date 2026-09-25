/* Arguably chat, for the claude.ai Artifact build.
 * Claude is reached through the Artifact `sample` capability (the viewer's own account).
 * Constants VERDICT_SCHEMA, SAMPLE_VERDICT and SYSTEM_PROMPT are injected by the build. */
/*__CONSTANTS__*/

const MAX_IMAGES = 12;
const MAX_EDGE = 2000;
const STORE_KEY = "arguably.chats.v1";
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
  "Reading the screenshots",
  "Working out who's who",
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
Earlier in this chat you reviewed their screenshots and gave the verdict(s) included below as JSON. Answer their follow-up questions about this argument: explain your reasoning, quote the actual messages, help them see the other side, suggest what to say next, and reconsider fairly if they add context (say plainly when new context changes your view and when it doesn't).
Voice: clear, warm and grounded, like a thoughtful guide. Short paragraphs, concrete words, no exclamation marks. Judge the arguing, never the people, and never mock or shame anyone.
When asked to write a message, give the message itself, ready to send, then at most one line on why it works.
Format: plain text. You may use "- " bullet lines and **bold** sparingly. No headings, no tables.
If there is no verdict yet, tell them to add screenshots with the image button or paste the conversation as text.`;

const SAMPLE_ERRORS = {
  not_granted: "Arguably needs permission to use Claude. Reload the page and choose Allow when asked.",
  sampling_disabled: "Claude isn't available for this account, so Arguably can't reply here.",
  session_expired: "Your Claude session expired. Sign in again, then try again.",
  rate_limited: "You've hit your Claude usage limit for now. Try again later.",
  image_rejected: "One of the screenshots couldn't be used. Remove it or try a different image.",
  images_unavailable: "This view can't send screenshots to Claude. Paste the conversation as text instead.",
  refused: "Claude couldn't review this. Try a different set of screenshots.",
  prompt_too_large: "That's too much to review at once. Try fewer screenshots or a shorter paste.",
  invalid_json: "The verdict came back incomplete. Send it again to retry.",
};
const errorCopy = (code) => SAMPLE_ERRORS[code] || "We couldn't finish that reply. Try again.";

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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
  toast.timer = setTimeout(() => (t.hidden = true), 2400);
}

// Minimal, safe formatting for Claude's replies: paragraphs, "- " bullets, **bold**.
function formatReply(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const blocks = String(text).trim().split(/\n{2,}/);
  return blocks
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
let chats = storage(() => JSON.parse(localStorage.getItem(STORE_KEY)) || [], []);
let chat = null; // the open conversation
let pending = []; // screenshots attached to the next message: {id, url}
let busy = null; // {ctl, kind}
let sampler = null;
let maxImages = 0;

function saveChats() {
  if (!chat || chat.example) return;
  // Screenshots stay in memory only; saved chats keep their text and verdicts.
  const clean = {
    ...chat,
    updatedAt: Date.now(),
    messages: chat.messages.filter((m) => !m.transient).map((m) => (m.shots ? { ...m, shots: undefined } : m)),
  };
  chats = [clean, ...chats.filter((c) => c.id !== chat.id)].slice(0, MAX_CHATS);
  storage(() => localStorage.setItem(STORE_KEY, JSON.stringify(chats)));
}

function newChat() {
  if (busy) busy.ctl.abort();
  chat = null;
  pending = [];
  $("messageInput").value = "";
  autosize();
  render();
}

function ensureChat() {
  if (!chat || chat.example) chat = { id: uid(), title: "New argument", createdAt: Date.now(), messages: [] };
  return chat;
}

const verdictsOf = (c) => (c?.messages || []).filter((m) => m.kind === "verdict").map((m) => m.verdict);

// ---------- rendering ----------
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

function verdictHTML(v, isExample) {
  const color = colorMap(v);
  const person = (n) => `<span class="person"><span class="dot" style="background:${color(n).bg}"></span>${esc(n)}</span>`;
  const quote = (text, who) => `<div class="quote" style="box-shadow: inset 3px 0 0 ${color(who).bg}">“${esc(text)}”</div>`;
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

  return `
    ${isExample ? '<span class="tag example-tag">Example verdict</span>' : ""}
    <h2 class="v-title">${esc(v.title)}</h2>
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
    <section class="card takeaway-card"><h2>How to move forward</h2><p class="takeaway">${esc(v.takeaway)}</p></section>`;
}

function messageHTML(m) {
  if (m.role === "user") {
    const shots = m.shots?.length
      ? `<div class="shots">${m.shots.map((s, i) => `<img src="${s}" alt="Screenshot ${i + 1}">`).join("")}</div>`
      : m.shotCount
        ? `<div class="shot-count">${m.shotCount} screenshot${m.shotCount > 1 ? "s" : ""}</div>`
        : "";
    return `<div class="msg user">${shots}${m.text ? `<div class="u-text">${esc(m.text)}</div>` : ""}</div>`;
  }
  if (m.kind === "verdict") return `<article class="msg verdict">${verdictHTML(m.verdict, chat?.example)}</article>`;
  if (m.kind === "error") return `<div class="msg error"><p class="banner" role="alert">${esc(m.text)}</p></div>`;
  if (m.kind === "thinking")
    return `<div class="msg reply" id="${m.id}"><div class="thinking"><span class="dots"><i></i><i></i><i></i></span><span class="step">${esc(m.text)}</span></div></div>`;
  return `<div class="msg reply" id="${m.id || ""}">${formatReply(m.text)}${m.interrupted ? '<p class="interrupted">Reply stopped before it finished.</p>' : ""}</div>`;
}

function welcomeHTML() {
  const recent = chats.slice(0, 8);
  return `<section class="welcome">
    <h1>Who's <em>actually</em> right?</h1>
    <p>Add screenshots from both sides of a text argument, or paste the conversation. Arguably finds where it started, who made the stronger case, and every grudge, personal shot and logical fallacy. Then ask it anything about the argument.</p>
    <ol class="steps">
      <li><b>1</b><span>Tap the image button and pick your screenshots, oldest first.</span></li>
      <li><b>2</b><span>Add a line of background if it helps, then send.</span></li>
      <li><b>3</b><span>Ask follow-ups: who should apologize, what to say back, what you might be missing.</span></li>
    </ol>
    <button class="link-btn" id="exampleBtn" type="button">See an example verdict</button>
    ${
      recent.length
        ? `<div class="recent"><h2>Recent arguments</h2><ul>${recent
            .map((c) => {
              const v = verdictsOf(c).at(-1);
              const meta = v ? (v.winner?.is_draw ? "Even match" : `Winner: ${esc(v.winner?.name)}`) : `${c.messages.length} messages`;
              return `<li><button type="button" data-chat="${esc(c.id)}"><span class="r-title">${esc(c.title)}</span><span class="r-meta">${meta}</span></button></li>`;
            })
            .join("")}</ul></div>`
        : ""
    }
  </section>`;
}

function render() {
  const thread = $("thread");
  thread.innerHTML = chat?.messages.length ? chat.messages.map(messageHTML).join("") : welcomeHTML();
  renderSuggestions();
  renderComposer();
  requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
}

function renderSuggestions() {
  const box = $("suggestions");
  const last = chat?.messages.at(-1);
  const show = !busy && last?.kind === "verdict" && sampler;
  box.hidden = !show;
  box.innerHTML = show ? SUGGESTIONS.map((s) => `<button type="button" data-say="${esc(s)}">${esc(s)}</button>`).join("") : "";
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
      .join("") + (pending.length ? '<span class="attach-hint">Sent in this order. Add them oldest first.</span>' : "");
  const form = $("composer");
  form.classList.toggle("busy", !!busy);
  const hasInput = pending.length > 0 || $("messageInput").value.trim().length > 0;
  $("sendBtn").disabled = !busy && (!sampler || !hasInput);
  $("sendBtn").setAttribute("aria-label", busy ? "Stop" : "Send");
  $("attachBtn").classList.toggle("disabled", !sampler || !maxImages || !!busy);
  $("messageInput").placeholder = verdictsOf(chat).length
    ? "Ask about this argument"
    : maxImages
      ? "Add screenshots or paste the conversation"
      : "Paste the conversation as text";
  document.documentElement.style.setProperty("--composer-h", form.offsetHeight + "px");
}

function updateMessage(id, html) {
  const el = document.getElementById(id);
  if (el) el.outerHTML = html;
}

// ---------- screenshots ----------
async function fileToShot(file) {
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("decode"));
    el.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return { id: uid(), url: c.toDataURL("image/jpeg", 0.88) };
}

async function addFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
  if (!files.length || !maxImages) return;
  const limit = Math.min(MAX_IMAGES, maxImages);
  const room = limit - pending.length;
  if (room <= 0) return toast(`You can send up to ${limit} screenshots at a time.`);
  if (files.length > room) toast(`Added ${room}. The limit is ${limit} screenshots at a time.`);
  let failed = 0;
  for (const f of files.slice(0, room)) {
    try {
      pending.push(await fileToShot(f));
    } catch {
      failed++;
    }
    renderComposer();
  }
  if (failed) toast(`We couldn't open ${failed} image${failed > 1 ? "s" : ""}. Try PNG or JPEG.`);
}

// Claude sees images at about 1.2 megapixels, so tall screenshots are cut into
// overlapping slices to keep the text readable.
async function sliceShots(urls) {
  const load = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const imgs = await Promise.all(urls.map(load));
  const parts = imgs.map((im) => Math.max(1, Math.ceil(im.height / (im.width * 1.15))));
  while (parts.reduce((a, b) => a + b, 0) > maxImages && parts.some((p) => p > 1)) parts[parts.indexOf(Math.max(...parts))]--;
  const blobs = [];
  const labels = [];
  imgs.forEach((im, s) => {
    const n = parts[s];
    const overlap = n > 1 ? Math.round(im.width * 0.08) : 0;
    const step = Math.ceil(im.height / n);
    for (let p = 0; p < n; p++) {
      const y0 = Math.max(0, p * step - overlap);
      const y1 = Math.min(im.height, (p + 1) * step + overlap);
      const c = document.createElement("canvas");
      c.width = im.width;
      c.height = y1 - y0;
      c.getContext("2d").drawImage(im, 0, y0, im.width, c.height, 0, 0, im.width, c.height);
      blobs.push(new Promise((r) => c.toBlob(r, "image/jpeg", 0.9)));
      labels.push(
        n > 1
          ? `Image ${blobs.length}: screenshot ${s + 1}, part ${p + 1} of ${n} (top to bottom; slices overlap slightly)`
          : `Image ${blobs.length}: screenshot ${s + 1}`
      );
    }
  });
  return { blobs: await Promise.all(blobs), labels };
}

// ---------- talking to Claude ----------
function verdictPrompt({ labels, note, transcript, earlier }) {
  let p = SYSTEM_PROMPT;
  if (labels.length) p += "\n\nThe screenshots are attached as images, in this order:\n" + labels.join("\n");
  if (transcript) p += "\n\nThe conversation was pasted as text instead of screenshots:\n<conversation>\n" + transcript.slice(0, 40000) + "\n</conversation>";
  if (earlier) p += `\n\nThis chat already has an earlier verdict ("${earlier.title}"). If these screenshots continue that argument, judge the whole argument; otherwise judge them on their own.`;
  if (note) p += "\n\nMessage from the person who uploaded these (background, not evidence):\n" + note.slice(0, 2000);
  p += "\n\nReply with only one JSON object that matches this JSON Schema exactly (every key present, no extra keys):\n" + JSON.stringify(VERDICT_SCHEMA);
  return p;
}

const looksLikeVerdict = (v) => v && typeof v === "object" && v.winner && v.origin && Array.isArray(v.participants);

async function runVerdict({ shotUrls, note, transcript }) {
  const earlier = verdictsOf(chat).at(-1);
  const thinking = { id: uid(), role: "assistant", kind: "thinking", text: VERDICT_STEPS[0], transient: true };
  chat.messages.push(thinking);
  busy = { ctl: new AbortController(), kind: "verdict" };
  render();
  let step = 0;
  const timer = setInterval(() => {
    step = Math.min(step + 1, VERDICT_STEPS.length - 1);
    const el = document.querySelector(`#${thinking.id} .step`);
    if (el) el.textContent = VERDICT_STEPS[step];
  }, 6000);
  try {
    const { blobs, labels } = shotUrls.length ? await sliceShots(shotUrls) : { blobs: [], labels: [] };
    const opts = { modelTier: "complex", signal: busy.ctl.signal };
    if (blobs.length) opts.images = blobs;
    const verdict = await sampler.json(verdictPrompt({ labels, note, transcript, earlier }), opts);
    if (!looksLikeVerdict(verdict)) throw { code: "invalid_json" };
    for (const k of ["subjects", "grudges", "personal_shots", "fallacies"]) if (!Array.isArray(verdict[k])) verdict[k] = [];
    chat.messages = chat.messages.filter((m) => m !== thinking);
    chat.messages.push({ id: uid(), role: "assistant", kind: "verdict", verdict });
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
  const verdicts = verdictsOf(chat).slice(-3);
  const context =
    CHAT_RULES +
    (verdicts.length
      ? "\n\n" + verdicts.map((v, i) => `Verdict ${i + 1} (JSON):\n${JSON.stringify(v)}`).join("\n\n")
      : "\n\nNo verdict has been given yet.");
  let vCount = 0;
  const turns = [];
  for (const m of chat.messages) {
    if (m.transient || m.kind === "error" || m.kind === "thinking") continue;
    if (m.role === "user") {
      const shots = m.shotCount || m.shots?.length ? `(shared ${m.shotCount || m.shots.length} screenshots) ` : "";
      const content = (shots + (m.text || "")).trim();
      if (content) turns.push({ role: "user", content });
    } else if (m.kind === "verdict") {
      vCount++;
      const w = m.verdict.winner || {};
      turns.push({ role: "assistant", content: `I gave my verdict "${m.verdict.title}": ${w.is_draw ? "an even match" : `${w.name} made the stronger case`} (${w.confidence}% confidence). Full details are in the verdict JSON above.` });
    } else if (m.text) {
      turns.push({ role: "assistant", content: m.text });
    }
  }
  // Keep the request under the 64 KiB limit: drop the oldest turns, never the context.
  let recent = turns.slice(-24);
  while (recent.length > 1 && new TextEncoder().encode(context + JSON.stringify(recent)).length > 60000) recent = recent.slice(1);
  while (recent.length && recent[0].role !== "user") recent = recent.slice(1);
  return [{ role: "user", content: context }, ...recent];
}

async function runChat() {
  const reply = { id: uid(), role: "assistant", kind: "thinking", text: "Thinking", transient: true };
  chat.messages.push(reply);
  busy = { ctl: new AbortController(), kind: "chat" };
  render();
  let streamed = "";
  try {
    const { text, truncated } = await sampler(chatTurns(), {
      cache: false,
      signal: busy.ctl.signal,
      onText: ({ text }) => {
        streamed = text;
        updateMessage(reply.id, `<div class="msg reply" id="${reply.id}">${formatReply(text)}</div>`);
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

async function send(textOverride) {
  if (busy) return;
  if (!sampler) return;
  const input = $("messageInput");
  const text = (textOverride ?? input.value).trim();
  const shots = pending.map((p) => p.url);
  if (!text && !shots.length) return;
  ensureChat();
  // Drop stale error banners once the person tries again.
  chat.messages = chat.messages.filter((m) => m.kind !== "error");
  chat.messages.push({ id: uid(), role: "user", text, shots, shotCount: shots.length });
  pending = [];
  input.value = "";
  autosize();
  if (shots.length) return runVerdict({ shotUrls: shots, note: text });
  // A long paste before any verdict is treated as the conversation itself.
  if (!verdictsOf(chat).length && text.length >= 80) return runVerdict({ shotUrls: [], transcript: text });
  return runChat();
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
  if (files.length && maxImages && !busy) {
    e.preventDefault();
    addFiles(files);
  }
});
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer?.files?.length && !busy) addFiles(e.dataTransfer.files);
});
$("attachStrip").addEventListener("click", (e) => {
  const b = e.target.closest("[data-remove]");
  if (!b) return;
  pending = pending.filter((p) => p.id !== b.dataset.remove);
  renderComposer();
});
$("suggestions").addEventListener("click", (e) => {
  const b = e.target.closest("[data-say]");
  if (b) send(b.dataset.say);
});
$("thread").addEventListener("click", (e) => {
  if (e.target.closest("#exampleBtn")) {
    chat = {
      id: "example",
      example: true,
      title: SAMPLE_VERDICT.title,
      messages: [
        { id: uid(), role: "user", text: "Who's right here? We're roommates.", shotCount: 3 },
        { id: uid(), role: "assistant", kind: "verdict", verdict: SAMPLE_VERDICT },
      ],
    };
    render();
    return;
  }
  const open = e.target.closest("[data-chat]");
  if (open) {
    chat = chats.find((c) => c.id === open.dataset.chat) || null;
    render();
  }
});
$("newBtn").addEventListener("click", newChat);
$("homeBtn").addEventListener("click", newChat);
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
    notice.textContent = "Open Arguably on claude.ai while signed in to chat with it. You can still see the example verdict.";
    notice.hidden = false;
  } else if (!maxImages) {
    notice.textContent = "This view can't send screenshots to Claude. Paste the conversation as text instead.";
    notice.hidden = false;
  }
  render();
})();
