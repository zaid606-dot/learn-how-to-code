const MAX_IMAGES = 12;
const MAX_EDGE = 2000; // px, long edge after resize
const HISTORY_KEY = "arguably.history.v1";
// EMBER-derived person colors. `fg` is the text color used on top of `bg`.
const PALETTE = [
  { bg: "#9E321F", fg: "#FFFFFF" }, // ember-600
  { bg: "#1F1B1A", fg: "#FFFFFF" }, // ink-900
  { bg: "#266B8C", fg: "#FFFFFF" }, // info
  { bg: "#E7A18A", fg: "#24100E" }, // ember-300
  { bg: "#665B57", fg: "#FFFFFF" }, // ink-600
  { bg: "#A86112", fg: "#FFFFFF" }, // warning
];
const NEUTRAL = { bg: "#D8CBC3", fg: "#1F1B1A" };
const LOADING_LINES = [
  "Reading the screenshots",
  "Working out who's who",
  "Finding where it started",
  "Comparing each side",
  "Checking for grudges and personal shots",
  "Checking for logical fallacies",
  "Putting the verdict together",
];

const $ = (id) => document.getElementById(id);
const icon = (d) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  x: icon('<path d="M18 6 6 18M6 6l12 12"/>'),
  left: icon('<path d="M19 12H5M11 18l-6-6 6-6"/>'),
  right: icon('<path d="M5 12h14M13 6l6 6-6 6"/>'),
};
const views = { upload: $("uploadView"), loading: $("loadingView"), result: $("resultView") };

/** @type {{id: number, url: string, mediaType: string, data: string}[]} */
let shots = [];
let nextId = 1;
let currentVerdict = null;
let loadingTimer = null;

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function show(view) {
  for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
  window.scrollTo({ top: 0 });
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2200);
}

function storage(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// ---------- image intake ----------
async function fileToShot(file) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  let img = bitmap;
  if (!img) {
    // Fallback for browsers where createImageBitmap can't decode the file.
    img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode"));
      el.src = URL.createObjectURL(file);
    });
  }
  const w = img.width, h = img.height;
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  bitmap?.close?.();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
  return { id: nextId++, url: dataUrl, mediaType: "image/jpeg", data: dataUrl.split(",")[1] };
}

async function addFiles(fileList) {
  hideError();
  const files = [...fileList].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
  if (!files.length) return;
  const room = MAX_IMAGES - shots.length;
  if (room <= 0) return showError(`You've added the maximum of ${MAX_IMAGES} screenshots. Remove one to add another.`);
  if (files.length > room) toast(`Added ${room}. The limit is ${MAX_IMAGES} screenshots.`);
  let failed = 0;
  for (const f of files.slice(0, room)) {
    try {
      shots.push(await fileToShot(f));
    } catch {
      failed++;
    }
    renderThumbs();
  }
  if (failed) showError(`We couldn't open ${failed} image${failed > 1 ? "s" : ""}. Try saving as PNG or JPEG and add ${failed > 1 ? "them" : "it"} again.`);
}

function renderThumbs() {
  const wrap = $("thumbs");
  wrap.innerHTML = shots
    .map(
      (s, i) => `
      <div class="thumb" data-id="${s.id}">
        <img src="${s.url}" alt="Screenshot ${i + 1}">
        <span class="num">${i + 1}</span>
        <button class="remove" data-act="remove" aria-label="Remove screenshot ${i + 1}">${ICONS.x}</button>
        <div class="order">
          <button data-act="left" aria-label="Move screenshot ${i + 1} earlier" ${i === 0 ? "disabled" : ""}>${ICONS.left}</button>
          <button data-act="right" aria-label="Move screenshot ${i + 1} later" ${i === shots.length - 1 ? "disabled" : ""}>${ICONS.right}</button>
        </div>
      </div>`
    )
    .join("");
  $("thumbHint").hidden = shots.length < 2;
  const btn = $("analyzeBtn");
  btn.disabled = shots.length === 0;
  btn.textContent = shots.length
    ? `Get the verdict (${shots.length} screenshot${shots.length > 1 ? "s" : ""})`
    : "Add a screenshot to begin";
}

$("thumbs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = Number(btn.closest(".thumb").dataset.id);
  const i = shots.findIndex((s) => s.id === id);
  const act = btn.dataset.act;
  if (act === "remove") shots.splice(i, 1);
  if (act === "left" && i > 0) [shots[i - 1], shots[i]] = [shots[i], shots[i - 1]];
  if (act === "right" && i < shots.length - 1) [shots[i + 1], shots[i]] = [shots[i], shots[i + 1]];
  renderThumbs();
});

$("fileInput").addEventListener("change", async (e) => {
  await addFiles(e.target.files);
  e.target.value = "";
});

const dz = $("dropzone");
["dragenter", "dragover"].forEach((t) => dz.addEventListener(t, (e) => (e.preventDefault(), dz.classList.add("drag"))));
["dragleave", "drop"].forEach((t) => dz.addEventListener(t, () => dz.classList.remove("drag")));
dz.addEventListener("drop", (e) => {
  e.preventDefault();
  addFiles(e.dataTransfer.files);
});
document.addEventListener("paste", (e) => {
  if (views.upload.hidden) return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) addFiles(files);
});

function showError(msg) {
  const el = $("uploadError");
  el.textContent = msg;
  el.hidden = false;
}
function hideError() {
  $("uploadError").hidden = true;
}

// ---------- analysis ----------
async function analyze() {
  if (!shots.length) return;
  hideError();
  show("loading");
  let line = 0;
  $("loadingText").textContent = LOADING_LINES[0];
  loadingTimer = setInterval(() => {
    line = Math.min(line + 1, LOADING_LINES.length - 1);
    $("loadingText").textContent = LOADING_LINES[line];
  }, 4000);

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        images: shots.map(({ mediaType, data }) => ({ mediaType, data })),
        context: $("contextInput").value,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "We couldn't get a verdict this time. Try again.");
    saveHistory(body.verdict);
    showVerdict(body.verdict);
  } catch (err) {
    show("upload");
    showError(err.message === "Failed to fetch" ? "We couldn't reach Arguably. Check your connection and try again." : err.message);
  } finally {
    clearInterval(loadingTimer);
  }
}

$("analyzeBtn").addEventListener("click", analyze);

$("sampleBtn").addEventListener("click", async () => {
  try {
    const res = await fetch("/api/sample");
    showVerdict((await res.json()).verdict);
  } catch {
    showError("We couldn't load the example. Try again.");
  }
});

// ---------- history ----------
function loadHistory() {
  return storage(() => JSON.parse(localStorage.getItem(HISTORY_KEY)) || [], []);
}
function saveHistory(verdict) {
  const list = [{ at: Date.now(), verdict }, ...loadHistory()].slice(0, 10);
  storage(() => localStorage.setItem(HISTORY_KEY, JSON.stringify(list)));
  renderHistory();
}
function renderHistory() {
  const list = loadHistory();
  $("historySection").hidden = list.length === 0;
  $("historyList").innerHTML = list
    .map(
      (h, i) => `<li><button data-i="${i}">
        <span class="h-title">${esc(h.verdict.title)}</span>
        <span class="h-win">${h.verdict.winner?.is_draw ? "Even match" : `Winner: ${esc(h.verdict.winner?.name)}`}</span>
      </button></li>`
    )
    .join("");
}
$("historyList").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-i]");
  if (btn) showVerdict(loadHistory()[Number(btn.dataset.i)].verdict);
});

// ---------- verdict rendering ----------
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

function showVerdict(v) {
  currentVerdict = v;
  const color = colorMap(v);
  const person = (n) => `<span class="person"><span class="dot" style="background:${color(n).bg}"></span>${esc(n)}</span>`;
  const quote = (text, who) =>
    `<div class="quote" style="box-shadow: inset 3px 0 0 ${color(who).bg}">“${esc(text)}”</div>`;
  const tag = (value, labels) => `<span class="tag ${esc(value)}">${esc(labels[value] || value)}</span>`;
  const sev = (s) => tag(s, { low: "Low", medium: "Medium", high: "High" });
  const strength = (s) => tag(s, { strong: "Strong", mixed: "Mixed", weak: "Weak" });
  const empty = (msg) => `<p class="empty">${msg}</p>`;
  const w = v.winner || {};
  const scores = [...(w.scores || [])].sort((a, b) => b.score - a.score);
  const conf = Math.max(0, Math.min(100, Number(w.confidence) || 0));

  const sections = [
    {
      id: "verdict",
      label: "Verdict",
      html: `
        <section class="card winner-card reveal" id="verdict">
          <div class="winner-head">
            <div class="ring" style="--p:${conf}" role="img" aria-label="${conf}% confidence"><span>${conf}%</span></div>
            <div>
              <div class="winner-label">${w.is_draw ? "Even match" : "Winner"}</div>
              <div class="winner-name">${esc(w.is_draw ? "No clear winner" : w.name)}</div>
            </div>
          </div>
          <p>${esc(w.reasoning)}</p>
        </section>`,
    },
    {
      id: "scores",
      label: "Scores",
      html: `
        <section class="card" id="scores">
          <h2>Scorecard</h2>
          ${scores
            .map(
              (s) => `
            <div class="score">
              <div class="score-top">${person(s.participant)}<span class="score-num"><b>${Number(s.score) || 0}</b> / 100</span></div>
              <div class="bar"><i data-w="${Math.max(0, Math.min(100, Number(s.score) || 0))}" style="background:${color(s.participant).bg}"></i></div>
              <div class="proscons">
                <div><h4>Helped their case</h4><ul class="plus">${(s.strengths || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
                <div><h4>Hurt their case</h4><ul class="minus">${(s.weaknesses || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
              </div>
            </div>`
            )
            .join("")}
        </section>`,
    },
    {
      id: "origin",
      label: "Origin",
      html: `
        <section class="card" id="origin">
          <h2>Where it started</h2>
          <p>${esc(v.origin?.summary)}</p>
          <div class="spark">
            <div class="label">First message · ${person(v.origin?.spark_speaker)}</div>
            ${quote(v.origin?.spark_quote, v.origin?.spark_speaker)}
          </div>
          <div class="label">What it's really about</div>
          <p>${esc(v.origin?.root_cause)}</p>
          ${
            v.origin?.escalation_points?.length
              ? `<div class="label" style="margin-top:16px">How it escalated</div>
                 <ol class="timeline">${v.origin.escalation_points
                   .map((e) => `<li>${person(e.speaker)}${quote(e.quote, e.speaker)}<div class="why">${esc(e.why)}</div></li>`)
                   .join("")}</ol>`
              : ""
          }
        </section>`,
    },
    {
      id: "subjects",
      label: "Subjects",
      count: v.subjects?.length,
      html: `
        <section class="card" id="subjects">
          <h2>Main subjects compared</h2>
          ${
            (v.subjects || [])
              .map(
                (s) => `
            <div class="subject">
              <h3>${esc(s.topic)}</h3>
              <span class="edge">${s.edge && s.edge !== "Even" ? `Stronger case: ${esc(s.edge)}` : "Both sides even"}</span>
              <div class="positions">${(s.positions || [])
                .map(
                  (p) => `
                <div class="position" style="box-shadow: inset 3px 0 0 ${color(p.participant).bg}">
                  <div class="position-head">${person(p.participant)}${strength(p.strength)}</div>
                  ${esc(p.position)}
                </div>`
                )
                .join("")}</div>
            </div>`
              )
              .join("") || empty("We didn't find a clear subject in these screenshots.")
          }
        </section>`,
    },
    {
      id: "names",
      label: "Names",
      count: v.participants?.length,
      html: `
        <section class="card" id="names">
          <h2>People in this conversation</h2>
          <div class="names">${(v.participants || [])
            .map(
              (p) => `
            <div class="name-row">
              <div class="avatar" style="background:${color(p.name).bg};color:${color(p.name).fg}" aria-hidden="true">${esc(String(p.name || "?").trim().charAt(0).toUpperCase())}</div>
              <div>
                <div class="position-head"><strong>${esc(p.name)}</strong><span class="tag">${esc(sourceLabel(p.name_source))}</span></div>
                <div>${esc(p.overall_tone)}</div>
                <div class="src">${esc(p.evidence)}</div>
              </div>
            </div>`
            )
            .join("")}</div>
        </section>`,
    },
    {
      id: "grudges",
      label: "Grudges",
      count: v.grudges?.length || 0,
      html: `
        <section class="card" id="grudges">
          <h2>Grudges <span class="count-badge">${v.grudges?.length || 0}</span></h2>
          ${
            (v.grudges || [])
              .map(
                (g) => `
            <div class="item">
              <div class="item-head">${person(g.holder)}<span class="arrow">→</span>${person(g.target)}${sev(g.severity)}</div>
              <p>${esc(g.grudge)}</p>
              ${quote(g.evidence_quote, g.holder)}
            </div>`
              )
              .join("") || empty("No old grudges came up in this conversation.")
          }
        </section>`,
    },
    {
      id: "shots",
      label: "Personal shots",
      count: v.personal_shots?.length || 0,
      html: `
        <section class="card" id="shots">
          <h2>Personal shots <span class="count-badge">${v.personal_shots?.length || 0}</span></h2>
          ${
            (v.personal_shots || [])
              .map(
                (s) => `
            <div class="item">
              <div class="item-head">${person(s.from)}<span class="arrow">→</span>${person(s.to)}${sev(s.severity)}</div>
              ${quote(s.quote, s.from)}
              <p class="expl">${esc(s.why_its_personal)}</p>
            </div>`
              )
              .join("") || empty("No personal shots. Both sides stayed on the issue.")
          }
        </section>`,
    },
    {
      id: "fallacies",
      label: "Fallacies",
      count: v.fallacies?.length || 0,
      html: `
        <section class="card" id="fallacies">
          <h2>Logical fallacies <span class="count-badge">${v.fallacies?.length || 0}</span></h2>
          ${
            (v.fallacies || [])
              .map(
                (f) => `
            <div class="item">
              <span class="fallacy-name">${esc(f.fallacy)}</span>
              <div class="item-head">${person(f.speaker)}</div>
              ${quote(f.quote, f.speaker)}
              <p class="expl">${esc(f.explanation)}</p>
            </div>`
              )
              .join("") || empty("No logical fallacies found.")
          }
        </section>`,
    },
    {
      id: "takeaway",
      label: "Next step",
      html: `
        <section class="card takeaway-card" id="takeaway">
          <h2>How to move forward</h2>
          <p class="takeaway">${esc(v.takeaway)}</p>
        </section>`,
    },
  ];

  const safety = v.safety_note?.trim()
    ? `<section class="card safety" role="note"><h2>A note on safety</h2><p>${esc(v.safety_note)}</p></section>`
    : "";

  $("result").innerHTML = `<h1 class="result-title">${esc(v.title)}</h1>${safety}${sections.map((s) => s.html).join("")}`;
  $("chips").innerHTML = sections
    .map((s) => `<a href="#${s.id}">${esc(s.label)}${s.count != null ? `<span class="count">${s.count}</span>` : ""}</a>`)
    .join("");
  show("result");
  requestAnimationFrame(() =>
    requestAnimationFrame(() => document.querySelectorAll(".bar i").forEach((b) => (b.style.width = b.dataset.w + "%")))
  );
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

$("chips").addEventListener("click", (e) => {
  const a = e.target.closest("a");
  if (!a) return;
  e.preventDefault();
  document.querySelector(a.getAttribute("href"))?.scrollIntoView({ behavior: "smooth", block: "start" });
});

// ---------- share / reset ----------
function shareText(v) {
  const w = v.winner || {};
  return [
    v.title,
    w.is_draw ? "Verdict: even match" : `Winner: ${w.name} (${w.confidence}% confidence)`,
    w.reasoning,
    `Grudges: ${v.grudges?.length || 0} · Personal shots: ${v.personal_shots?.length || 0} · Fallacies: ${v.fallacies?.length || 0}`,
    "Reviewed with Arguably",
  ].join("\n\n");
}

$("shareBtn").addEventListener("click", async () => {
  if (!currentVerdict) return;
  const text = shareText(currentVerdict);
  if (navigator.share) {
    try {
      await navigator.share({ title: currentVerdict.title, text });
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("Verdict copied to clipboard.");
  } catch {
    toast("We couldn't share that. Try again.");
  }
});

function reset() {
  shots = [];
  $("contextInput").value = "";
  hideError();
  renderThumbs();
  renderHistory();
  show("upload");
}
$("newBtn").addEventListener("click", reset);
$("homeBtn").addEventListener("click", () => {
  renderHistory();
  show("upload");
});

renderThumbs();
renderHistory();
