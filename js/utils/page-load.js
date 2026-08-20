import { authenticatedFetch } from "../auth.mjs";

export async function fetchPageJson(url, { force = false } = {}) {
  const target = force ? `${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}` : url;
  const response = await authenticatedFetch(target, force ? { cache: "no-store" } : {});
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(payload.error || "Não foi possível carregar os dados.");
    err.code = payload.code || String(response.status);
    throw err;
  }
  return payload;
}

export function mapLoadError(error) {
  const code = error?.code || "error";
  return {
    errorCode: code,
    error: code === "AUTH_REQUIRED" ? "Sessão expirada." : error?.message || "Não foi possível carregar os dados.",
  };
}
