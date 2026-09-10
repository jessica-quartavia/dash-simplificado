/**
 * Dispatcher de acesso — GET current, GET users, POST/PATCH user.
 * Entrypoint: /api/analytics?action=access
 */
import { isAllowedCorporateEmail } from "../../js/corporateEmail.mjs";
import {
  ACCESS_DISABLED_MESSAGE,
  ACCESS_GROUPS,
  ACCESS_UNAUTHORIZED_MESSAGE,
  LAST_OWNER_MESSAGE,
  SELF_OWNER_LOCK_MESSAGE,
  buildAccessView,
  canDeactivateUser,
  canRevokeOwner,
  normalizeAccessEmail,
} from "./access-policy.mjs";
import {
  fetchAccessGroups,
  fetchAccessUserByEmail,
  fetchAccessUsers,
  insertAccessAudit,
  insertAccessUser,
  replaceUserGroups,
  updateAccessUser,
} from "./access-store.mjs";
import { requireOwnerAccess, resolveRequestAccess } from "./require-page-access.mjs";

function json(status, body) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function publicUser(user) {
  const view = buildAccessView(user);
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName || "",
    isOwner: user.isOwner,
    isActive: user.isActive,
    groups: user.groups,
    groupCodes: view.groups,
    groupLabels: view.groupLabels,
    updatedAt: user.updatedAt,
    updatedBy: user.updatedBy,
  };
}

function summarizeUsers(users) {
  const byGroup = Object.fromEntries(Object.keys(ACCESS_GROUPS).map((code) => [code, 0]));
  let owners = 0;
  let active = 0;
  let inactive = 0;
  for (const user of users) {
    if (user.isActive) active += 1;
    else inactive += 1;
    if (user.isOwner) owners += 1;
    for (const group of user.groups || []) {
      if (byGroup[group.code] != null) byGroup[group.code] += 1;
    }
  }
  return {
    users: users.length,
    active,
    owners,
    leaders: byGroup.leaders,
    eps: byGroup.eps,
    teamLeadersEp: byGroup.team_leaders_ep,
    quality: byGroup.quality,
    finance: byGroup.finance,
    inactive,
  };
}

function parseGroupCodes(input) {
  const raw = Array.isArray(input) ? input : [];
  return [...new Set(raw.map((item) => String(item || "").trim()).filter((code) => ACCESS_GROUPS[code]))];
}

async function resolveGroupIds(codes, { accessToken, loadGroups }) {
  const groups = await loadGroups({ accessToken });
  const byCode = new Map(groups.map((group) => [group.code, group]));
  const ids = [];
  for (const code of codes) {
    const group = byCode.get(code);
    if (!group) {
      const error = new Error(`Grupo inválido: ${code}`);
      error.status = 400;
      throw error;
    }
    ids.push(group.id);
  }
  return ids;
}

function snapshot(user) {
  return {
    email: user.email,
    displayName: user.displayName || "",
    isOwner: user.isOwner,
    isActive: user.isActive,
    groups: (user.groups || []).map((group) => group.code),
  };
}

async function writeAudit(store, entry, accessToken) {
  try {
    await store.insertAccessAudit(entry, { accessToken });
  } catch (error) {
    console.error("[access] audit failed", error instanceof Error ? error.message : error);
  }
}

async function handleCurrent(request, deps) {
  const resolved = await (deps.resolveRequestAccess || resolveRequestAccess)(request, deps);
  if (resolved.error) return resolved.error;
  return json(200, { access: resolved.access });
}

async function handleList(request, deps) {
  const owner = await (deps.requireOwnerAccess || requireOwnerAccess)(request, deps);
  if (owner.error) return owner.error;
  const loadUsers = deps.fetchAccessUsers || fetchAccessUsers;
  const users = await loadUsers({ accessToken: owner.accessToken });
  return json(200, {
    users: users.map(publicUser),
    summary: summarizeUsers(users),
    groups: Object.values(ACCESS_GROUPS),
  });
}

async function upsertUser(request, deps) {
  const owner = await (deps.requireOwnerAccess || requireOwnerAccess)(request, deps);
  if (owner.error) return owner.error;

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "JSON inválido.", code: "invalid_request" });
  }

  const store = {
    fetchAccessUsers: deps.fetchAccessUsers || fetchAccessUsers,
    fetchAccessUserByEmail: deps.fetchAccessUserByEmail || fetchAccessUserByEmail,
    fetchAccessGroups: deps.fetchAccessGroups || fetchAccessGroups,
    insertAccessUser: deps.insertAccessUser || insertAccessUser,
    updateAccessUser: deps.updateAccessUser || updateAccessUser,
    replaceUserGroups: deps.replaceUserGroups || replaceUserGroups,
    insertAccessAudit: deps.insertAccessAudit || insertAccessAudit,
  };

  const email = normalizeAccessEmail(body.email);
  if (!email || !isAllowedCorporateEmail(email)) {
    return json(400, { error: "Informe um e-mail @quartavia.com.br válido.", code: "invalid_email" });
  }

  const groupCodes = parseGroupCodes(body.groups || body.groupCodes);
  const users = await store.fetchAccessUsers({ accessToken: owner.accessToken });
  const existing = users.find((user) => user.email === email) || null;
  const actorEmail = normalizeAccessEmail(owner.user.email);
  const nextOwner = body.isOwner == null ? Boolean(existing?.isOwner) : Boolean(body.isOwner);
  const nextActive = body.isActive == null ? (existing ? existing.isActive : true) : Boolean(body.isActive);
  const displayName = body.displayName == null ? existing?.displayName || "" : String(body.displayName || "").trim();

  if (existing) {
    const ownerGuard = canRevokeOwner({
      actorEmail,
      target: existing,
      activeOwnerCount: users.filter((user) => (user.isOwner ?? user.is_owner) && (user.isActive ?? user.is_active)).length,
    });
    if (existing.isOwner && !nextOwner && !ownerGuard.ok) {
      return json(400, { error: ownerGuard.error, code: ownerGuard.code });
    }
    const activeGuard = canDeactivateUser({
      actorEmail,
      target: existing,
      activeOwnerCount: users.filter((user) => (user.isOwner ?? user.is_owner) && (user.isActive ?? user.is_active)).length,
    });
    if (existing.isActive && !nextActive && !activeGuard.ok) {
      return json(400, { error: activeGuard.error, code: activeGuard.code });
    }
    if (existing.isOwner && !nextOwner && actorEmail === existing.email) {
      return json(400, { error: SELF_OWNER_LOCK_MESSAGE, code: "self_lock" });
    }
  }

  const groupIds = await resolveGroupIds(groupCodes, {
    accessToken: owner.accessToken,
    loadGroups: store.fetchAccessGroups,
  });

  const oldValue = existing ? snapshot(existing) : null;
  let saved = existing;
  const actions = [];

  if (!existing) {
    saved = await store.insertAccessUser(
      { email, displayName, isOwner: nextOwner, isActive: nextActive, actorEmail },
      { accessToken: owner.accessToken },
    );
    saved = {
      id: saved.id,
      email: saved.email,
      displayName: saved.display_name || displayName,
      isOwner: Boolean(saved.is_owner),
      isActive: saved.is_active !== false,
      groups: [],
      updatedAt: saved.updated_at,
    };
    actions.push("USER_CREATED");
    if (nextOwner) actions.push("OWNER_GRANTED");
  } else {
    if (existing.displayName !== displayName || existing.isOwner !== nextOwner || existing.isActive !== nextActive) {
      saved = await store.updateAccessUser(
        existing.id,
        { displayName, isOwner: nextOwner, isActive: nextActive, actorEmail },
        { accessToken: owner.accessToken },
      );
      saved = {
        ...existing,
        displayName,
        isOwner: nextOwner,
        isActive: nextActive,
        updatedAt: saved?.updated_at || existing.updatedAt,
      };
    }
    if (!existing.isOwner && nextOwner) actions.push("OWNER_GRANTED");
    if (existing.isOwner && !nextOwner) actions.push("OWNER_REVOKED");
    if (!existing.isActive && nextActive) actions.push("ACTIVATED");
    if (existing.isActive && !nextActive) actions.push("DEACTIVATED");
  }

  const previousCodes = new Set((existing?.groups || []).map((group) => group.code));
  const nextCodes = new Set(groupCodes);
  for (const code of nextCodes) {
    if (!previousCodes.has(code)) actions.push("GROUP_ADDED");
  }
  for (const code of previousCodes) {
    if (!nextCodes.has(code)) actions.push("GROUP_REMOVED");
  }

  await store.replaceUserGroups(saved.id, groupIds, {
    accessToken: owner.accessToken,
    actorEmail,
  });

  const refreshed = await store.fetchAccessUserByEmail(email, { accessToken: owner.accessToken });
  const nextValue = snapshot(refreshed || { ...saved, groups: groupCodes.map((code) => ({ code })) });

  for (const action of actions.length ? actions : ["USER_UPDATED"]) {
    await writeAudit(store, {
      targetUserId: saved.id,
      targetEmail: email,
      action,
      oldValue,
      newValue: nextValue,
      changedBy: actorEmail,
    }, owner.accessToken);
  }

  return json(existing ? 200 : 201, { user: publicUser(refreshed || saved) });
}

export async function handleAccessRequest(request, deps = {}) {
  const method = request?.method || "GET";
  if (method !== "GET" && method !== "HEAD" && method !== "POST" && method !== "PATCH") {
    return json(405, { error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" });
  }

  try {
    if (method === "GET" || method === "HEAD") {
      const url = new URL(request.url || "http://localhost/api/analytics?action=access", "http://localhost");
      const scope = String(url.searchParams.get("scope") || "").trim();
      if (scope === "users") {
        const response = await handleList(request, deps);
        if (method === "HEAD") return new Response(null, { status: response.status, headers: { "Cache-Control": "no-store" } });
        return response;
      }
      const response = await handleCurrent(request, deps);
      if (method === "HEAD") return new Response(null, { status: response.status, headers: { "Cache-Control": "no-store" } });
      return response;
    }
    return await upsertUser(request, deps);
  } catch (error) {
    if (error?.code === "access_schema_missing") {
      return json(503, { error: error.message, code: error.code });
    }
    if (error?.status === 400) {
      return json(400, { error: error.message, code: "invalid_request" });
    }
    console.error("[access] failed:", error instanceof Error ? error.message : error);
    return json(500, { error: "Não foi possível processar o gerenciamento de acessos.", code: "access_failed" });
  }
}

export {
  ACCESS_DISABLED_MESSAGE,
  ACCESS_UNAUTHORIZED_MESSAGE,
  LAST_OWNER_MESSAGE,
};
