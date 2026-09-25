import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeArgument, validateInput, AnalysisError } from "./src/analyze.js";
import { sampleVerdict } from "./src/sample.js";

const PORT = Number(process.env.PORT) || 3000;
const MOCK = process.env.ARGUABLY_MOCK === "1";
const MAX_BODY_BYTES = 30 * 1024 * 1024;
const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

// Mock mode returns the sample verdict so the UI can be exercised without an API key.
const mockClient = {
  beta: {
    messages: {
      stream: () => ({
        finalMessage: async () => {
          await new Promise((r) => setTimeout(r, 2500));
          return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(sampleVerdict) }] };
        },
      }),
    },
  },
};

let Anthropic;
let client;
async function getClient() {
  if (MOCK) return mockClient;
  if (!client) {
    try {
      ({ default: Anthropic } = await import("@anthropic-ai/sdk"));
    } catch {
      throw new AnalysisError("Arguably isn't set up yet: the server is missing @anthropic-ai/sdk. Run `npm install`.", 500);
    }
    client = new Anthropic();
  }
  return client;
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new AnalysisError("Those screenshots are too large to send together. Try fewer at a time.", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AnalysisError("We couldn't read that request. Refresh the page and try again.", 400);
  }
}

function apiErrorResponse(err) {
  if (err instanceof AnalysisError) return [err.status, err.message];
  if (Anthropic && err instanceof Anthropic.APIError) {
    if (err instanceof Anthropic.AuthenticationError) return [500, "Arguably isn't connected to its AI service yet. Check the server's API key."];
    if (err instanceof Anthropic.RateLimitError) return [429, "Arguably is busy right now. Try again in a minute."];
    if (err instanceof Anthropic.BadRequestError) return [400, "We couldn't process those screenshots. Try different images."];
    if (err instanceof Anthropic.APIConnectionError) return [503, "We couldn't reach the AI service. Try again in a moment."];
    return [502, "The AI service had a problem. Try again in a moment."];
  }
  if (err?.message?.includes("API key")) return [500, "Arguably isn't connected yet. Set ANTHROPIC_API_KEY on the server."];
  return [500, "We couldn't finish the verdict. Try again."];
}

async function handleAnalyze(req, res) {
  try {
    const input = validateInput(await readJsonBody(req));
    const verdict = await analyzeArgument(await getClient(), input);
    sendJson(res, 200, { verdict });
  } catch (err) {
    const [status, message] = apiErrorResponse(err);
    if (status >= 500) console.error("[analyze]", err);
    sendJson(res, status, { error: message });
  }
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const rel = normalize(urlPath === "/" ? "/index.html" : urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: "Forbidden" });
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/analyze") return handleAnalyze(req, res);
  if (req.method === "GET" && req.url === "/api/sample") return sendJson(res, 200, { verdict: sampleVerdict });
  if (req.method === "GET" && req.url === "/api/health") return sendJson(res, 200, { ok: true, mock: MOCK });
  if (req.method === "GET") return serveStatic(req, res);
  sendJson(res, 405, { error: "Method not allowed" });
});

server.listen(PORT, () => {
  console.log(`Arguably running at http://localhost:${PORT}${MOCK ? " (mock mode)" : ""}`);
});
