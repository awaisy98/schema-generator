import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml"
};

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(response, statusCode, payload) {
  setCorsHeaders(response); // 👈 ADD THIS

  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function extractJsonLd(html) {
  const matches = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];

  const schemas = [];

  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1].trim());
      schemas.push(parsed);
    } catch (e) {
      // ignore invalid JSON
    }
  }

  return schemas;
}

async function handleSchemaExtract(request, response) {
  try {
    const body = await readJson(request);
    const targetUrl = body.url;

    if (!targetUrl) {
      sendJson(response, 400, { error: "URL is required" });
      return;
    }

    const url = new URL(targetUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      sendJson(response, 400, { error: "Only HTTP and HTTPS URLs are supported" });
      return;
    }

    const res = await fetch(url, {
      headers: {
        "User-Agent": "SchemaStudio/1.0 (+https://schema.org)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    if (!res.ok) {
      sendJson(response, res.status, { error: `Website returned ${res.status}` });
      return;
    }

    const html = await res.text();
    const schemas = extractJsonLd(html);

    sendJson(response, 200, {
      success: true,
      count: schemas.length,
      schemas
    });

  } catch (err) {
    sendJson(response, 500, { error: "Failed to fetch website" });
  }
}

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host}`);
  const requestedPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const normalizedPath = path.normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(__dirname, normalizedPath);

  if (!filePath.startsWith(__dirname)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    const extension = path.extname(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Access-Control-Allow-Origin": "*" // 👈 ADD THIS
    });
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}


const server = http.createServer(async (request, response) => {

  
  // ✅ HANDLE CORS PRE-FLIGHT REQUEST
  if (request.method === "OPTIONS") {
    setCorsHeaders(response);
    response.writeHead(204);
    response.end();
    return;
  }

  // ✅ ADD CORS TO ALL RESPONSES
  setCorsHeaders(response);

  if (request.method === "POST" && request.url?.startsWith("/api/extract-schema")) {
    await handleSchemaExtract(request, response);
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    await serveStatic(request, response);
    return;
  }

  sendJson(response, 405, { error: "Method not allowed" });
});
