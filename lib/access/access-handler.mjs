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
  canDeleteUser,
  canRevokeOwner,
  normalizeAccessEmail,
} from "./access-policy.mjs";
import {
  deleteAccessRecord,
  fetchAccessUsers,
  saveAccessRecord,
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
    product: byGroup.product,
    inactive,
  };
}

function parseGroupCodes(input) {
  const raw = Array.isArray(input) ? input : [];
  return [...new Set(raw.map((item) => String(item || "").trim()).filter((code) => ACCESS_GROUPS[code]))];
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

function collectAudits({ existing, nextOwner, nextActive, groupCodes, displayName }) {
  const previousCodes = new Set((existing?.groups || []).map((group) => group.code));
  const nextCodes = new Set(groupCodes);
  const actions = [];
  if (!existing) {
    actions.push("USER_CREATED");
    if (nextOwner) actions.push("OWNER_GRANTED");
  } else {
    if (existing.displayName !== displayName || existing.isOwner !== nextOwner || existing.isActive !== nextActive) {
      actions.push("USER_UPDATED");
    }
    if (!existing.isOwner && nextOwner) actions.push("OWNER_GRANTED");
    if (existing.isOwner && !nextOwner) actions.push("OWNER_REVOKED");
    if (!existing.isActive && nextActive) actions.push("ACTIVATED");
    if (existing.isActive && !nextActive) actions.push("DEACTIVATED");
  }
  for (const code of nextCodes) {
    if (!previousCodes.has(code)) actions.push("GROUP_ADDED");
  }
  for (const code of previousCodes) {
    if (!nextCodes.has(code)) actions.push("GROUP_REMOVED");
  }
  return actions.length ? actions : existing ? ["USER_UPDATED"] : ["USER_CREATED"];
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

function activeOwnerCount(users) {
  return users.filter((user) => (user.isOwner ?? user.is_owner) && (user.isActive ?? user.is_active)).length;
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

  const loadUsers = deps.fetchAccessUsers || fetchAccessUsers;
  const persist = deps.saveAccessRecord || saveAccessRecord;

  const email = normalizeAccessEmail(body.email);
  if (!email || !isAllowedCorporateEmail(email)) {
    return json(400, { error: "Informe um e-mail @quartavia.com.br válido.", code: "invalid_email" });
  }

  const groupCodes = parseGroupCodes(body.groups || body.groupCodes);
  const users = await loadUsers({ accessToken: owner.accessToken });
  const existing = users.find((user) => user.email === email) || null;
  const actorEmail = normalizeAccessEmail(owner.user.email);
  const mode = body.mode === "update" || existing ? "update" : "create";
  if (body.mode === "create" && existing) {
    return json(409, { error: "Este email já possui acesso.", code: "duplicate_email" });
  }
  if (mode === "update" && !existing) {
    return json(404, { error: "Usuário não encontrado.", code: "not_found" });
  }

  const nextOwner = body.isOwner == null ? Boolean(existing?.isOwner) : Boolean(body.isOwner);
  const nextActive = body.isActive == null ? (existing ? existing.isActive : true) : Boolean(body.isActive);
  const displayName = body.displayName == null ? existing?.displayName || "" : String(body.displayName || "").trim();
  const owners = activeOwnerCount(users);

  if (existing) {
    if (existing.isOwner && !nextOwner) {
      const ownerGuard = canRevokeOwner({ actorEmail, target: existing, activeOwnerCount: owners });
      if (!ownerGuard.ok) return json(400, { error: ownerGuard.error, code: ownerGuard.code });
    }
    if (existing.isActive && !nextActive) {
      const activeGuard = canDeactivateUser({ actorEmail, target: existing, activeOwnerCount: owners });
      if (!activeGuard.ok) return json(400, { error: activeGuard.error, code: activeGuard.code });
    }
  }

  const oldValue = existing ? snapshot(existing) : null;
  const nextValue = {
    email,
    displayName,
    isOwner: nextOwner,
    isActive: nextActive,
    groups: groupCodes,
  };
  const actions = collectAudits({ existing, nextOwner, nextActive, groupCodes, displayName });
  const audits = actions.map((action) => ({
    action,
    old_value: oldValue,
    new_value: nextValue,
  }));

  const saved = await persist(
    {
      mode,
      email,
      displayName,
      isOwner: nextOwner,
      isActive: nextActive,
      groups: groupCodes,
      audits,
    },
    { accessToken: owner.accessToken },
  );
  const view = publicUser({
    ...saved,
    displayName: saved.displayName || displayName,
    groups: saved.groups?.length ? saved.groups : groupCodes.map((code) => ({ code, name: ACCESS_GROUPS[code]?.name })),
  });
  return json(existing ? 200 : 201, { user: view });
}

async function deleteUser(request, deps) {
  const owner = await (deps.requireOwnerAccess || requireOwnerAccess)(request, deps);
  if (owner.error) return owner.error;

  let body = {};
  try {
    const url = new URL(request.url || "http://localhost/api/analytics?action=access", "http://localhost");
    body = await request.json().catch(() => ({}));
    if (!body.email) body.email = url.searchParams.get("email") || "";
  } catch {
    body = {};
  }

  const loadUsers = deps.fetchAccessUsers || fetchAccessUsers;
  const remove = deps.deleteAccessRecord || deleteAccessRecord;
  const email = normalizeAccessEmail(body.email);
  if (!email) return json(400, { error: "Informe um e-mail válido.", code: "invalid_email" });

  const users = await loadUsers({ accessToken: owner.accessToken });
  const existing = users.find((user) => user.email === email) || null;
  if (!existing) return json(404, { error: "Usuário não encontrado.", code: "not_found" });

  const actorEmail = normalizeAccessEmail(owner.user.email);
  const guard = canDeleteUser({
    actorEmail,
    target: existing,
    activeOwnerCount: activeOwnerCount(users),
  });
  if (!guard.ok) return json(400, { error: guard.error, code: guard.code });

  const oldValue = snapshot(existing);
  await remove(
    {
      email,
      audits: [{ action: "USER_DELETED", old_value: oldValue, new_value: null }],
    },
    { accessToken: owner.accessToken },
  );
  return json(200, { deleted: true, email });
}

export async function handleAccessRequest(request, deps = {}) {
  const method = request?.method || "GET";
  if (!["GET", "HEAD", "POST", "PATCH", "DELETE"].includes(method)) {
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
    if (method === "DELETE") return await deleteUser(request, deps);
    return await upsertUser(request, deps);
  } catch (error) {
    if (["duplicate_email", "forbidden", "not_found", "invalid_request", "invalid_email"].includes(error?.code)) {
      return json(error.status || 400, { error: error.message, code: error.code });
    }
    if (error?.code === "access_schema_missing" || error?.code === "access_unavailable") {
      return json(error.status || 503, { error: error.message, code: error.code });
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
