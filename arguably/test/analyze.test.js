import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequest, analyzeArgument, validateInput, AnalysisError, MAX_IMAGES } from "../src/analyze.js";
import { verdictSchema } from "../src/schema.js";
import { sampleVerdict } from "../src/sample.js";

// Minimal validator for the subset of JSON Schema we use.
function validate(schema, value, path = "$") {
  switch (schema.type) {
    case "object":
      assert.equal(typeof value, "object", path);
      assert.deepEqual(Object.keys(value).sort(), Object.keys(schema.properties).sort(), `${path} keys`);
      for (const [k, s] of Object.entries(schema.properties)) validate(s, value[k], `${path}.${k}`);
      break;
    case "array":
      assert.ok(Array.isArray(value), path);
      value.forEach((v, i) => validate(schema.items, v, `${path}[${i}]`));
      break;
    case "string":
      assert.equal(typeof value, "string", path);
      if (schema.enum) assert.ok(schema.enum.includes(value), `${path} enum: ${value}`);
      break;
    case "integer":
      assert.ok(Number.isInteger(value), path);
      break;
    case "boolean":
      assert.equal(typeof value, "boolean", path);
      break;
    default:
      assert.fail(`unknown type at ${path}`);
  }
}

function walkObjects(schema, fn) {
  if (schema.type === "object") {
    fn(schema);
    Object.values(schema.properties).forEach((s) => walkObjects(s, fn));
  } else if (schema.type === "array") walkObjects(schema.items, fn);
}

const img = { mediaType: "image/jpeg", data: "abc" };
const fakeClient = (message) => {
  const calls = [];
  return {
    calls,
    beta: { messages: { stream: (req) => (calls.push(req), { finalMessage: async () => message }) } },
  };
};

test("every schema object is strict (all keys required, no extras)", () => {
  walkObjects(verdictSchema, (o) => {
    assert.equal(o.additionalProperties, false);
    assert.deepEqual([...o.required].sort(), Object.keys(o.properties).sort());
  });
});

test("sample verdict conforms to the schema", () => validate(verdictSchema, sampleVerdict));

test("buildRequest interleaves labels and images, then the ask", () => {
  const req = buildRequest({ images: [img, img], context: "  roommates  " });
  const c = req.messages[0].content;
  assert.deepEqual(c.map((b) => b.type), ["text", "image", "text", "image", "text"]);
  assert.equal(c[0].text, "Screenshot 1 of 2:");
  assert.deepEqual(c[1].source, { type: "base64", media_type: "image/jpeg", data: "abc" });
  assert.match(c[4].text, /roommates$/);
  assert.equal(req.output_config.format.type, "json_schema");
  assert.deepEqual(req.thinking, { type: "adaptive" });
  assert.equal(req.fallbacks, "default");
  assert.deepEqual(req.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(req.temperature, undefined);
});

test("buildRequest omits context block text when context is blank", () => {
  const req = buildRequest({ images: [img], context: "   " });
  assert.equal(req.messages[0].content.at(-1).text, "Referee this argument and return the verdict.");
});

test("validateInput rejects bad payloads", () => {
  assert.throws(() => validateInput({}), AnalysisError);
  assert.throws(() => validateInput({ images: [] }), /at least one/);
  assert.throws(() => validateInput({ images: Array(MAX_IMAGES + 1).fill(img) }), /Up to/);
  assert.throws(() => validateInput({ images: [{ mediaType: "image/tiff", data: "x" }] }), /JPEG/);
  assert.throws(() => validateInput({ images: [img], context: 5 }), /text/);
  assert.deepEqual(validateInput({ images: [img] }), { images: [img], context: "" });
});

test("analyzeArgument parses the verdict from the text block", async () => {
  const client = fakeClient({
    stop_reason: "end_turn",
    content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(sampleVerdict) }],
  });
  const v = await analyzeArgument(client, { images: [img] });
  assert.equal(v.winner.name, "Maya");
  assert.equal(client.calls.length, 1);
});

test("analyzeArgument surfaces refusal, truncation and garbage", async () => {
  await assert.rejects(analyzeArgument(fakeClient({ stop_reason: "refusal", content: [] }), { images: [img] }), (e) => e.status === 422);
  await assert.rejects(analyzeArgument(fakeClient({ stop_reason: "max_tokens", content: [] }), { images: [img] }), /cut off/);
  await assert.rejects(
    analyzeArgument(fakeClient({ stop_reason: "end_turn", content: [{ type: "text", text: "{nope" }] }), { images: [img] }),
    /garbled/
  );
  await assert.rejects(analyzeArgument(fakeClient({ stop_reason: "end_turn", content: [] }), { images: [img] }), /No verdict/);
});
