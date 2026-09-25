import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const P = require("../artifact/pipeline.cjs");

const msg = (side, text, extra = {}) => ({ side, text, kind: "text", ...extra });

test("sameMessage tolerates small reading differences but not short collisions", () => {
  assert.ok(P.sameMessage("You said you'd do the dishes last night?", "You said youd do the dishes last night"));
  assert.ok(P.sameMessage("Ok and you left your laundry in the dryer for 3 days so", "Ok and you left your laundry in the drier for 3 days so"));
  assert.ok(!P.sameMessage("ok", "no"));
  assert.ok(!P.sameMessage("I'll do them tonight", "You never do them at all"));
});

test("joinSlices drops a bubble read twice across a cut", () => {
  const out = P.joinSlices([
    msg("left", "First", { part: 1 }),
    msg("right", "This is literally the same", { part: 1 }),
    msg("right", "This is literally the same thing that happened in March", { part: 2 }),
    msg("left", "Wow ok", { part: 2 }),
  ]);
  assert.deepEqual(out.map((m) => m.text), ["First", "This is literally the same thing that happened in March", "Wow ok"]);
});

test("defaultMapping infers each phone's owner from the other phone's header", () => {
  const groups = P.defaultMapping(P.phoneGroups([
    { n: 1, header: "Jordan" },
    { n: 2, header: "Maya 🌻" },
    { n: 3, header: "Jordan" },
  ]));
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].shots, [1, 3]);
  assert.equal(groups[0].them, "Jordan");
  assert.equal(groups[0].me, "Maya 🌻");
  assert.equal(groups[1].me, "Jordan");
});

test("defaultMapping falls back to Me/Them and reuses confirmed names", () => {
  const g = P.defaultMapping(P.phoneGroups([{ n: 1, header: "" }]));
  assert.equal(g[0].them, "Them");
  assert.equal(g[0].me, "Me");
  const g2 = P.defaultMapping(P.phoneGroups([{ n: 4, header: "Jordan" }]), [{ key: "jordan", them: "Jordan", me: "Maya" }]);
  assert.equal(g2[0].me, "Maya");
});

test("both phones merge into one transcript with the right senders and no duplicates", () => {
  // Maya's phone: header "Jordan"; Maya is on the right.
  const mayaPhone = { n: 1, header: "Jordan", msgs: [
    msg("right", "You said you'd do the dishes last night?"),
    msg("left", "Ok and you left your laundry in the dryer for 3 days so"),
    msg("right", "This is literally the same thing that happened in March"),
  ] };
  // Jordan's phone: header "Maya"; Jordan is on the right; overlaps and continues.
  const jordanPhone = { n: 2, header: "Maya", msgs: [
    msg("right", "Ok and you left your laundry in the dryer for 3 days so"),
    msg("left", "This is literally the same thing that happened in March"),
    msg("right", "Wow ok sorry I'm not perfect like you"),
  ] };
  const groups = P.defaultMapping(P.phoneGroups([mayaPhone, jordanPhone]));
  const t = P.buildTranscript([mayaPhone, jordanPhone], groups);
  assert.deepEqual(t.map((m) => `${m.sender}: ${m.text}`), [
    "Maya: You said you'd do the dishes last night?",
    "Jordan: Ok and you left your laundry in the dryer for 3 days so",
    "Maya: This is literally the same thing that happened in March",
    "Jordan: Wow ok sorry I'm not perfect like you",
  ]);
  assert.deepEqual(t[1].shots, [1, 2]);
  assert.deepEqual(t.map((m) => m.id), ["m1", "m2", "m3", "m4"]);
});

test("out-of-order screenshots are put back in order, and non-overlapping ones get a gap", () => {
  const a = [{ sender: "A", text: "Message number three here", shots: [2] }, { sender: "B", text: "Message number four here", shots: [2] }];
  const b = [{ sender: "A", text: "Message number one here", shots: [1] }, { sender: "B", text: "Message number two here", shots: [1] }, { sender: "A", text: "Message number three here", shots: [1] }];
  const r = P.mergeSequences(a, b);
  assert.equal(r.how, "prepend");
  assert.deepEqual(r.merged.map((m) => m.text.split(" ")[2]), ["one", "two", "three", "four"]);

  const c = [{ sender: "A", text: "Something completely different", shots: [3] }];
  const g = P.mergeSequences(r.merged, c);
  assert.equal(g.how, "gap");
  assert.equal(g.merged.at(-2).kind, "gap");
});

test("a duplicate screenshot is absorbed", () => {
  const base = [{ text: "Hello there how are you", shots: [1] }, { text: "Fine thanks and you", shots: [1] }];
  const r = P.mergeSequences(base, [{ text: "Hello there how are you", shots: [2] }]);
  assert.equal(r.how, "contained");
  assert.equal(r.merged.length, 2);
  assert.deepEqual(r.merged[0].shots, [1, 2]);
});

test("unverifiedQuotes flags quotes that aren't in the transcript", () => {
  const messages = [
    { id: "m1", text: "You said you'd do the dishes last night?" },
    { id: "m2", text: "Ok and you left your laundry in the dryer for 3 days so" },
  ];
  const verdict = {
    origin: { spark_quote: "You said you'd do the dishes last night", escalation_points: [{ quote: "you left your laundry in the dryer" }] },
    grudges: [],
    personal_shots: [{ quote: "You're so lazy" }],
    fallacies: [],
  };
  assert.deepEqual(P.unverifiedQuotes(verdict, messages), ["You're so lazy"]);
  assert.deepEqual(P.unverifiedQuotes(verdict, [], "Jordan: You're so lazy\n" + messages.map((m) => m.text).join("\n")), []);
});

test("transcriptText numbers messages and marks gaps", () => {
  const txt = P.transcriptText([
    { id: "m1", sender: "Maya", time: "9:14 PM", text: "Hi" },
    { kind: "gap" },
    { id: "m2", sender: "Jordan", time: "", text: "Hey" },
  ]);
  assert.equal(txt, "[m1] Maya (9:14 PM): Hi\n[possible missing messages here: the screenshots on either side don't overlap]\n[m2] Jordan: Hey");
});

test("parseTsv turns Tesseract output into positioned lines", () => {
  const row = (level, line, word, l, t, w, h, conf, text) => [level, 1, 1, 1, line, word, l, t, w, h, conf, text].join("\t");
  const tsv = [
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    row(4, 1, 0, 100, 50, 300, 30, -1, ""),
    row(5, 1, 1, 100, 50, 120, 30, 96, "What"),
    row(5, 1, 2, 230, 50, 170, 30, 90, "shit?"),
    row(4, 2, 0, 20, 10, 100, 20, -1, ""),
    row(5, 2, 1, 20, 10, 100, 20, 40, "10:01"),
  ].join("\n");
  const lines = P.parseTsv(tsv, 1000, 1000);
  assert.deepEqual(lines, [
    { text: "10:01", l: 2, r: 12, y: 1, conf: 40 },
    { text: "What shit?", l: 10, r: 40, y: 5, conf: 93 },
  ]);
  assert.equal(P.ocrBlock(3, lines), "Screenshot 3:\ny=1 L=2 R=12 low | 10:01\ny=5 L=10 R=40 | What shit?");
});

// Real on-device OCR output for two test screenshots: "y L R | text".
const ocrLines = (s) =>
  s.trim().split("\n").map((row) => {
    const [, y, l, r, text] = row.match(/^y=(\d+) L=(\d+) R=(\d+) \| (.*)$/);
    return { text, l: Number(l), r: Number(r), y: Number(y), conf: 91 };
  });

const DARK_GROUP = ocrLines(`
y=2 L=6 R=94 | 10:01 5G
y=11 L=36 R=64 | Strech Media team >
y=16 L=41 R=59 | Today 9:58 AM
y=19 L=14 R=22 | Jason
y=22 L=15 R=77 | Ur telling me to have pride when
y=25 L=15 R=80 | it got the green light from the Man
y=27 L=3 R=72 | O U asked me to check in with?
y=31 L=14 R=22 | Jason
y=34 L=3 R=34 | oO Ok buddy
y=39 L=73 R=94 | What shit?
y=43 L=15 R=25 | Michael
y=46 L=15 R=68 | | have pride in it I'm the one
y=49 L=3 R=69 | © standing on it saying it's fine
y=53 L=15 R=25 | Michael
y=56 L=15 R=72 | Nobody's fucking ur shit up or
y=58 L=3 R=61 | @ talking crazy for nothing
y=63 L=47 R=94 | U think that's fine to post
y=67 L=14 R=22 | Jason
y=70 L=15 R=78 | Yes | really do | just changed the
y=73 L=3 R=47 | @ coloring yes | do
y=77 L=14 R=22 | Jason
y=80 L=3 R=65 | e | said that 2 times already`);

const LIGHT_PAIR = ocrLines(`
y=2 L=6 R=94 | 10:01 5G
y=11 L=44 R=56 | Jordan >
y=17 L=28 R=91 | You said you'd do the dishes last
y=19 L=28 R=40 | night?
y=24 L=7 R=62 | | was going to do them today
y=29 L=7 R=71 | It's literally just dishes, why is this
y=31 L=6 R=32 | a whole thing
y=36 L=28 R=84 | You always do this, you're so
y=39 L=28 R=47 | unreliable
y=43 L=6 R=65 | Ok and you left your laundry in
y=46 L=6 R=49 | the dryer for 3 days so`);

const brief = (msgs) => msgs.map((m) => [m.side, m.sender_label, m.time, m.text]);
const line = (y, l, r, text, conf = 90) => ({ text, l, r, y, conf });

test("cleanOcr fixes lone bars and stray symbols", () => {
  assert.equal(P.cleanOcr("| have pride in it I'm the one"), "I have pride in it I'm the one");
  assert.equal(P.cleanOcr("Yes | really do | just changed the"), "Yes I really do I just changed the");
  assert.equal(P.cleanOcr("|'m done"), "I'm done");
  assert.equal(P.cleanOcr("© standing on it"), "standing on it");
  assert.equal(P.cleanOcr("0k fine"), "Ok fine");
  assert.equal(P.cleanOcr("  what   now  "), "what now");
});

test("headerOf finds the chat name under the status bar", () => {
  assert.equal(P.headerOf(DARK_GROUP), "Strech Media team");
  assert.equal(P.headerOf(LIGHT_PAIR), "Jordan");
  // No header when the screenshot starts mid-conversation.
  assert.equal(P.headerOf(LIGHT_PAIR.slice(2)), "");
  // WhatsApp: left-aligned name after a back arrow, "online" under it.
  assert.equal(P.headerOf([line(1, 5, 15, "9:41"), line(6, 2, 30, "< 12 Priya"), line(9, 16, 26, "online")]), "Priya");
});

test("linesToMessages sorts a dark-mode group chat into messages", () => {
  const msgs = P.linesToMessages(DARK_GROUP);
  assert.deepEqual(brief(msgs), [
    ["left", "Jason", "Today 9:58 AM", "Ur telling me to have pride when it got the green light from the Man U asked me to check in with?"],
    ["left", "Jason", "", "Ok buddy"],
    ["right", "", "", "What shit?"],
    ["left", "Michael", "", "I have pride in it I'm the one standing on it saying it's fine"],
    ["left", "Michael", "", "Nobody's fucking ur shit up or talking crazy for nothing"],
    ["right", "", "", "U think that's fine to post"],
    ["left", "Jason", "", "Yes I really do I just changed the coloring yes I do"],
    ["left", "Jason", "", "I said that 2 times already"],
  ]);
  for (const m of msgs) {
    assert.equal(m.kind, "text");
    assert.equal(m.partial, false);
    assert.equal(m.part, 1);
  }
  assert.deepEqual(msgs.map((m) => m.y), [22, 34, 39, 46, 56, 63, 70, 80]);
});

test("linesToMessages sorts a light-mode 1:1 chat, including a short wrapped last line", () => {
  assert.deepEqual(brief(P.linesToMessages(LIGHT_PAIR)), [
    ["right", "", "", "You said you'd do the dishes last night?"],
    ["left", "", "", "I was going to do them today"],
    ["left", "", "", "It's literally just dishes, why is this a whole thing"],
    ["right", "", "", "You always do this, you're so unreliable"],
    ["left", "", "", "Ok and you left your laundry in the dryer for 3 days so"],
  ]);
});

test("on-device readings feed the who's-who defaults and the transcript", () => {
  const readings = [DARK_GROUP, LIGHT_PAIR].map((lines, i) => {
    const msgs = P.linesToMessages(lines);
    return { n: i + 1, header: P.headerOf(lines), isGroup: msgs.some((m) => m.side === "left" && m.sender_label), msgs };
  });
  assert.deepEqual(readings.map((r) => r.isGroup), [true, false]);
  const groups = P.defaultMapping(P.phoneGroups(readings));
  assert.equal(groups[0].me, "Me");
  assert.equal(groups[1].them, "Jordan");
  const t = P.buildTranscript(readings, groups);
  assert.deepEqual(t.slice(0, 3).map((m) => m.sender), ["Jason", "Jason", "Me"]);
  assert.equal(t.at(-1).sender, "Jordan");
});

test("linesToMessages skips delivery labels and typing bars, and reads WhatsApp-style layouts", () => {
  const msgs = P.linesToMessages([
    line(20, 60, 94, "Are you coming tonight?"),
    line(24, 83, 94, "Delivered"),
    line(29, 5, 40, "Maybe later"),
    line(34, 20, 94, "Ok well let me know because we"),
    line(37, 20, 30, "need to"),
    line(40, 20, 45, "book it"),
    line(44, 85, 94, "Read 9:14 PM"),
    line(50, 38, 62, "Yesterday"),
    line(55, 5, 30, "2 Replies"),
    line(60, 5, 55, "Fine I'll check"),
    line(63, 40, 55, "9:20 PM"),
    line(66, 5, 20, "Edited"),
    line(94, 10, 40, "iMessage"),
  ]);
  assert.deepEqual(brief(msgs), [
    ["right", "", "", "Are you coming tonight?"],
    ["left", "", "", "Maybe later"],
    ["right", "", "", "Ok well let me know because we need to book it"],
    ["left", "", "Yesterday", "Fine I'll check"],
  ]);
});

test("a timestamp row goes on the next message, and a one-word reply is not a name", () => {
  const msgs = P.linesToMessages([
    line(10, 40, 60, "Sat, Sep 20 at 9:58 PM"),
    line(14, 6, 18, "Sure"),
    line(19, 6, 50, "What time works for you"),
    line(24, 70, 94, "Seven?"),
  ]);
  assert.deepEqual(brief(msgs), [
    ["left", "", "Sat, Sep 20 at 9:58 PM", "Sure"],
    ["left", "", "", "What time works for you"],
    ["right", "", "", "Seven?"],
  ]);
});

test("in a group chat, a sender's later bubbles in the same run keep their name", () => {
  const msgs = P.linesToMessages([
    line(20, 14, 22, "Priya"),
    line(23, 15, 60, "Are we still on for Friday"),
    line(29, 15, 40, "Because I booked it"),
    line(34, 70, 94, "Yes we are"),
    line(40, 15, 40, "Great"),
  ]);
  assert.deepEqual(brief(msgs), [
    ["left", "Priya", "", "Are we still on for Friday"],
    ["left", "Priya", "", "Because I booked it"],
    ["right", "", "", "Yes we are"],
    ["left", "", "", "Great"],
  ]);
});

test("parseOcrReply reads Claude's compact line-per-message reply", () => {
  const r = P.parseOcrReply("Here you go\n4|H|Strech Media team\n4|L|Jason|Today 9:58 AM|Ok buddy\n4|R|||What | why?\n4|C|||Jason left the conversation\n5|H|\n");
  assert.deepEqual([...r.keys()], [4, 5]);
  assert.equal(r.get(4).header, "Strech Media team");
  assert.deepEqual(brief(r.get(4).msgs), [
    ["left", "Jason", "Today 9:58 AM", "Ok buddy"],
    ["right", "", "", "What | why?"],
    ["center", "", "", "Jason left the conversation"],
  ]);
  assert.equal(r.get(4).msgs[2].kind, "system");
  assert.deepEqual(r.get(5), { header: "", msgs: [] });
});

test("readingQuality flags screenshots that read poorly", () => {
  const good = P.readingQuality(DARK_GROUP, P.linesToMessages(DARK_GROUP));
  assert.equal(good.poor, false);
  assert.equal(good.messages, 8);
  const lowConf = LIGHT_PAIR.map((x) => ({ ...x, conf: 35 }));
  assert.equal(P.readingQuality(lowConf, P.linesToMessages(lowConf)).poor, true);
  const noise = ["~~ =| ®", "|| {} ##", "@@ ©", "Er iil", ";; ,,"].map((text, i) => line(10 * i + 5, 10 + i, 50, text, 70));
  const q = P.readingQuality(noise, P.linesToMessages(noise));
  assert.equal(q.poor, true);
  assert.equal(q.reason, "garbled");
  assert.deepEqual(P.readingQuality([], []), { conf: 0, garbled: 0, lines: 0, messages: 0, poor: false, reason: "empty" });
});

test("normalizeVerdict makes schema-violating verdicts safe or rejects them", () => {
  const bad = { title: 42, origin: { escalation_points: "x" }, participants: "nope", winner: { name: "Maya", confidence: "140", scores: "x" }, fallacies: [null, { quote: "q" }] };
  const v = P.normalizeVerdict(bad);
  assert.equal(v.title, "42");
  assert.deepEqual(v.participants, []);
  assert.deepEqual(v.origin.escalation_points, []);
  assert.deepEqual(v.winner.scores, []);
  assert.equal(v.winner.confidence, 100);
  assert.equal(v.fallacies.length, 1);
  assert.equal(P.normalizeVerdict({ origin: {}, winner: {} }), null, "no winner and not a draw");
  assert.ok(P.normalizeVerdict({ origin: {}, winner: { is_draw: true } }), "a draw needs no name");
  assert.equal(P.normalizeVerdict("text"), null);
});
