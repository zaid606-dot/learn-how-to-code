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

// Words and numbers that flip or change a message's meaning. Fuzzy matching may forgive a
// reading slip, but never a difference in these ("did" vs "didn't", "at 5" vs "at 6").
const MEANING = /^(?:not|no|nope|never|nothing|nobody|none|nor|dont|didnt|doesnt|isnt|wasnt|arent|werent|cant|cannot|wont|wouldnt|shouldnt|couldnt|aint|havent|hasnt|hadnt|\d+\S*)$/;
function meaningWords(normalized) {
  return normalized.split(" ").filter((w) => MEANING.test(w)).sort().join(" ");
}
const sameMeaning = (x, y) => meaningWords(x) === meaningWords(y);

// Same message text, tolerating small differences from reading two different screenshots.
function sameMessage(a, b) {
  const x = normText(a);
  const y = normText(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) < 8) return false;
  if (!sameMeaning(x, y)) return false;
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
    // Only slices that were cut with an overlap can show the same bubble twice.
    if (prev && prev.part !== m.part && prev.side === m.side && m.overlapTop !== false) {
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
  // Two headers are the same contact when they differ by at most one misread letter.
  const sameName = (a, b) => a === b || (a.length >= 3 && b.length >= 3 && Math.round((1 - similarity(a, b)) * Math.max(a.length, b.length)) <= 1);
  const unheaded = [];
  for (const r of readings) {
    const key = normText(r.header);
    if (!key) {
      unheaded.push(r);
      continue;
    }
    let g = groups.find((x) => x.key !== "unknown" && sameName(x.key, key));
    if (!g) {
      g = { key, header: r.header || "", shots: [], them: "", me: "", isGroup: false, msgs: [] };
      groups.push(g);
    }
    g.shots.push(r.n);
    g.msgs.push(...(r.msgs || []));
    if (r.isGroup) g.isGroup = true;
  }
  // A screenshot with no header (cropped, or scrolled past it) belongs to the phone whose
  // messages it shares; only if it shares none does it get a group of its own.
  for (const r of unheaded) {
    const shared = (g) => (r.msgs || []).filter((m) => g.msgs.some((x) => x.side === m.side && sameMessage(x.text, m.text))).length;
    let best = null;
    for (const g of groups) if (shared(g) > (best ? shared(best) : 0)) best = g;
    if (!best) {
      best = groups.find((g) => g.key === "unknown");
      if (!best) groups.push((best = { key: "unknown", header: "", shots: [], them: "", me: "", isGroup: false, msgs: [] }));
    }
    best.shots.push(r.n);
    best.msgs.push(...(r.msgs || []));
    if (r.isGroup) best.isGroup = true;
  }
  for (const g of groups) delete g.msgs;
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
      continue;
    }
    // A new phone whose header is the person who owned an earlier phone: the earlier phone's
    // contact is this phone's owner ("Maya" on Jordan's phone, after Jordan on Maya's).
    const mirror = known.find((k) => k.me && normText(k.me) === g.key && k.them);
    if (mirror) {
      g.me = mirror.them;
      g.them = mirror.me;
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
// A bubble cut off at a screenshot's edge shows only part of its text. Across the overlap of
// two screenshots, the first message of the lower one may be the end of a longer message, and
// the last message of the upper one may be the start of one.
function isCutPart(part, whole, where) {
  const p = normText(part);
  const w = normText(whole);
  if (!p || !w || p === w || p.length < 6 || p.length >= w.length) return false;
  return where === "end" ? w.endsWith(p) : w.startsWith(p);
}
function mergeSequences(base, next) {
  if (!base.length) return { merged: next.slice(), how: "overlap" };
  if (!next.length) return { merged: base.slice(), how: "contained" };
  const eq = (a, b) => a.kind !== "gap" && b.kind !== "gap" && sameMessage(a.text, b.text);
  const addShots = (keep, other) => {
    keep.shots = [...new Set([...(keep.shots || []), ...(other.shots || [])])];
    // Keep the complete text when one screenshot showed the bubble cut off.
    if (normText(other.text).length > normText(keep.text).length && (isCutPart(keep.text, other.text, "end") || isCutPart(keep.text, other.text, "start"))) keep.text = other.text;
  };
  // Overlap of upper = [..., u] and lower = [l, ...] where upper's tail lines up with lower's head.
  // The block's first pair may have the lower one cut at its top; its last pair may have the
  // upper one cut at its bottom.
  const lines = (upperTail, lowerHead) =>
    upperTail.every((u, j) => {
      const l = lowerHead[j];
      if (eq(u, l)) return true;
      if (j === 0 && isCutPart(l.text, u.text, "end")) return true;
      if (j === upperTail.length - 1 && isCutPart(u.text, l.text, "start")) return true;
      return false;
    });
  const strong = (run) => strongRun(run.filter((m) => normText(m.text).length >= 6)) || run.length >= 2;

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
    if (lines(tail, next.slice(0, k)) && strong(tail)) {
      tail.forEach((m, j) => addShots(m, next[j]));
      return { merged: base.concat(next.slice(k)), how: "overlap" };
    }
  }
  // end of next overlaps the start of base (screenshots imported out of order)
  for (let k = max; k >= 1; k--) {
    const head = base.slice(0, k);
    const tail = next.slice(-k);
    if (lines(tail, head) && strong(head)) {
      head.forEach((m, j) => addShots(m, tail[j]));
      return { merged: next.slice(0, -k).concat(base), how: "prepend" };
    }
  }
  return { merged: base.concat([{ kind: "gap", text: "", shots: [] }], next), how: "gap" };
}

// Stitch the pieces between gap markers together wherever they overlap, whatever order the
// screenshots came in. Pieces that match nothing stay separated by a gap.
function stitchSegments(merged) {
  const segs = [];
  let cur = [];
  for (const m of merged) {
    if (m.kind === "gap") {
      if (cur.length) segs.push(cur);
      cur = [];
    } else cur.push(m);
  }
  if (cur.length) segs.push(cur);
  for (let changed = true; changed && segs.length > 1; ) {
    changed = false;
    outer: for (let i = 0; i < segs.length; i++) {
      for (let j = 0; j < segs.length; j++) {
        if (i === j) continue;
        const r = mergeSequences(segs[i], segs[j]);
        if (r.how !== "gap") {
          segs[i] = r.merged;
          segs.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  return segs.flatMap((sg, i) => (i ? [{ kind: "gap", text: "", shots: [] }, ...sg] : sg));
}

// Resolve senders for each screenshot and merge them into one transcript.
function buildTranscript(readings, groups, existing = []) {
  let merged = existing.map((m) => ({ ...m }));
  for (const r of readings) {
    const g = groups.find((x) => x.shots.includes(r.n)) || { me: "Me", them: "Them" };
    const seq = r.msgs
      .filter((m) => m.side !== "center" && normText(m.text))
      .map((m) => ({ sender: resolveSender(m, g), text: String(m.text).trim(), time: m.time || "", kind: m.kind || "text", shots: [r.n], y: m.y }));
    merged = mergeSequences(merged, seq).merged;
  }
  merged = stitchSegments(merged);
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
  return quotesWithSpeakers(v).map((x) => x.quote);
}
// Each quote with the person the verdict says wrote it ("" when it doesn't say).
function quotesWithSpeakers(v) {
  const o = v.origin || {};
  return [
    { quote: o.spark_quote, who: o.spark_speaker },
    ...(o.escalation_points || []).map((e) => ({ quote: e.quote, who: e.speaker })),
    ...(v.grudges || []).map((g) => ({ quote: g.evidence_quote, who: g.holder })),
    ...(v.personal_shots || []).map((s) => ({ quote: s.quote, who: s.from })),
    ...(v.fallacies || []).map((f) => ({ quote: f.quote, who: f.speaker })),
  ]
    .filter((x) => typeof x.quote === "string" && x.quote.trim())
    .map((x) => ({ quote: x.quote, who: typeof x.who === "string" ? x.who.trim() : "" }));
}

// A quote's identity for marking it in the verdict: the same words attributed to two people
// are two different claims.
const quoteKey = (who, quote) => `${normText(who)}\u0000${quote}`;
// "Maya (you)" and "Maya" are the same person; "you"/"me" can't be checked.
const speakerOf = (who) => normText(String(who || "").replace(/\([^)]*\)/g, ""));

// Pasted conversations as messages when they're written "Name: text", one per line.
function pastedMessages(raw) {
  const out = [];
  for (const line of String(raw || "").split(/\n+/)) {
    const m = line.match(/^\s*([^:\n]{1,30}):\s*(.+)$/);
    if (m) out.push({ sender: m[1].trim(), text: m[2] });
    else if (out.length && line.trim()) out[out.length - 1].text += " " + line.trim();
  }
  return out;
}

// Quotes in the verdict that can't be found in what was actually read, or that are pinned on
// the wrong person. A quote may trim a message (and skip words with "..."), but not add to it
// or change its meaning. Returns quoteKey(who, quote) for each one.
function unverifiedQuotes(verdict, messages, raw) {
  const fromScreens = (messages || []).filter((m) => m.kind !== "gap");
  const pasted = pastedMessages(raw);
  const all = [...fromScreens, ...pasted].map((m) => ({ text: normText(m.text), sender: speakerOf(m.sender || "") }));
  const pairs = all.slice(1).map((t, i) => ({ text: all[i].text + " " + t.text, senders: [all[i].sender, t.sender] }));
  // Unstructured paste: only a whole-word match anywhere will do, with no speaker check.
  const loose = pasted.length ? "" : raw ? ` ${normText(raw)} ` : "";
  const bad = new Set();
  const contains = (hay, piece) => ` ${hay} `.includes(` ${piece} `);
  // The quote's pieces (split at "...") appear in order, as whole words, in this text.
  const inOrder = (hay, pieces) => {
    let at = 0;
    const padded = ` ${hay} `;
    for (const p of pieces) {
      const i = padded.indexOf(` ${p} `, at);
      if (i < 0) return false;
      at = i + p.length + 1;
    }
    return true;
  };
  for (const { quote, who } of quotesWithSpeakers(verdict)) {
    const pieces = quote.split(/\.\.\.|…/).map(normText).filter(Boolean);
    const nq = pieces.join(" ");
    if (!nq) continue;
    if (loose && inOrder(loose.trim(), pieces)) continue;
    const fits = (t) =>
      inOrder(t, pieces) ||
      (pieces.length === 1 && t.length >= 12 && contains(nq, t) && nq.length <= t.length * 1.15 + 3) ||
      (pieces.length === 1 && nq.length >= 8 && similarity(t, nq) >= 0.85 && sameMeaning(t, nq));
    const hits = all.filter((m) => fits(m.text));
    // A quote spanning two messages in a row counts only when no single message holds it.
    const pairHits = hits.length ? [] : pairs.filter((p) => inOrder(p.text, pieces));
    if (!hits.length && !pairHits.length) {
      bad.add(quoteKey(who, quote));
      continue;
    }
    // Found, but written by someone else: a misattributed quote is flagged too.
    const w = speakerOf(who);
    if (!w || w === "you" || w === "me") continue;
    const senders = [...hits.map((m) => m.sender), ...pairHits.flatMap((p) => p.senders)].filter(Boolean);
    if (senders.length && !senders.includes(w)) bad.add(quoteKey(who, quote));
  }
  return [...bad];
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
  const pct = (v, of) => Math.round((v / of) * 1000) / 10; // one decimal: tall screenshots need it
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

// ---------- sorting OCR lines into messages, on the device ----------

// Fix the usual OCR slips in one line without changing the wording.
function cleanOcr(text) {
  return String(text || "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/(^|\s)\|(?=['\s]|$)/g, "$1I") // a lone "|" is "I" ("| have", "|'m")
    .replace(/(^|\s)0[kK](?=\W|$)/g, "$1Ok")
    .replace(/^(?:[©®@°•·«»~*_=+\\/–—-]+\s+)+/, "") // stray symbols before the first word
    .replace(/\s+[©®°•«»~_=]+$/, "") // and after the last one
    .replace(/\s+/g, " ")
    .trim();
}

const OCR_TIME = /\b\d{1,2}[:.]\d{2}(?:\s?[ap]\.?m\.?)?(?=\W|$)/i;
const OCR_DAY = /^(?:today|yesterday|(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)\b/i;
// Labels under or beside bubbles that are not messages.
const OCR_LABEL = /^(?:delivered|read|seen|sent|edited|not delivered|kept|replies|reply|\d+ repl(?:y|ies)|(?:read|seen|delivered|edited) (?:by |at |on |\d|today|yesterday).{0,30}|tap to (?:load|retry|download).*|\+?\d{1,3})$/i;
// Presence lines under a WhatsApp/Instagram/Messenger header.
const OCR_PRESENCE = /^(?:online|typing\.*|last seen .*|active (?:now|\d.*|today|yesterday)|tap here for .*|click here for .*)$/i;
// The typing bar at the bottom of the screen.
const OCR_INPUT = /^(?:i?message|text message|type a message|message\.*|send a message)$/i;
const OCR_NOT_NAMES = new Set("ok okay k kk yes yeah yep ya yea no nope nah lol lmao omg what why how who when where sure thanks thank thx hi hey hello bye fine true same wait bro dude hm hmm and but so".split(" "));

// "Today 9:58 AM", "Sat, Sep 20 at 9:58 PM", "9:58 PM", "Yesterday", "12/09/2026"
function isTimestamp(t) {
  const s = t.replace(/[,·•]/g, " ").replace(/\s+/g, " ").trim();
  if (!s || s.length > 32 || s.split(" ").length > 6) return false;
  if (/^\d{1,2}[:.]\d{2}(?:\s?[ap]\.?m\.?)?$/i.test(s)) return true;
  if (/^(?:today|yesterday|(?:mon|tues|wednes|thurs|fri|satur|sun)day)$/i.test(s)) return true;
  return OCR_DAY.test(s) && /\d/.test(s);
}

// Letters make up most of a well-read line; OCR noise is mostly symbols.
function ocrGarbled(t) {
  const chars = t.replace(/\s/g, "");
  const letters = (t.match(/\p{L}/gu) || []).length;
  const odd = (t.match(/[^\p{L}\p{N}\s'",.?!:;()&%$\-]/gu) || []).length;
  return !letters || letters / chars.length < 0.55 || odd / chars.length > 0.2;
}

const ocrCentered = (x) => x.l >= 18 && x.r <= 82 && Math.abs((x.l + x.r) / 2 - 50) <= 9;
// The phone's status bar: the clock (and carrier, battery) along the very top.
const ocrStatusBar = (x) => x.y <= 6 && OCR_TIME.test(x.text) && x.text.length <= 30;
// Closer to the left edge than to the right: a received bubble (or a short wrapped line).
const ocrLeftish = (x) => x.l < 100 - x.r;

// The top of a screenshot: status bar, header, presence line. Returns the header and the y
// below which the messages start. Lines are already cleaned.
function ocrTop(lines) {
  const plain = (t) => t.replace(/\s*[>›»]+\s*$/, "").replace(/^[<‹«←]+\s*\d*\s*/, "").trim();
  for (const x of lines) {
    if (x.y > 22 || ocrStatusBar(x)) continue;
    const t = plain(x.text);
    if (!/\p{L}/u.test(t) || t.length > 40 || isTimestamp(t) || OCR_LABEL.test(t)) continue;
    // iMessage, Instagram, Messenger: the name is centered, often with a ">" after it.
    if (ocrCentered(x) && (x.y <= 18 || /[>›]$/.test(x.text))) return { header: t, below: x.y };
    // WhatsApp and others: left-aligned after a back arrow, or with "online" under it.
    const next = lines.find((z) => z.y > x.y && z.y - x.y <= 5);
    const presence = next && OCR_PRESENCE.test(next.text);
    if (x.y <= 14 && (/^[<‹«←]/.test(x.text) || presence)) return { header: t, below: presence ? next.y : x.y };
    // Instagram: "alex.k ›" beside the back arrow; the chevron marks the tappable header.
    if (x.y <= 14 && /[>›]$/.test(x.text) && t.length <= 30) return { header: t, below: x.y };
    // The back arrow itself is often not read at all, leaving a lone name high on the left.
    if (x.y <= 12 && x.r <= 60 && looksLikeName(t) && lines.some((z) => ocrStatusBar(z) && z.y < x.y)) return { header: t, below: x.y };
  }
  const bar = lines.filter(ocrStatusBar);
  return { header: "", below: bar.length ? Math.max(...bar.map((x) => x.y)) : -1 };
}

// The chat's name from the header at the top of a screenshot, "" when none is visible.
function headerOf(lines) {
  return ocrTop(lines.map((x) => ({ ...x, text: cleanOcr(x.text) }))).header;
}

// A short line that could be a contact name above a received bubble ("Jason", "Mom", "Sarah K.").
function looksLikeName(t) {
  if (t.length > 24 || /[?!,:;]$/.test(t) || /\d/.test(t)) return false;
  if (!/^\p{Lu}[\p{L}'.-]*(?: \p{L}[\p{L}'.-]*){0,2}$/u.test(t)) return false;
  return !OCR_NOT_NAMES.has(t.split(" ")[0].toLowerCase().replace(/[^a-z]/g, ""));
}

function quantile(xs, q) {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

// One screenshot's lines (from parseTsv) -> its messages, top to bottom, in the reading format.
// Received bubbles hug the left edge, sent ones the right. The lines of one bubble share a left
// edge and sit one line-spacing apart; that spacing is measured from the screenshot itself.
function linesToMessages(lines) {
  const all = (lines || [])
    .map((x) => ({ ...x, raw: String(x.text || ""), text: cleanOcr(x.text) }))
    .filter((x) => x.text)
    .sort((a, b) => a.y - b.y || a.l - b.l);
  const { below } = ocrTop(all);
  const body = all.filter((x) => x.y > below && !ocrStatusBar(x) && !(x.y >= 80 && OCR_INPUT.test(x.text)));
  if (!body.length) return [];

  // Usual spacing between two lines of one bubble: the smallest gaps between lines sharing a left edge.
  const gaps = [];
  for (let i = 1; i < body.length; i++) {
    const g = body[i].y - body[i - 1].y;
    if (g > 0 && Math.abs(body[i].l - body[i - 1].l) <= 3) gaps.push(g);
  }
  const q = quantile(gaps, 0.25);
  const small = gaps.filter((g) => g <= q * 1.5);
  const pitch = gaps.length >= 3 ? small.reduce((a, b) => a + b, 0) / small.length : 3;
  const near = Math.max(pitch * 1.5, pitch + 1); // one line further down, allowing for rounding

  // Group chats put the sender's avatar beside a bubble's last line; OCR reads it as a stray
  // character or two well left of the text column. Find that column pair, if there is one:
  // most lines at the avatar's edge must sit just under a line in the text column.
  const lefts = [...new Set(body.filter((x) => ocrLeftish(x) && !ocrCentered(x)).map((x) => x.l))].sort((a, b) => a - b);
  let column = null;
  for (let i = 1; i < lefts.length && column == null; i++) {
    if (lefts[i - 1] > 8 || lefts[i] > 25 || lefts[i] - lefts[i - 1] < 6) continue;
    const col = lefts[i];
    const cands = body.filter((x) => ocrLeftish(x) && x.l <= lefts[i - 1]);
    const under = cands.filter((x) => {
      const j = body.indexOf(x);
      return j > 0 && x.y - body[j - 1].y <= near && Math.abs(body[j - 1].l - col) <= 3;
    });
    if (under.length * 2 >= cands.length) column = quantile(body.filter((x) => Math.abs(x.l - col) <= 3).map((x) => x.l), 0.5);
  }
  if (column != null) {
    for (const x of body) {
      if (x.l >= column - 5 || !ocrLeftish(x)) continue;
      // Drop the avatar's stray characters, then place the line in the text column.
      const words = x.raw.trim().split(/\s+/);
      x.text = cleanOcr(words.length > 1 && words[0].length <= 3 ? words.slice(1).join(" ") : x.raw).replace(/^[^\p{L}\p{N}"'(]+/u, "");
      x.l = column;
      x.avatar = true;
    }
  }
  const rows = body.filter((x) => x.text);

  const nameAt = (i) => {
    const x = rows[i];
    const next = rows[i + 1];
    return !x.avatar && ocrLeftish(x) && !ocrCentered(x) && looksLikeName(x.text) && !!next && ocrLeftish(next) &&
      next.y - x.y <= near && Math.abs(next.l - x.l) <= 3;
  };

  const msgs = [];
  let cur = null; // the bubble being read: { msg, l, lastY, closed }
  let name = ""; // a sender name waiting for its bubble
  let time = ""; // a timestamp row waiting for the next message
  let run = null; // the last received bubble, while its sender's run may continue
  for (let i = 0; i < rows.length; i++) {
    const x = rows[i];
    // "Read", "Seen" or a number under a bubble is a label, unless it's the wrapped last line of
    // that bubble ("the worst movie I've ever / seen"), or a number sent on its own ("5").
    const continues = cur && !cur.closed && x.y - cur.lastY <= near && Math.abs(x.l - cur.l) <= 3;
    const loneNumber = /^\+?\d{1,3}$/.test(x.text) && (!rows[i - 1] || x.y - rows[i - 1].y > near * 1.5);
    if (OCR_LABEL.test(x.text) && !continues && !loneNumber) {
      cur = null;
      continue;
    }
    if (cur && !cur.closed && x.y - cur.lastY <= near && Math.abs(x.l - cur.l) <= 3 && !nameAt(i)) {
      // A time on its own line inside a bubble (WhatsApp) belongs to the message, not its text.
      if (isTimestamp(x.text) && OCR_TIME.test(x.text)) cur.msg.time = cur.msg.time || x.text;
      else cur.msg.text += " " + x.text;
      cur.lastY = x.y;
      if (x.avatar) cur.closed = true; // the avatar marks the last bubble of a run
      continue;
    }
    cur = null;
    // A wide first line of a sent bubble can sit near the middle; the bubble's next line
    // shares its left edge, which a centered system line or timestamp doesn't have.
    const next = rows[i + 1];
    const opensBubble = next && next.y - x.y <= near && Math.abs(next.l - x.l) <= 3 && !isTimestamp(x.text);
    if (ocrCentered(x) && !x.avatar && !opensBubble) {
      if (isTimestamp(x.text)) time = x.text;
      else msgs.push({ side: "center", sender_label: "", text: x.text, time: "", kind: "system", partial: false, y: x.y, part: 1 });
      run = null;
      continue;
    }
    if (nameAt(i)) {
      name = x.text;
      continue;
    }
    const side = x.avatar || ocrLeftish(x) ? "left" : "right";
    // Group chats name only the first bubble of a run from one sender.
    const label = side === "left" ? name || (run && !run.closed ? run.msg.sender_label : "") : "";
    const msg = { side, sender_label: label, text: x.text, time, kind: "text", partial: false, y: x.y, part: 1 };
    msgs.push(msg);
    cur = { msg, l: x.l, lastY: x.y, closed: !!x.avatar };
    run = side === "left" ? cur : null;
    name = "";
    time = "";
  }
  return msgs.filter((m) => normText(m.text));
}

// How well one screenshot read. `poor` means Claude should take a second look at its lines.
function readingQuality(lines, msgs) {
  const texts = (lines || []).filter((x) => String(x.text || "").trim());
  const count = (msgs || []).filter((m) => m.side !== "center").length;
  if (!texts.length) return { conf: 0, garbled: 0, lines: 0, messages: count, poor: false, reason: "empty" };
  let weight = 0;
  let sum = 0;
  for (const x of texts) {
    weight += x.text.length;
    sum += x.text.length * (Number(x.conf) || 0);
  }
  const conf = Math.round(sum / weight);
  const garbled = texts.filter((x) => ocrGarbled(cleanOcr(x.text) || x.text)).length / texts.length;
  let reason = "";
  if (conf < 60) reason = "low confidence";
  else if (garbled > 0.3) reason = "garbled";
  else if (texts.length >= 8 && count <= 1) reason = "few messages";
  return { conf, garbled: Math.round(garbled * 100) / 100, lines: texts.length, messages: count, poor: !!reason, reason };
}

// Claude's compact second look at poorly read screenshots ("n|H|header", "n|R|label|time|text")
// -> Map of screenshot number -> { header, msgs }. Screenshots it didn't answer for are absent.
function parseOcrReply(text) {
  const out = new Map();
  for (const row of String(text || "").split("\n")) {
    const c = row.trim().split("|");
    const n = Number(c[0]);
    if (c.length < 3 || !c[0].trim() || !Number.isInteger(n)) continue;
    const tag = c[1].trim().toUpperCase();
    if (!out.has(n)) out.set(n, { header: "", msgs: [] });
    const r = out.get(n);
    if (tag === "H") {
      r.header = c.slice(2).join("|").trim();
      continue;
    }
    const side = { R: "right", L: "left", C: "center" }[tag];
    const body = c.slice(4).join("|").trim();
    if (!side || c.length < 5 || !body) continue;
    r.msgs.push({
      side, sender_label: side === "left" ? c[2].trim() : "", text: body, time: c[3].trim(),
      kind: side === "center" ? "system" : "text", partial: false, y: r.msgs.length, part: 1,
    });
  }
  return out;
}

// Makes a verdict from the model safe to render: every list is a list, every name a string.
// Returns null when there's no usable winner, so the caller can treat it as a bad reply.
function normalizeVerdict(v) {
  if (!v || typeof v !== "object" || !v.winner || typeof v.winner !== "object" || !v.origin || typeof v.origin !== "object") return null;
  const objs = (x) => (Array.isArray(x) ? x.filter((i) => i && typeof i === "object" && !Array.isArray(i)) : []);
  const str = (x) => (typeof x === "string" ? x : typeof x === "number" ? String(x) : "");
  const strs = (x) => (Array.isArray(x) ? x.filter((i) => typeof i === "string") : []);
  // Clean the named text fields of an object in place.
  const clean = (o, keys) => {
    for (const k of keys) o[k] = str(o[k]);
    return o;
  };
  v.title = str(v.title).trim() || "Verdict";
  v.takeaway = str(v.takeaway);
  v.safety_note = str(v.safety_note);
  v.participants = objs(v.participants).map((p) => clean({ ...p, name: str(p.name).trim() || "Someone" }, ["name_source", "evidence", "overall_tone"]));
  clean(v.origin, ["summary", "spark_quote", "spark_speaker", "root_cause"]);
  v.origin.escalation_points = objs(v.origin.escalation_points).map((e) => clean(e, ["speaker", "quote", "why"]));
  v.subjects = objs(v.subjects).map((sj) => ({ ...clean(sj, ["topic", "edge"]), positions: objs(sj.positions).map((ps) => clean(ps, ["participant", "position", "strength"])) }));
  v.grudges = objs(v.grudges).map((g) => clean(g, ["holder", "target", "grudge", "evidence_quote", "severity"]));
  v.personal_shots = objs(v.personal_shots).map((x) => clean(x, ["from", "to", "quote", "why_its_personal", "severity"]));
  v.fallacies = objs(v.fallacies).map((f) => clean(f, ["speaker", "fallacy", "quote", "explanation"]));
  const w = v.winner;
  w.is_draw = w.is_draw === true;
  w.name = str(w.name).trim();
  w.reasoning = str(w.reasoning);
  // A safety note is never thrown away: that verdict is shown without a winner or scores.
  if (v.safety_note.trim()) {
    w.is_draw = true;
    w.name = "";
    w.confidence = 0;
  }
  if (!w.is_draw && !w.name) return null;
  const n = Number(w.confidence);
  w.confidence = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 50;
  w.scores = objs(w.scores).map((sc) => {
    const score = Number(sc.score);
    return { ...sc, participant: str(sc.participant), score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0, strengths: strs(sc.strengths), weaknesses: strs(sc.weaknesses) };
  });
  return v;
}

if (typeof module !== "undefined") {
  module.exports = {
    normText, similarity, sameMessage, joinSlices, phoneGroups, defaultMapping,
    resolveSender, mergeSequences, buildTranscript, transcriptText, verdictQuotes, unverifiedQuotes, parseTsv, ocrBlock,
    cleanOcr, headerOf, linesToMessages, readingQuality, parseOcrReply, normalizeVerdict, quoteKey, sameMeaning,
  };
}
