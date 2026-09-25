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
