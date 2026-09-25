// Fake `window.claude` for end-to-end tests. Configure with window.__STUB_CONFIG before this runs:
//   images:  true  -> the view can send images (claude.ai in a browser)
//            false -> text only (the Claude iPhone app)
//   shots:   { [screenshotNumber]: { header, msgs: [[side, text, senderLabel?]] } }
//            what "Claude" reads from each screenshot on the image path
//   failJson: true -> every sample.json call rejects (exercises error handling)
//   failVerdictTimes: n -> the first n verdict calls reject
//   noClaude: true -> claude.use("sample") resolves null (signed out / not a Claude viewer)
// Every call is recorded in window.__STUB.calls so tests can assert what was sent.
(function () {
  const cfg = window.__STUB_CONFIG || {};
  const stub = { calls: [], sampleVerdict: null };
  window.__STUB = stub;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const sample = async (turns, opts = {}) => {
    const context = Array.isArray(turns) ? turns[0].content : String(turns);
    stub.calls.push({ kind: "chat", turns: Array.isArray(turns) ? turns.length : 1, context, last: Array.isArray(turns) ? turns.at(-1).content : turns, opts: { tier: opts.modelTier, cache: opts.cache } });
    const full = "Jordan should go first. In [m2] the laundry point came in as a dodge.\n\n- Own the dishes without a \"but\"\n- Then raise the laundry separately";
    let text = "";
    for (const w of full.split(/(?<= )/)) {
      if (opts.signal?.aborted) throw { code: "cancelled", text };
      text += w;
      opts.onText?.({ text, delta: w });
      await wait(5);
    }
    return { text: full, truncated: false, modelTierApplied: opts.modelTier || "default" };
  };

  sample.limits = async () =>
    cfg.images === false
      ? { maxPromptBytes: 65536 }
      : { maxPromptBytes: 65536, images: { maxCount: cfg.maxCount || 3, maxInputBytes: 2e7, mediaTypes: ["image/jpeg", "image/png"] } };

  sample.json = async (input, opts = {}) => {
    await wait(100);
    const images = opts.images ? opts.images.length || 1 : 0;
    if (cfg.failJson) {
      stub.calls.push({ kind: "json-failed", images });
      throw { code: "upstream_error", message: "stubbed failure" };
    }
    if (input.startsWith("Transcribe")) {
      const labels = input.split("Images in this batch:\n")[1].trim().split("\n");
      stub.calls.push({ kind: "read-images", images, labels, tier: opts.modelTier });
      const out = { images: [], messages: [] };
      labels.forEach((label, i) => {
        const n = Number(label.match(/screenshot (\d+)/)[1]);
        const part = Number(label.match(/slice (\d+)/)?.[1] || 1);
        const shot = (cfg.shots || {})[n] || { header: "", msgs: [] };
        out.images.push({ image: i + 1, app: "iMessage", header_name: part === 1 ? shot.header : "" });
        if (part === 1) {
          shot.msgs.forEach(([side, text, label], j) =>
            out.messages.push({ image: i + 1, side, sender_label: label || "", text, time: "", kind: "text", partial: false, y: 20 + j * 10 })
          );
        }
      });
      return out;
    }
    if (input.includes("<conversation>") && input.includes("JSON Schema")) {
      if (cfg.failVerdictTimes > 0) {
        cfg.failVerdictTimes--;
        stub.calls.push({ kind: "verdict-failed" });
        throw { code: "upstream_error", message: "stubbed verdict failure" };
      }
      stub.calls.push({
        kind: "verdict",
        images,
        tier: opts.modelTier,
        transcript: (input.match(/^\[m\d+\] .*$/gm) || []),
        you: (input.match(/The person asking is ([^.]+)\./) || [])[1] || "",
      });
      return stub.sampleVerdict;
    }
    // Anything else is the on-device reading fallback (text lines sent for cleanup).
    stub.calls.push({ kind: "ocr-fallback", images, tier: opts.modelTier, input });
    throw { code: "upstream_error", message: "stub has no fallback reply" };
  };

  window.claude = { use: async (name) => (name === "sample" && !cfg.noClaude ? sample : null) };
})();
