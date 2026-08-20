import { buildAuthConfigResult } from "../lib/env.mjs";

export default function handler(req, res) {
  const method = req.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    res.setHeader("Cache-Control", "no-store");
    res.status(405).json({ error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" });
    return;
  }

  const result = buildAuthConfigResult();
  res.setHeader("Cache-Control", result.headers["Cache-Control"]);
  res.status(result.status).json(result.body);
}
