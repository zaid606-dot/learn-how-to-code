const MAX_IMAGES = 12;
const MAX_EDGE = 2000; // px, long edge after resize
const HISTORY_KEY = "arguably.history.v1";
const PALETTE = ["#ff5a5f", "#2ec4b6", "#ffc53d", "#a78bfa", "#60a5fa", "#f472b6"];
const LOADING_LINES = [
  "Reading the receipts…",
  "Figuring out who's who…",
  "Finding the spark…",
  "Digging up old grudges…",
  "Counting cheap shots…",
  "Checking for fallacies…",
  "Deliberating…",
];

const $ = (id) => document.getElementById(id);
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
  if (room <= 0) return showError(`That's the max: ${MAX_IMAGES} screenshots.`);
  if (files.length > room) toast(`Only added ${room}; max is ${MAX_IMAGES}.`);
  let failed = 0;
  for (const f of files.slice(0, room)) {
    try {
      shots.push(await fileToShot(f));
    } catch {
      failed++;
    }
    renderThumbs();
  }
  if (failed) showError(`${failed} image${failed > 1 ? "s" : ""} couldn't be read. Try PNG or JPEG.`);
}

function renderThumbs() {
  const wrap = $("thumbs");
  wrap.innerHTML = shots
    .map(
      (s, i) => `
      <div class="thumb" data-id="${s.id}">
        <img src="${s.url}" alt="Screenshot ${i + 1}">
        <span class="num">${i + 1}</span>
        <button class="remove" data-act="remove" aria-label="Remove screenshot ${i + 1}">×</button>
        <div class="order">
          <button data-act="left" aria-label="Move earlier" ${i === 0 ? "disabled" : ""}>←</button>
          <button data-act="right" aria-label="Move later" ${i === shots.length - 1 ? "disabled" : ""}>→</button>
        </div>
      </div>`
    )
    .join("");
  $("thumbHint").hidden = shots.length < 2;
  const btn = $("analyzeBtn");
  btn.disabled = shots.length === 0;
  btn.textContent = shots.length
    ? `Get the verdict · ${shots.length} screenshot${shots.length > 1 ? "s" : ""}`
    : "Add screenshots to start";
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
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    saveHistory(body.verdict);
    showVerdict(body.verdict);
  } catch (err) {
    show("upload");
    showError(err.message === "Failed to fetch" ? "No connection. Check your internet and try again." : err.message);
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
    showError("Couldn't load the example.");
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
        <span class="h-win">🏆 ${esc(h.verdict.winner?.is_draw ? "Draw" : h.verdict.winner?.name)}</span>
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
    return i === -1 ? "#9aa0ab" : PALETTE[i % PALETTE.length];
  };
}

function showVerdict(v) {
  currentVerdict = v;
  const color = colorMap(v);
  const person = (n) => `<span class="person"><span class="dot" style="background:${color(n)}"></span>${esc(n)}</span>`;
  const quote = (text, who) =>
    `<div class="quote" style="box-shadow: inset 3px 0 0 ${color(who)}">“${esc(text)}”</div>`;
  const sev = (s) => `<span class="sev ${esc(s)}">${esc(s)}</span>`;
  const empty = (msg) => `<p class="empty">${msg}</p>`;
  const w = v.winner || {};
  const scores = [...(w.scores || [])].sort((a, b) => b.score - a.score);
  const conf = Math.max(0, Math.min(100, Number(w.confidence) || 0));

  const sections = [
    {
      id: "verdict",
      label: "Verdict",
      html: `
        <section class="card winner-card" id="verdict">
          <div class="winner-head">
            <div class="ring" style="--p:${conf}" aria-label="${conf}% confidence"><span>${conf}%</span></div>
            <div>
              <div class="winner-label">${w.is_draw ? "It's a draw" : "🏆 Winner"}</div>
              <div class="winner-name">${esc(w.is_draw ? "Nobody won" : w.name)}</div>
            </div>
          </div>
          <p>${esc(w.reasoning)}</p>
          ${scores
            .map(
              (s) => `
            <div class="score">
              <div class="score-top">${person(s.participant)}<span>${Number(s.score) || 0}</span></div>
              <div class="bar"><i data-w="${Math.max(0, Math.min(100, Number(s.score) || 0))}" style="background:${color(s.participant)}"></i></div>
              <div class="proscons">
                <ul class="plus">${(s.strengths || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
                <ul class="minus">${(s.weaknesses || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
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
            <div class="label">The spark · ${person(v.origin?.spark_speaker)}</div>
            ${quote(v.origin?.spark_quote, v.origin?.spark_speaker)}
          </div>
          <div class="label">What it's really about</div>
          <p>${esc(v.origin?.root_cause)}</p>
          ${
            v.origin?.escalation_points?.length
              ? `<div class="label" style="margin-top:14px">How it escalated</div>
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
          <h2>Main subjects, compared</h2>
          ${
            (v.subjects || [])
              .map(
                (s) => `
            <div class="subject">
              <h3>${esc(s.topic)}<span class="edge">${s.edge && s.edge !== "Even" ? `Edge: ${esc(s.edge)}` : "Even"}</span></h3>
              <div class="positions">${(s.positions || [])
                .map(
                  (p) => `
                <div class="position" style="box-shadow: inset 3px 0 0 ${color(p.participant)}">
                  <div class="position-head">${person(p.participant)}<span class="strength ${esc(p.strength)}">${esc(p.strength)}</span></div>
                  ${esc(p.position)}
                </div>`
                )
                .join("")}</div>
            </div>`
              )
              .join("") || empty("No clear subjects found.")
          }
        </section>`,
    },
    {
      id: "names",
      label: "Names",
      count: v.participants?.length,
      html: `
        <section class="card" id="names">
          <h2>Who's in it</h2>
          <div class="names">${(v.participants || [])
            .map(
              (p) => `
            <div class="name-row">
              <div class="avatar" style="background:${color(p.name)}">${esc(String(p.name || "?").trim().charAt(0).toUpperCase())}</div>
              <div>
                <div><strong>${esc(p.name)}</strong> <span class="muted">· ${esc(p.overall_tone)}</span></div>
                <div class="src">${esc(sourceLabel(p.name_source))} — ${esc(p.evidence)}</div>
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
              .join("") || empty("No old grudges dragged in. Respect.")
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
              .join("") || empty("Clean fight. No personal shots.")
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
              <div class="item-head"><span class="fallacy-name">${esc(f.fallacy)}</span><span class="arrow">·</span>${person(f.speaker)}</div>
              ${quote(f.quote, f.speaker)}
              <p class="expl">${esc(f.explanation)}</p>
            </div>`
              )
              .join("") || empty("No fallacies spotted.")
          }
        </section>`,
    },
    {
      id: "takeaway",
      label: "Fix it",
      html: `
        <section class="card" id="takeaway">
          <h2>How to fix it</h2>
          <p class="takeaway">${esc(v.takeaway)}</p>
        </section>`,
    },
  ];

  const safety = v.safety_note?.trim()
    ? `<section class="card safety"><h2>A note from us</h2><p>${esc(v.safety_note)}</p></section>`
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
    `⚖️ ${v.title}`,
    w.is_draw ? "Verdict: Draw" : `🏆 Winner: ${w.name} (${w.confidence}% confident)`,
    w.reasoning,
    `Grudges: ${v.grudges?.length || 0} · Personal shots: ${v.personal_shots?.length || 0} · Fallacies: ${v.fallacies?.length || 0}`,
    "Judged by Arguably",
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
    toast("Verdict copied");
  } catch {
    toast("Couldn't share");
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
