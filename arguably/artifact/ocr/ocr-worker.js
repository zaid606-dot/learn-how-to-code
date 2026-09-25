/* On-device text recognition for Arguably (Tesseract, run in a Web Worker).
 * Messages: {type:"init", coreUrl, langUrl} -> {type:"ready"}
 *   langUrl is a script that sets self.ENG_TRAINEDDATA_B64 (artifacts don't serve raw binary files).
 *           {type:"ocr", id, png: ArrayBuffer} -> {type:"result", id, tsv}
 * Any failure -> {type:"error", id?, message}. */
let mod = null;
let api = null;

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      importScripts(data.coreUrl);
      mod = await self.TesseractCore();
      importScripts(data.langUrl);
      const bin = atob(self.ENG_TRAINEDDATA_B64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      self.ENG_TRAINEDDATA_B64 = null;
      mod.FS.writeFile("eng.traineddata", bytes);
      api = new mod.TessBaseAPI();
      if (api.Init(null, "eng") !== 0) throw new Error("engine init failed");
      self.postMessage({ type: "ready" });
    } else if (data.type === "ocr") {
      mod.FS.writeFile("/input", new Uint8Array(data.png));
      api.SetImageFile();
      self.postMessage({ type: "result", id: data.id, tsv: api.GetTSVText(0) });
    }
  } catch (e) {
    self.postMessage({ type: "error", id: data.id, message: String(e?.message || e) });
  }
};
