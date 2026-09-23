/**
 * Gate de autorização de página — servidor. Nunca confiar no frontend.
 */
import { requireCorporateAuthUser } from "../auth.mjs";
import {
  ACCESS_DISABLED_MESSAGE,
  ACCESS_FORBIDDEN_MESSAGE,
  ACCESS_LEGACY_OWNER_MESSAGE,
  ACCESS_TECHNICAL_MESSAGE,
  ACCESS_UNAUTHORIZED_MESSAGE,
  buildAccessView,
  canAccessPage,
  getPageAccessMetadata,
  getPageForbiddenMessage,
  normalizeAccessEmail,
} from "./access-policy.mjs";
import { logAccessLookup } from "./access-postgrest-error.mjs";
import { fetchAccessUserByEmail } from "./access-store.mjs";

function json(status, body) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function accessDeniedResponse(code, error = ACCESS_UNAUTHORIZED_MESSAGE) {
  const technical = [
    "access_schema_missing",
    "access_schema_not_exposed",
    "access_rls_recursion",
    "access_unavailable",
  ].includes(code);
  return json(technical ? 503 : 403, { error, code });
}

export async function resolveRequestAccess(request, deps = {}) {
  const requireAuthUser = deps.requireCorporateAuthUser || requireCorporateAuthUser;
  const auth = await requireAuthUser(request);
  if (auth.error) return { error: auth.error };

  const email = normalizeAccessEmail(auth.user.email);
  logAccessLookup("resolve started", { email, session: true });
  const loadUser = deps.fetchAccessUserByEmail || fetchAccessUserByEmail;
  let user;
  try {
    user = await loadUser(email, { accessToken: auth.accessToken });
  } catch (error) {
    logAccessLookup("resolve failed", {
      email,
      code: error?.code || "access_unavailable",
      postgrestCode: error?.postgrestCode || null,
      status: error?.status || 503,
    });
    const code = error?.code || "access_unavailable";
    const technical = [
      "access_schema_missing",
      "access_schema_not_exposed",
      "access_rls_recursion",
      "access_unavailable",
      "config",
      "base_qv_refused",
    ].includes(code);
    return {
      error: json(technical ? 503 : error?.status || 503, {
        error: technical ? error?.message || ACCESS_TECHNICAL_MESSAGE : ACCESS_TECHNICAL_MESSAGE,
        code,
        postgrestCode: error?.postgrestCode || null,
      }),
    };
  }

  if (!user) {
    return { error: accessDeniedResponse("access_unauthorized", ACCESS_UNAUTHORIZED_MESSAGE) };
  }
  if (!user.isActive) {
    return { error: accessDeniedResponse("access_disabled", ACCESS_DISABLED_MESSAGE) };
  }

  const access = buildAccessView(user);
  return { user: auth.user, accessToken: auth.accessToken, access, record: user };
}

export async function requirePageAccess(request, pageId, deps = {}) {
  const resolved = await resolveRequestAccess(request, deps);
  if (resolved.error) return resolved.error;
  if (!canAccessPage(resolved.access, pageId)) {
    const meta = getPageAccessMetadata(pageId);
    if (meta.legacy && meta.ownerOnly) {
      return accessDeniedResponse("forbidden", ACCESS_LEGACY_OWNER_MESSAGE);
    }
    return accessDeniedResponse("forbidden", getPageForbiddenMessage(pageId));
  }
  return null;
}

export async function requireOwnerAccess(request, deps = {}) {
  const resolved = await resolveRequestAccess(request, deps);
  if (resolved.error) return { error: resolved.error };
  if (!resolved.access.isOwner) {
    return { error: accessDeniedResponse("forbidden", "Somente Owners podem gerenciar acessos.") };
  }
  return resolved;
}
