/**
 * Contexto de acesso no browser. UX apenas — autorização real é no servidor.
 */
import {
  ACCESS_DISABLED_MESSAGE,
  ACCESS_FORBIDDEN_MESSAGE,
  ACCESS_LEGACY_OWNER_MESSAGE,
  ACCESS_TECHNICAL_MESSAGE,
  ACCESS_UNAUTHORIZED_MESSAGE,
  canAccessPage,
  canPreloadPage,
  filterPagesForMenu,
  firstAllowedPageId,
  getPageAccessMetadata,
  normalizeAccessEmail,
} from "../lib/access/access-policy.mjs";

export { getPageAccessMetadata, ACCESS_LEGACY_OWNER_MESSAGE };

let currentAccess = null;

export function setCurrentAccess(access) {
  currentAccess = access || null;
}

export function clearCurrentAccess() {
  currentAccess = null;
}

export function getCurrentAccess() {
  return currentAccess;
}

export function isAccessReady() {
  return Boolean(currentAccess?.isActive);
}

export function canCurrentUserAccessPage(pageId) {
  return canAccessPage(currentAccess, pageId);
}

export function canCurrentUserPreloadPage(pageId) {
  return canPreloadPage(currentAccess, pageId);
}

export function getMenuGroups() {
  return filterPagesForMenu(currentAccess);
}

export function getHomePageId() {
  return firstAllowedPageId(currentAccess);
}

export function accessDenialMessage(code) {
  if (code === "access_disabled") return ACCESS_DISABLED_MESSAGE;
  if (code === "access_unauthorized") return ACCESS_UNAUTHORIZED_MESSAGE;
  if (code === "legacy_owner") return ACCESS_LEGACY_OWNER_MESSAGE;
  if (code === "forbidden") return ACCESS_FORBIDDEN_MESSAGE;
  return ACCESS_TECHNICAL_MESSAGE;
}

export async function fetchCurrentAccess(accessToken, { email = "" } = {}) {
  const isDev =
    typeof location !== "undefined" &&
    (location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.search.includes("authdebug=1"));
  if (isDev) {
    console.info("[access] session exists:", Boolean(accessToken));
    console.info("[access] user email:", email || "(ausente)");
    console.info("[access] normalized email:", normalizeAccessEmail(email));
    console.info("[access] access lookup started");
  }
  const response = await fetch("/api/analytics?action=access", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (isDev) {
    console.info("[access] access lookup completed", {
      status: response.status,
      code: payload.code || null,
      postgrestCode: payload.postgrestCode || null,
    });
  }
  if (!response.ok) {
    const error = new Error(accessDenialMessage(payload.code) === ACCESS_TECHNICAL_MESSAGE
      ? payload.error || ACCESS_TECHNICAL_MESSAGE
      : accessDenialMessage(payload.code));
    error.code = payload.code || "access_unavailable";
    error.status = response.status;
    throw error;
  }
  return payload.access;
}
