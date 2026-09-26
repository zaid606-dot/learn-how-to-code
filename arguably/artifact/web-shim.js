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
      const err = fail(typeof data.code === "string" ? data.code : res.status === 429 ? "rate_limited" : res.status === 413 ? "prompt_too_large" : "upstream_error");
      const ra = Number(data.retryAfter || res.headers.get("retry-after"));
      if (Number.isFinite(ra) && ra > 0) err.retryAfter = Math.min(ra, 60);
      throw err;
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

  const RETRIES = [15, 25, 40, 60]; // about 2½ minutes in all, then the error shows
  async function pause(seconds, signal) {
    for (let left = seconds; left > 0; left--) {
      if (signal?.aborted) throw fail("cancelled");
      window.dispatchEvent(new CustomEvent("arguably:ai-wait", { detail: { seconds: left } }));
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (signal?.aborted) throw fail("cancelled");
    window.dispatchEvent(new CustomEvent("arguably:ai-wait", { detail: { seconds: 0 } }));
  }

  sampler.json = async (prompt, opts = {}) => {
    const images = [];
    for (const img of opts.images || []) images.push(await shrink(img, opts.signal));
    // When the AI is busy (everyone shares one per-minute budget), wait and try again on our
    // own instead of making the person start over. The app shows the countdown.
    let res;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await post("/api/json", { prompt, images, tier: opts.modelTier || "default" }, opts.signal);
        break;
      } catch (err) {
        if (err?.code !== "rate_limited" || attempt >= RETRIES.length) throw err;
        const seconds = Math.max(err.retryAfter || 0, RETRIES[attempt]) + Math.floor(Math.random() * 6); // spread phones out
        await pause(seconds, opts.signal);
      }
    }
    try {
      return await res.json();
    } catch (err) {
      throw fail(isAbort(err, opts.signal) ? "cancelled" : "invalid_json");
    }
  };

  // The server says how much to send: on a small AI plan, screenshots are read on the phone
  // and only their text is sent.
  sampler.limits = async () => {
    try {
      const res = await fetch("/api/limits");
      if (res.ok) return await res.json();
    } catch {}
    return { maxPromptBytes: 20000 };
  };

  window.claude = { use: async (name) => (name === "sample" ? sampler : null) };
})();
