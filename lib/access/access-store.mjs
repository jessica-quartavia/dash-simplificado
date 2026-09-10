/**
 * Persistência de acesso no Business Data / Auth.
 * Bootstrap via RPC em public (schema analytics não está na Data API).
 * REST em analytics fica como fallback depois que o schema for exposto.
 */
import { getAnalyticsEnv, analyticsCatalogConfigurationError, isBaseQvUrl, isSameSupabaseProject } from "../env.mjs";
import { classifyAccessPostgrestError, logAccessLookup } from "./access-postgrest-error.mjs";
import { normalizeAccessEmail } from "./access-policy.mjs";

const USER_SELECT = [
  "id",
  "email",
  "display_name",
  "is_owner",
  "is_active",
  "created_at",
  "updated_at",
  "created_by",
  "updated_by",
].join(",");

function restError(status, detail, code = "access_unavailable") {
  const error = new Error(detail || "Não foi possível verificar o acesso agora.");
  error.status = status;
  error.code = code;
  return error;
}

function throwClassified(status, payload) {
  const classified = classifyAccessPostgrestError(status, payload);
  const error = restError(status === 404 ? 503 : status || 503, classified.error, classified.code);
  error.postgrestCode = classified.postgrestCode;
  error.postgrestMessage = classified.postgrestMessage;
  throw error;
}

function analyticsHeaders({ accessToken, write = false, profile = "analytics" } = {}) {
  const source = process.env;
  const { url, anonKey, dataUrl } = getAnalyticsEnv(source);
  if (isSameSupabaseProject(url, dataUrl) || isBaseQvUrl(url)) {
    throw restError(503, "Recusou URL da BASE QV. Schema analytics vive no projeto Auth/Business Data.", "base_qv_refused");
  }
  const configError = analyticsCatalogConfigurationError(source);
  if (configError) throw restError(503, configError, "config");
  const token = String(accessToken || "").trim();
  if (!token) throw restError(401, "Sessão corporativa necessária para o schema analytics.", "unauthenticated");
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (profile) headers["Accept-Profile"] = profile;
  if (write) {
    headers["Content-Type"] = "application/json";
    headers["Content-Profile"] = profile || "public";
  }
  return { url: String(url || "").replace(/\/$/, ""), headers };
}

async function analyticsFetch(path, { accessToken, write = false, method = "GET", body, prefer, profile = "analytics" } = {}) {
  const { url, headers } = analyticsHeaders({ accessToken, write, profile });
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(new URL(path, `${url}/`), {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) throwClassified(response.status, payload || text);
  return payload;
}

function mapUserRow(row) {
  const rawGroups = Array.isArray(row?.groups) ? row.groups : [];
  const groups = rawGroups
    .map((group) => ({ id: group.id, code: group.code, name: group.name }))
    .filter((group) => group.code);
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || row.displayName || "",
    isOwner: Boolean(row.is_owner ?? row.isOwner),
    isActive: (row.is_active ?? row.isActive) !== false,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
    createdBy: row.created_by || row.createdBy || "",
    updatedBy: row.updated_by || row.updatedBy || "",
    groups,
  };
}

async function fetchGroupsForUser(userId, { accessToken } = {}) {
  try {
    const rows = await analyticsFetch(
      `/rest/v1/dashboard_user_groups?user_id=eq.${encodeURIComponent(userId)}&select=group_id,dashboard_access_groups(id,code,name,is_active)`,
      { accessToken },
    );
    return (Array.isArray(rows) ? rows : [])
      .map((item) => item?.dashboard_access_groups)
      .filter((group) => group?.code && group.is_active !== false)
      .map((group) => ({ id: group.id, code: group.code, name: group.name }));
  } catch (error) {
    if (error?.code === "access_schema_not_exposed") return [];
    throw error;
  }
}

async function fetchUserViaRpc(email, { accessToken } = {}) {
  const payload = await analyticsFetch("/rest/v1/rpc/current_dashboard_access", {
    accessToken,
    write: true,
    method: "POST",
    profile: "public",
    body: {},
  });
  if (!payload) return null;
  const mapped = mapUserRow(payload);
  if (mapped.email && mapped.email !== normalizeAccessEmail(email)) return null;
  return mapped;
}

async function fetchUserViaRest(email, { accessToken } = {}) {
  const normalized = normalizeAccessEmail(email);
  const rows = await analyticsFetch(
    `/rest/v1/dashboard_users?email=eq.${encodeURIComponent(normalized)}&select=${encodeURIComponent(USER_SELECT)}&limit=1`,
    { accessToken },
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  return { ...mapUserRow(row), groups: await fetchGroupsForUser(row.id, { accessToken }) };
}

export async function fetchAccessUserByEmail(email, { accessToken } = {}) {
  const normalized = normalizeAccessEmail(email);
  logAccessLookup("lookup started", { email: normalized });
  try {
    const viaRpc = await fetchUserViaRpc(normalized, { accessToken });
    logAccessLookup("lookup completed", { source: "rpc", found: Boolean(viaRpc), owner: Boolean(viaRpc?.isOwner) });
    return viaRpc;
  } catch (rpcError) {
    logAccessLookup("rpc failed", {
      code: rpcError?.code,
      postgrestCode: rpcError?.postgrestCode,
      status: rpcError?.status,
    });
    if (rpcError?.code === "unauthenticated" || rpcError?.code === "config" || rpcError?.code === "base_qv_refused") {
      throw rpcError;
    }
    try {
      const viaRest = await fetchUserViaRest(normalized, { accessToken });
      logAccessLookup("lookup completed", { source: "rest", found: Boolean(viaRest), owner: Boolean(viaRest?.isOwner) });
      return viaRest;
    } catch (restError) {
      logAccessLookup("rest failed", {
        code: restError?.code,
        postgrestCode: restError?.postgrestCode,
        status: restError?.status,
      });
      throw restError.code === "access_schema_not_exposed" ? restError : rpcError;
    }
  }
}

export async function fetchAccessUsers({ accessToken } = {}) {
  try {
    const payload = await analyticsFetch("/rest/v1/rpc/list_dashboard_access_users", {
      accessToken,
      write: true,
      method: "POST",
      profile: "public",
      body: {},
    });
    return (Array.isArray(payload) ? payload : []).map(mapUserRow);
  } catch (rpcError) {
    const rows = await analyticsFetch(
      `/rest/v1/dashboard_users?select=${encodeURIComponent(USER_SELECT)}&order=email.asc`,
      { accessToken },
    );
    const users = (Array.isArray(rows) ? rows : []).map(mapUserRow);
    return Promise.all(
      users.map(async (user) => ({
        ...user,
        groups: await fetchGroupsForUser(user.id, { accessToken }),
      })),
    );
  }
}

export async function fetchAccessGroups({ accessToken } = {}) {
  const rows = await analyticsFetch(
    "/rest/v1/dashboard_access_groups?select=id,code,name,description,is_active&order=name.asc",
    { accessToken },
  );
  return Array.isArray(rows) ? rows : [];
}

export async function insertAccessUser(input, { accessToken } = {}) {
  const rows = await analyticsFetch("/rest/v1/dashboard_users", {
    accessToken,
    write: true,
    method: "POST",
    prefer: "return=representation",
    body: {
      email: normalizeAccessEmail(input.email),
      display_name: input.displayName || null,
      is_owner: Boolean(input.isOwner),
      is_active: input.isActive !== false,
      created_by: input.actorEmail,
      updated_by: input.actorEmail,
    },
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function updateAccessUser(userId, patch, { accessToken } = {}) {
  const body = { updated_by: patch.actorEmail, updated_at: new Date().toISOString() };
  if (patch.displayName !== undefined) body.display_name = patch.displayName;
  if (patch.isOwner !== undefined) body.is_owner = Boolean(patch.isOwner);
  if (patch.isActive !== undefined) body.is_active = Boolean(patch.isActive);
  const rows = await analyticsFetch(`/rest/v1/dashboard_users?id=eq.${encodeURIComponent(userId)}`, {
    accessToken,
    write: true,
    method: "PATCH",
    prefer: "return=representation",
    body,
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function replaceUserGroups(userId, groupIds, { accessToken, actorEmail } = {}) {
  await analyticsFetch(`/rest/v1/dashboard_user_groups?user_id=eq.${encodeURIComponent(userId)}`, {
    accessToken,
    write: true,
    method: "DELETE",
  });
  if (!groupIds.length) return [];
  return analyticsFetch("/rest/v1/dashboard_user_groups", {
    accessToken,
    write: true,
    method: "POST",
    prefer: "return=representation",
    body: groupIds.map((groupId) => ({
      user_id: userId,
      group_id: groupId,
      created_by: actorEmail,
    })),
  });
}

export async function insertAccessAudit(entry, { accessToken } = {}) {
  return analyticsFetch("/rest/v1/dashboard_access_audit", {
    accessToken,
    write: true,
    method: "POST",
    prefer: "return=representation",
    body: {
      target_user_id: entry.targetUserId,
      target_email: normalizeAccessEmail(entry.targetEmail),
      action: entry.action,
      old_value: entry.oldValue ?? null,
      new_value: entry.newValue ?? null,
      changed_by: entry.changedBy,
    },
  });
}
