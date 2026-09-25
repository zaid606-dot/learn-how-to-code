/* Web build only (node scripts/build-artifact.mjs --web).
 * Stands in for the claude.ai `sample` capability so the same app runs on its own website:
 * requests go to this site's /api functions, which call the AI with the site's own key.
 * Same contract as the capability: sampler(turns, {onText, signal}) -> {text, truncated},
 * sampler.json(prompt, {images, modelTier, signal}) -> object, errors are {code} objects. */
(() => {
  const MAX_IMAGE_EDGE = 1280; // keeps each request under the host's upload limit

  async function shrink(blob) {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  }

  async function post(path, body, signal) {
    let res;
    try {
      res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    } catch (err) {
      throw { code: signal?.aborted || err?.name === "AbortError" ? "cancelled" : "network_error" };
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw { code: data.code || (res.status === 429 ? "rate_limited" : res.status === 413 ? "prompt_too_large" : "upstream_error") };
    }
    return res;
  }

  async function sampler(turns, opts = {}) {
    const res = await post("/api/chat", { turns, tier: opts.modelTier || "default" }, opts.signal);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let text = "";
    let truncated = false;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.error) throw { code: ev.error };
          if (ev.delta) {
            text += ev.delta;
            opts.onText?.({ text });
          }
          if (ev.done) truncated = !!ev.truncated;
        }
      }
    } catch (err) {
      if (opts.signal?.aborted || err?.name === "AbortError") throw { code: "cancelled" };
      throw err?.code ? err : { code: "upstream_error" };
    }
    return { text, truncated };
  }

  sampler.json = async (prompt, opts = {}) => {
    const images = opts.images ? await Promise.all(opts.images.map(shrink)) : [];
    const res = await post("/api/json", { prompt, images, tier: opts.modelTier || "default" }, opts.signal);
    return res.json();
  };

  sampler.limits = async () => ({ maxPromptBytes: 200000, images: { maxCount: 3, maxInputBytes: 4e6, mediaTypes: ["image/jpeg", "image/png"] } });

  window.claude = { use: async (name) => (name === "sample" ? sampler : null) };
})();
