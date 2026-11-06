/**
 * The comments service.
 *
 * Two jobs, both behind nginx on the site's own origin:
 *
 *   - OAuth: the browser cannot exchange an authorization code for a token
 *     (github.com/login/oauth/access_token sends no CORS headers), so the
 *     exchange happens here.
 *   - Reads: every comment read happens here, because GitHub's anonymous
 *     GraphQL budget is 60 requests per hour per IP — a limit a shared
 *     office or carrier NAT would blow through in one afternoon.
 *
 * Writes deliberately do NOT happen here: the reader's own token posts
 * straight to api.github.com from the browser, so the comment is attributed
 * to the person who wrote it. The server never sees the reader's token.
 */

import { createServer } from "node:http";
import { config } from "./config.mjs";
import { exchangeCode } from "./github.mjs";
import { getThread, ensureThread, purgeThread } from "./threads.mjs";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  // The service is same-origin behind nginx; no CORS headers are needed,
  // and adding them would widen who can call it.
  "Cache-Control": "no-store",
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { ...JSON_HEADERS, ...SECURITY_HEADERS, "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<unknown>} the parsed JSON body
 */
async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32 * 1024) throw new Error("request body too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
async function handle(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;

  // The public OAuth client configuration. The client_id is not a secret —
  // it travels in the authorize URL — but the client_secret never leaves
  // the server.
  if (req.method === "GET" && path === "/api/comments-auth/config") {
    sendJson(res, 200, { clientId: config.clientId, redirectUri: config.redirectUri });
    return;
  }

  if (req.method === "POST" && path === "/api/comments-auth/exchange") {
    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      sendJson(res, 400, { error: `bad request: ${error.message}` });
      return;
    }

    const { code, codeVerifier, redirectUri } = body ?? {};
    if (!code || !codeVerifier || !redirectUri) {
      sendJson(res, 400, { error: "code, codeVerifier and redirectUri are required" });
      return;
    }

    try {
      const result = await exchangeCode({ code, codeVerifier, redirectUri });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && path === "/api/comments/thread") {
    const slug = url.searchParams.get("slug");
    if (!slug) {
      sendJson(res, 400, { error: "slug is required" });
      return;
    }

    try {
      const thread = await getThread(slug, { fresh: url.searchParams.get("fresh") === "1" });
      sendJson(res, 200, thread);
    } catch (error) {
      sendJson(res, 502, { error: error.message });
    }
    return;
  }

  // Create-on-first-comment: the client calls this right before posting
  // the first comment of a page, then writes via its own user token.
  if (req.method === "POST" && path === "/api/comments/thread") {
    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      sendJson(res, 400, { error: `bad request: ${error.message}` });
      return;
    }
    if (!body?.slug) {
      sendJson(res, 400, { error: "slug is required" });
      return;
    }

    try {
      const thread = await ensureThread(body.slug);
      sendJson(res, 200, thread);
    } catch (error) {
      sendJson(res, 502, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && path === "/api/comments/cache/purge") {
    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      sendJson(res, 400, { error: `bad request: ${error.message}` });
      return;
    }
    if (!body?.slug) {
      sendJson(res, 400, { error: "slug is required" });
      return;
    }
    purgeThread(body.slug);
    res.writeHead(204, SECURITY_HEADERS);
    res.end();
    return;
  }

  sendJson(res, 404, { error: "not found" });
}

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    sendJson(res, 500, { error: error.message });
  });
});

server.listen(config.port, config.host, () => {
  console.log(`petwan-comments listening on ${config.host}:${config.port} for ${config.repo}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
