/* Arguably screenshot pipeline: pure functions shared by the chat page and the tests.
 * Inlined into the Artifact page as a classic script; `module.exports` only exists under Node. */

// Lowercase, strip punctuation and emoji variation, collapse whitespace.
function normText(s) {
  return String(s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .replace(/'/g, "")
    .trim();
}

// 1 = identical, 0 = nothing in common (Levenshtein ratio, capped for speed).
function similarity(a, b) {
  a = a.slice(0, 400);
  b = b.slice(0, 400);
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

// Same message text, tolerating small differences from reading two different screenshots.
function sameMessage(a, b) {
  const x = normText(a);
  const y = normText(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) < 8) return false;
  // Allow the few character slips that come from reading two different screenshots.
  const edits = Math.round((1 - similarity(x, y)) * Math.max(x.length, y.length));
  return edits <= Math.max(2, Math.floor(0.08 * Math.max(x.length, y.length)));
}

// A single short match ("ok") is not enough to prove two screenshots overlap.
function strongRun(msgs) {
  return msgs.length >= 2 || normText(msgs[0]?.text).length >= 12;
}

// Join the slices of one screenshot, dropping a bubble that was read twice at a cut.
function joinSlices(msgs) {
  const out = [];
  for (const m of msgs) {
    const prev = out[out.length - 1];
    if (prev && prev.part !== m.part && prev.side === m.side) {
      const a = normText(prev.text);
      const b = normText(m.text);
      if (a && b && (a.includes(b) || b.includes(a) || sameMessage(prev.text, m.text))) {
        if (b.length > a.length) out[out.length - 1] = { ...m };
        continue;
      }
    }
    out.push(m);
  }
  return out;
}

// Group screenshots by the name in the chat header: one group per phone.
function phoneGroups(readings) {
  const groups = [];
  for (const r of readings) {
    const key = normText(r.header) || "unknown";
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, header: r.header || "", shots: [], them: "", me: "", isGroup: false };
      groups.push(g);
    }
    g.shots.push(r.n);
    if (r.isGroup) g.isGroup = true;
  }
  return groups;
}

// Best guess before the person confirms: on each phone the header names the other person.
function defaultMapping(groups, known = []) {
  const named = groups.filter((g) => g.header && !g.isGroup);
  for (const g of groups) {
    const prior = known.find((k) => k.key === g.key);
    if (prior) {
      g.them = prior.them;
      g.me = prior.me;
    }
  }
  if (named.length === 2) {
    const [a, b] = named;
    if (!a.me) a.me = b.header;
    if (!b.me) b.me = a.header;
  }
  for (const g of groups) {
    if (!g.them) g.them = g.isGroup ? "" : g.header || "Them";
    if (!g.me) g.me = "Me";
  }
  return groups;
}

function resolveSender(msg, group) {
  if (msg.side === "right") return group.me || "Me";
  if (msg.side === "center") return "";
  return (msg.sender_label || "").trim() || group.them || "Them";
}

// Merge `next` into `base`, using overlapping messages to line them up.
// Returns { merged, how } where how is "overlap" | "prepend" | "contained" | "gap".
function mergeSequences(base, next) {
  if (!base.length) return { merged: next.slice(), how: "overlap" };
  if (!next.length) return { merged: base.slice(), how: "contained" };
  const eq = (a, b) => sameMessage(a.text, b.text);
  const addShots = (keep, other) => {
    keep.shots = [...new Set([...(keep.shots || []), ...(other.shots || [])])];
  };

  // next sits entirely inside base (a duplicate or a screenshot of the same stretch)
  for (let i = 0; i + next.length <= base.length; i++) {
    if (next.every((m, j) => eq(base[i + j], m)) && strongRun(next)) {
      next.forEach((m, j) => addShots(base[i + j], m));
      return { merged: base.slice(), how: "contained" };
    }
  }
  const max = Math.min(base.length, next.length);
  // end of base overlaps the start of next
  for (let k = max; k >= 1; k--) {
    const tail = base.slice(-k);
    if (tail.every((m, j) => eq(m, next[j])) && strongRun(tail)) {
      tail.forEach((m, j) => addShots(m, next[j]));
      return { merged: base.concat(next.slice(k)), how: "overlap" };
    }
  }
  // end of next overlaps the start of base (screenshots imported out of order)
  for (let k = max; k >= 1; k--) {
    const head = base.slice(0, k);
    const tail = next.slice(-k);
    if (tail.every((m, j) => eq(m, head[j])) && strongRun(head)) {
      head.forEach((m, j) => addShots(m, tail[j]));
      return { merged: next.slice(0, -k).concat(base), how: "prepend" };
    }
  }
  return { merged: base.concat([{ kind: "gap", text: "", shots: [] }], next), how: "gap" };
}

// Resolve senders for each screenshot and merge them into one transcript.
function buildTranscript(readings, groups, existing = []) {
  let merged = existing.slice();
  for (const r of readings) {
    const g = groups.find((x) => x.shots.includes(r.n)) || { me: "Me", them: "Them" };
    const seq = r.msgs
      .filter((m) => m.side !== "center" && normText(m.text))
      .map((m) => ({ sender: resolveSender(m, g), text: String(m.text).trim(), time: m.time || "", kind: m.kind || "text", shots: [r.n], y: m.y }));
    merged = mergeSequences(merged, seq).merged;
  }
  // No gap marker at the very start or end, and never two in a row.
  merged = merged.filter((m, i, a) => !(m.kind === "gap" && (i === 0 || i === a.length - 1 || a[i - 1].kind === "gap")));
  let n = 0;
  for (const m of merged) if (m.kind !== "gap") m.id = "m" + ++n;
  return merged;
}

function transcriptText(messages) {
  return messages
    .map((m) =>
      m.kind === "gap"
        ? "[possible missing messages here: the screenshots on either side don't overlap]"
        : `[${m.id}] ${m.sender}${m.time ? ` (${m.time})` : ""}: ${m.text}`
    )
    .join("\n");
}

function verdictQuotes(v) {
  const o = v.origin || {};
  return [
    o.spark_quote,
    ...(o.escalation_points || []).map((e) => e.quote),
    ...(v.grudges || []).map((g) => g.evidence_quote),
    ...(v.personal_shots || []).map((s) => s.quote),
    ...(v.fallacies || []).map((f) => f.quote),
  ].filter((q) => typeof q === "string" && q.trim());
}

// Quotes in the verdict that can't be found in what was actually read.
function unverifiedQuotes(verdict, messages, raw) {
  const texts = (messages || []).filter((m) => m.kind !== "gap").map((m) => normText(m.text));
  const pairs = texts.slice(1).map((t, i) => texts[i] + " " + t);
  const rawNorm = raw ? normText(raw) : "";
  return verdictQuotes(verdict).filter((q) => {
    const nq = normText(q.replace(/\.\.\.|…/g, " "));
    if (!nq) return false;
    if (rawNorm && rawNorm.includes(nq)) return false;
    if (texts.some((t) => t.includes(nq) || (t.length >= 12 && nq.includes(t)) || (nq.length >= 8 && similarity(t, nq) >= 0.85))) return false;
    if (pairs.some((p) => p.includes(nq))) return false;
    return true;
  });
}

// Tesseract TSV -> text lines with position as % of the image: l/r = left/right edge, y = top.
function parseTsv(tsv, width, height) {
  const lines = new Map();
  for (const row of String(tsv || "").split("\n")) {
    const c = row.split("\t");
    if (c.length < 12) continue;
    const level = Number(c[0]);
    const key = c.slice(1, 5).join(".");
    const [left, top, w, h, conf] = [c[6], c[7], c[8], c[9], c[10]].map(Number);
    if (level === 4) lines.set(key, { l: left, t: top, r: left + w, h, words: [], confs: [] });
    if (level === 5 && c[11].trim() && lines.has(key)) {
      lines.get(key).words.push(c[11].trim());
      lines.get(key).confs.push(conf);
    }
  }
  const pct = (v, of) => Math.round((v / of) * 100);
  return [...lines.values()]
    .filter((x) => x.words.length)
    .map((x) => ({
      text: x.words.join(" "),
      l: pct(x.l, width),
      r: pct(x.r, width),
      y: pct(x.t, height),
      conf: Math.round(x.confs.reduce((a, b) => a + b, 0) / x.confs.length),
    }))
    .sort((a, b) => a.y - b.y || a.l - b.l);
}

// One screenshot's lines, compact enough to send many screenshots in one text-only request.
function ocrBlock(n, lines) {
  return `Screenshot ${n}:\n` + lines.map((x) => `y=${x.y} L=${x.l} R=${x.r}${x.conf < 50 ? " low" : ""} | ${x.text}`).join("\n");
}

if (typeof module !== "undefined") {
  module.exports = {
    normText, similarity, sameMessage, joinSlices, phoneGroups, defaultMapping,
    resolveSender, mergeSequences, buildTranscript, transcriptText, verdictQuotes, unverifiedQuotes, parseTsv, ocrBlock,
  };
}
