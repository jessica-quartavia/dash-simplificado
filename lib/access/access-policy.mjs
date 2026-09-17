/**
 * Policy central de acesso do Analytics V2.
 * Compartilhada por frontend e backend. Sem I/O, sem e-mail hardcoded nas regras de página.
 */
import { PAGES, PAGE_GROUPS, DEFAULT_PAGE_ID, getPageById } from "../../js/pages.js";

export const ACCESS_UNAUTHORIZED_MESSAGE = "Seu usuário não possui acesso ao Analytics.";
export const ACCESS_DISABLED_MESSAGE = "Seu acesso ao Analytics está desativado.";
export const ACCESS_TECHNICAL_MESSAGE = "Não foi possível verificar o acesso agora.";
export const ACCESS_FORBIDDEN_MESSAGE = "Você não possui permissão para acessar esta área.";
export const ACCESS_LEGACY_OWNER_MESSAGE = "Esta página é um conteúdo legado disponível apenas para Owners.";
export const LAST_OWNER_MESSAGE = "É necessário manter pelo menos um Owner ativo.";
export const SELF_OWNER_LOCK_MESSAGE = "Outro Owner precisa alterar o seu próprio acesso.";

export const ACCESS_GROUP_CODES = Object.freeze([
  "leaders",
  "eps",
  "team_leaders_ep",
  "quality",
  "finance",
  "product",
]);

export const ACCESS_GROUPS = Object.freeze({
  leaders: { code: "leaders", name: "Líderes", description: "Acesso amplo aos dashboards, exceto páginas em construção e gerenciamento." },
  eps: { code: "eps", name: "EPs", description: "Visão geral sem Relatórios e Jornada sem Uso da Plataforma." },
  team_leaders_ep: { code: "team_leaders_ep", name: "Team Leaders EP", description: "Herdam EPs e ganham Relatórios e Performance do EP." },
  quality: { code: "quality", name: "Qualidade", description: "Dados Gerais, Satisfação, Cancelamento e Renovação." },
  finance: { code: "finance", name: "Financeiro", description: "Resumo Executivo, Dados Gerais, Cancelamento e Renovação." },
  product: { code: "product", name: "Produto", description: "Herdam as permissões de Líderes." },
});

export const ACCESS_GROUP_INHERITANCE = Object.freeze({
  team_leaders_ep: Object.freeze(["eps"]),
  product: Object.freeze(["leaders"]),
});

const DEFAULT_PAGE_METADATA = Object.freeze({
  legacy: false,
  ownerOnly: false,
  preload: true,
  badge: null,
});

export const PAGE_ACCESS_METADATA = Object.freeze({
  support: Object.freeze({
    legacy: true,
    ownerOnly: true,
    preload: false,
    badge: "Legado",
  }),
});

export function getPageAccessMetadata(pageId) {
  return PAGE_ACCESS_METADATA[pageId] || DEFAULT_PAGE_METADATA;
}

export const ACCESS_MANAGEMENT_PAGE_ID = "access_management";

const JOURNEY_PAGE_IDS = Object.freeze(
  PAGES.filter((page) => page.group === "journey").map((page) => page.id),
);

const EP_BASE_PAGES = Object.freeze([
  "executive_summary",
  "general",
  ...JOURNEY_PAGE_IDS.filter((id) => id !== "platform_usage"),
]);

const QUALITY_PAGES = Object.freeze(["general", "satisfaction", "support", "cancellations", "renewal"]);
const FINANCE_PAGES = Object.freeze(["general", "executive_summary", "cancellations", "renewal"]);
const TEAM_LEADER_EXTRA_PAGES = Object.freeze(["reports", "ep_performance"]);

/** Páginas explicitamente permitidas por grupo, antes de herança e construção. */
export const PAGE_ACCESS_REGISTRY = Object.freeze({
  executive_summary: Object.freeze(["leaders", "eps", "finance"]),
  general: Object.freeze(["leaders", "eps", "quality", "finance"]),
  reports: Object.freeze(["leaders", "team_leaders_ep"]),
  journey: Object.freeze(["leaders", "eps"]),
  meetings: Object.freeze(["leaders", "eps"]),
  patrimonial_plan: Object.freeze(["leaders", "eps"]),
  mechanisms: Object.freeze(["leaders", "eps"]),
  platform_usage: Object.freeze(["leaders"]),
  financial_updates: Object.freeze(["leaders", "eps"]),
  support: Object.freeze(["leaders", "eps", "quality"]),
  satisfaction: Object.freeze(["leaders", "eps", "quality"]),
  cancellations: Object.freeze(["leaders", "quality", "finance"]),
  renewal: Object.freeze(["leaders", "quality", "finance"]),
  ep_performance: Object.freeze(["leaders", "team_leaders_ep"]),
  temporal_indicators: Object.freeze(["leaders"]),
  statistical_crosses: Object.freeze(["leaders"]),
  health_score: Object.freeze(["leaders"]),
  quality: Object.freeze(["leaders"]),
  metrics_documentation: Object.freeze(["leaders"]),
  access_management: Object.freeze(["owner"]),
});

export const API_PAGE_MAP = Object.freeze({
  "/api/executive-summary": "executive_summary",
  "/api/general-data": "general",
  "/api/onboarding": "journey",
  "/api/meetings": "meetings",
  "/api/patrimonial-plan": "patrimonial_plan",
  "/api/mechanisms": "mechanisms",
  "/api/financial-updates": "financial_updates",
  "/api/satisfaction": "satisfaction",
  "/api/cancellations": "cancellations",
  "/api/renewal": "renewal",
  "/api/ep-performance": "ep_performance",
  "/api/ep-performance/details": "ep_performance",
  "/api/temporal-indicators": "temporal_indicators",
  "/api/temporal-indicators/details": "temporal_indicators",
  "/api/statistical-crosses": "statistical_crosses",
  "/api/health-score": "health_score",
  "/api/quality": "quality",
  "/api/platform-usage": "platform_usage",
  "/api/support": "support",
  "/api/reports": "reports",
  catalog: "metrics_documentation",
  snapshot: "quality",
  refresh: "quality",
  "refresh-statistical-snapshot": "statistical_crosses",
});

export function normalizeAccessEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function isUnderConstructionPage(pageOrId) {
  const page = typeof pageOrId === "string" ? getPageById(pageOrId) : pageOrId;
  if (!page) return false;
  if (page.isUnderConstruction === true) return true;
  return Boolean(String(page.constructionNotice || "").trim() || page.titleSuffix === "🔧");
}

export function expandAccessGroups(groupCodes = []) {
  const expanded = new Set();
  const queue = [...groupCodes].filter((code) => ACCESS_GROUPS[code]);
  while (queue.length) {
    const code = queue.shift();
    if (expanded.has(code)) continue;
    expanded.add(code);
    for (const parent of ACCESS_GROUP_INHERITANCE[code] || []) {
      if (!expanded.has(parent)) queue.push(parent);
    }
  }
  return [...expanded];
}

export function pagesGrantedByGroups(groupCodes = []) {
  const expanded = expandAccessGroups(groupCodes);
  const pages = new Set();
  if (expanded.includes("leaders")) {
    for (const page of PAGES) {
      if (page.id !== ACCESS_MANAGEMENT_PAGE_ID) pages.add(page.id);
    }
  }
  if (expanded.includes("eps")) {
    for (const id of EP_BASE_PAGES) pages.add(id);
  }
  if (expanded.includes("team_leaders_ep")) {
    for (const id of TEAM_LEADER_EXTRA_PAGES) pages.add(id);
  }
  if (expanded.includes("quality")) {
    for (const id of QUALITY_PAGES) pages.add(id);
  }
  if (expanded.includes("finance")) {
    for (const id of FINANCE_PAGES) pages.add(id);
  }
  return pages;
}

/**
 * @param {{ isOwner?: boolean, isActive?: boolean, groups?: string[] }} access
 * @param {string} pageId
 */
export function canAccessPage(access, pageId) {
  if (!access || access.isActive === false) return false;
  if (!pageId || !getPageById(pageId)) return false;
  if (access.isOwner) return true;

  const meta = getPageAccessMetadata(pageId);
  if (meta.ownerOnly) return false;

  const granted = pagesGrantedByGroups(access.groups || []);
  if (!granted.has(pageId)) return false;
  if (isUnderConstructionPage(pageId)) return false;
  if (pageId === ACCESS_MANAGEMENT_PAGE_ID) return false;
  return true;
}

export function listAllowedPages(access) {
  return PAGES.filter((page) => canAccessPage(access, page.id));
}

export function listAllowedPageIds(access) {
  return listAllowedPages(access).map((page) => page.id);
}

export function firstAllowedPageId(access, preferredId = DEFAULT_PAGE_ID) {
  if (canAccessPage(access, preferredId)) return preferredId;
  const allowed = listAllowedPages(access);
  return allowed[0]?.id || null;
}

export function decoratePageForMenu(access, page) {
  const meta = getPageAccessMetadata(page.id);
  const allowed = canAccessPage(access, page.id);
  return {
    ...page,
    allowed,
    disabled: Boolean((meta.legacy || meta.ownerOnly) && !allowed),
    menuBadge: meta.badge ? { label: meta.badge, kind: meta.legacy ? "legacy" : "meta" } : null,
    visible: allowed || Boolean(meta.legacy),
  };
}

export function filterPagesForMenu(access) {
  return PAGE_GROUPS.map((group) => ({
    ...group,
    pages: PAGES.filter((page) => page.group === group.id)
      .map((page) => decoratePageForMenu(access, page))
      .filter((page) => page.visible),
  })).filter((group) => group.pages.length > 0);
}

export function canPreloadPage(access, pageId) {
  const meta = getPageAccessMetadata(pageId);
  if (meta.preload === false) return false;
  if (pageId === ACCESS_MANAGEMENT_PAGE_ID) return false;
  return canAccessPage(access, pageId);
}

export function resolvePageIdForApi(pathname, searchParams = new URLSearchParams()) {
  const path = String(pathname || "/").replace(/\/$/, "") || "/";
  if (API_PAGE_MAP[path]) return API_PAGE_MAP[path];
  const page = String(searchParams.get("page") || "").trim();
  if (page && getPageById(page)) return page;
  const action = String(searchParams.get("action") || "").trim();
  if (action && API_PAGE_MAP[action]) return API_PAGE_MAP[action];
  return null;
}

function tagKindForGroup(code) {
  return code === "product" ? "product" : "group";
}

/** Tags visuais da listagem de acessos. Owner nunca cai em "Sem time". */
export function buildAccessUserTags(user) {
  const tags = [];
  if (Boolean(user?.isOwner ?? user?.is_owner)) {
    tags.push({ label: "Owner", kind: "owner" });
  }
  const codes = Array.isArray(user?.groupCodes)
    ? user.groupCodes.map((code) => String(code || "").trim()).filter((code) => ACCESS_GROUPS[code])
    : Array.isArray(user?.groups)
      ? user.groups.map((item) => item?.code || item).filter((code) => ACCESS_GROUPS[code])
      : [];
  if (codes.length) {
    for (const code of codes) {
      tags.push({ label: ACCESS_GROUPS[code].name, kind: tagKindForGroup(code) });
    }
  } else {
    const labels = Array.isArray(user?.groupLabels)
      ? user.groupLabels.map((label) => String(label || "").trim()).filter(Boolean)
      : [];
    for (const label of labels) {
      tags.push({ label, kind: label === ACCESS_GROUPS.product.name ? "product" : "group" });
    }
  }
  if (!tags.length) {
    tags.push({ label: "Sem time", kind: "empty" });
  }
  return tags;
}

export function buildAccessView(user) {
  const groups = [...new Set((user?.groups || []).map((item) => item.code || item).filter((code) => ACCESS_GROUPS[code]))];
  const access = {
    userId: user?.id || null,
    email: normalizeAccessEmail(user?.email),
    displayName: user?.displayName || user?.display_name || "",
    isOwner: Boolean(user?.isOwner ?? user?.is_owner),
    isActive: user?.isActive ?? user?.is_active ?? false,
    groups,
    groupLabels: groups.map((code) => ACCESS_GROUPS[code].name),
  };
  const allowedPageIds = listAllowedPageIds(access);
  return {
    ...access,
    allowedPageIds,
    defaultPageId: firstAllowedPageId(access),
    canManageAccess: Boolean(access.isOwner && access.isActive),
  };
}

function isOwnerFlag(user) {
  return Boolean(user?.isOwner ?? user?.is_owner);
}

function isActiveFlag(user) {
  return user?.isActive ?? user?.is_active ?? false;
}

export function countActiveOwners(users = []) {
  return users.filter((user) => isOwnerFlag(user) && isActiveFlag(user)).length;
}

export function canRevokeOwner({ actorEmail, target, activeOwnerCount }) {
  if (normalizeAccessEmail(actorEmail) === normalizeAccessEmail(target.email)) {
    return { ok: false, code: "self_lock", error: SELF_OWNER_LOCK_MESSAGE };
  }
  if (isOwnerFlag(target) && activeOwnerCount <= 1) {
    return { ok: false, code: "last_owner", error: LAST_OWNER_MESSAGE };
  }
  return { ok: true };
}

export function canDeactivateUser({ actorEmail, target, activeOwnerCount }) {
  if (normalizeAccessEmail(actorEmail) === normalizeAccessEmail(target.email)) {
    return { ok: false, code: "self_lock", error: SELF_OWNER_LOCK_MESSAGE };
  }
  if (isOwnerFlag(target) && isActiveFlag(target) && activeOwnerCount <= 1) {
    return { ok: false, code: "last_owner", error: LAST_OWNER_MESSAGE };
  }
  return { ok: true };
}

export function canDeleteUser({ actorEmail, target, activeOwnerCount }) {
  if (normalizeAccessEmail(actorEmail) === normalizeAccessEmail(target.email)) {
    return { ok: false, code: "self_lock", error: SELF_OWNER_LOCK_MESSAGE };
  }
  if (isOwnerFlag(target) && isActiveFlag(target) && activeOwnerCount <= 1) {
    return { ok: false, code: "last_owner", error: LAST_OWNER_MESSAGE };
  }
  return { ok: true };
}

export const ACCESS_POLICY_NOTES = Object.freeze({
  epBasePages: EP_BASE_PAGES,
  qualityPages: QUALITY_PAGES,
  financePages: FINANCE_PAGES,
  teamLeaderExtraPages: TEAM_LEADER_EXTRA_PAGES,
  journeyPageIds: JOURNEY_PAGE_IDS,
});
