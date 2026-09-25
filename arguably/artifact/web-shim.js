/* Web build only (node scripts/build-artifact.mjs --web).
 * Stands in for the claude.ai `sample` capability so the same app runs on its own website:
 * requests go to this site's /api functions, which call the AI with the site's own key.
 * Same contract as the capability: sampler(turns, {onText, signal}) -> {text, truncated},
 * sampler.json(prompt, {images, modelTier, signal}) -> object, errors are {code} objects
 * with a string code (and the text received so far, when a reply breaks off). */
(() => {
  const MAX_IMAGE_EDGE = 1280; // keeps each request under the host's upload limit
  const fail = (code, text) => (text ? { code, text } : { code });
  const isAbort = (err, signal) => signal?.aborted || err?.name === "AbortError";

  async function shrink(blob, signal) {
    if (signal?.aborted) throw fail("cancelled");
    let bmp;
    try {
      bmp = await createImageBitmap(blob);
    } catch {
      throw fail("image_rejected");
    }
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const url = c.toDataURL("image/jpeg", 0.82);
    c.width = c.height = 0; // hand the memory back right away (iOS caps total canvas memory)
    return url;
  }

  async function post(path, body, signal) {
    let res;
    try {
      res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    } catch (err) {
      throw fail(isAbort(err, signal) ? "cancelled" : "network_error");
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw fail(typeof data.code === "string" ? data.code : res.status === 429 ? "rate_limited" : res.status === 413 ? "prompt_too_large" : "upstream_error");
    }
    return res;
  }

  async function sampler(turns, opts = {}) {
    const res = await post("/api/chat", { turns, tier: opts.modelTier || "default" }, opts.signal);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let text = "";
    let done = null; // {truncated} once the server says the reply is complete
    const handle = (raw) => {
      const line = raw.trim();
      if (!line) return;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.error) throw fail(String(ev.error), text);
      if (ev.delta) {
        text += ev.delta;
        opts.onText?.({ text });
      }
      if (ev.done) done = { truncated: !!ev.truncated };
    };
    try {
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          handle(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
      }
      handle(buf + decoder.decode());
    } catch (err) {
      if (isAbort(err, opts.signal)) throw fail("cancelled", text);
      throw typeof err?.code === "string" ? err : fail("upstream_error", text);
    }
    // The connection ended without the server's "done": the reply was cut off.
    if (!done) {
      if (text) return { text, truncated: true };
      throw fail("upstream_error");
    }
    return { text, truncated: done.truncated };
  }

  sampler.json = async (prompt, opts = {}) => {
    const images = [];
    for (const img of opts.images || []) images.push(await shrink(img, opts.signal));
    const res = await post("/api/json", { prompt, images, tier: opts.modelTier || "default" }, opts.signal);
    try {
      return await res.json();
    } catch (err) {
      throw fail(isAbort(err, opts.signal) ? "cancelled" : "invalid_json");
    }
  };

  sampler.limits = async () => ({ maxPromptBytes: 200000, images: { maxCount: 3, maxInputBytes: 4e6, mediaTypes: ["image/jpeg", "image/png"] } });

  window.claude = { use: async (name) => (name === "sample" ? sampler : null) };
})();
