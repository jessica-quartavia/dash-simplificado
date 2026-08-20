/**
 * Ponte entre IncomingMessage/ServerResponse do Node e Fetch Request/Response.
 * Usada pelo handler Vercel e pelo servidor local — mesma API.
 */

function readRequestBody(req) {
  if (!req || req.method === "GET" || req.method === "HEAD") {
    return Promise.resolve(Buffer.alloc(0));
  }
  if (req.body != null) {
    if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
    if (typeof req.body === "string") return Promise.resolve(Buffer.from(req.body));
  }
  if (req.readableEnded) return Promise.resolve(Buffer.alloc(0));

  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function nodeToWebRequest(req) {
  const host = req.headers?.host || "localhost";
  const url = `http://${host}${req.url || "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers || {})) {
    if (value == null) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
  }

  const method = (req.method || "GET").toUpperCase();
  const init = { method, headers };

  if (method !== "GET" && method !== "HEAD") {
    const body = await readRequestBody(req);
    if (body.length > 0) {
      init.body = body;
      const contentType = headers.get("content-type");
      if (!contentType) {
        headers.set("Content-Type", "application/json; charset=utf-8");
      }
    }
  }

  return new Request(url, init);
}

export async function sendWebResponse(res, response, options = {}) {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  if (!headers["content-type"] && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json; charset=utf-8";
  }
  const body = Buffer.from(await response.arrayBuffer());
  const prefix = options.logPrefix || "http";
  console.info(`[${prefix}] write status=${response.status} bytes=${body.length}`);
  if (typeof res.status === "function" && typeof res.send === "function") {
    res.status(response.status);
    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }
    res.send(body);
    return;
  }
  if (!res.headersSent) {
    res.writeHead(response.status, headers);
  }
  res.end(body);
}
