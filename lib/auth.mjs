/**
 * Validação de sessão nas APIs Vercel.
 * Tokens JWT pertencem ao projeto Auth — não misturar com BASE QV.
 */
import { getAuthEnv } from "./env.mjs";
import { isAllowedCorporateEmail } from "../js/corporateEmail.mjs";

const AUTH_CACHE_TTL_MS = 30_000;
const validatedTokens = new Map();
const validationsInFlight = new Map();

function jsonError(status, error, code) {
  return Response.json(
    { error, code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function getRequestAccessToken(request) {
  const header =
    request?.headers?.get?.("authorization") ||
    request?.headers?.get?.("Authorization") ||
    "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

export function redactSecrets(value) {
  return String(value || "")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+/g, "[redacted-jwt]");
}

async function requestAuthUser(authUrl, anonKey, token) {
  const cached = validatedTokens.get(token);
  if (cached?.expiresAt > Date.now()) return { user: cached.user };
  if (cached) validatedTokens.delete(token);

  let pending = validationsInFlight.get(token);
  if (!pending) {
    pending = (async () => {
      try {
        const response = await fetch(`${authUrl}/auth/v1/user`, {
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: anonKey,
          },
        });
        if (!response.ok) {
          return {
            status: response.status,
            details: (await response.text().catch(() => "")).slice(0, 240),
          };
        }
        const user = await response.json().catch(() => null);
        if (!user?.email) return { status: 401, details: "Auth API não retornou usuário." };
        validatedTokens.set(token, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
        return { user };
      } catch (error) {
        return {
          status: 0,
          details: error instanceof Error ? error.message : String(error),
        };
      }
    })();
    validationsInFlight.set(token, pending);
  }

  try {
    return await pending;
  } finally {
    validationsInFlight.delete(token);
  }
}

/**
 * Valida Bearer token no projeto de autenticação e domínio corporativo.
 * @param {Request} request
 * @returns {Promise<{ user: object } | { error: Response }>}
 */
export async function authenticateRequest(request) {
  const token = getRequestAccessToken(request);
  if (!token) {
    return { error: jsonError(401, "Não autenticado.", "unauthenticated") };
  }

  const { url: authUrl, anonKey } = getAuthEnv();
  if (!authUrl || !anonKey) {
    return {
      error: jsonError(
        503,
        "Configure AUTH_SUPABASE_URL e AUTH_SUPABASE_ANON_KEY.",
        "config",
      ),
    };
  }

  const authResult = await requestAuthUser(authUrl, anonKey, token);
  if (!authResult.user) {
    if (
      !authResult.status ||
      authResult.status === 408 ||
      authResult.status === 425 ||
      authResult.status === 429 ||
      authResult.status >= 500
    ) {
      return {
        error: jsonError(
          503,
          "Não foi possível validar a sessão agora. Tente novamente.",
          "auth_unavailable",
        ),
      };
    }
    return { error: jsonError(401, "Sessão inválida ou expirada.", "unauthenticated") };
  }

  const user = authResult.user;
  if (!user?.email) {
    return { error: jsonError(401, "Sessão inválida ou expirada.", "unauthenticated") };
  }

  if (!isAllowedCorporateEmail(user.email)) {
    return {
      error: jsonError(
        403,
        "O acesso é permitido somente para contas @quartavia.com.br.",
        "invalid_domain",
      ),
    };
  }

  return { user };
}

/**
 * Retorna Response de erro ou null se a sessão corporativa for válida.
 * @param {Request} request
 * @returns {Promise<Response | null>}
 */
export async function requireCorporateAuth(request) {
  const result = await authenticateRequest(request);
  return result.error || null;
}
