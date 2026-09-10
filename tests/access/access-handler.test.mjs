import assert from "node:assert/strict";
import { test } from "node:test";
import { handleAccessRequest } from "../../lib/access/access-handler.mjs";
import { ACCESS_DISABLED_MESSAGE, ACCESS_UNAUTHORIZED_MESSAGE } from "../../lib/access/access-policy.mjs";

function jsonRequest(url, { method = "GET", body } = {}) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", authorization: "Bearer test" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const groups = [
  { id: "g-leaders", code: "leaders", name: "Líderes", is_active: true },
  { id: "g-finance", code: "finance", name: "Financeiro", is_active: true },
];

function userRecord(overrides = {}) {
  return {
    id: "u1",
    email: "ana@quartavia.com.br",
    displayName: "Ana",
    isOwner: true,
    isActive: true,
    groups: [{ id: "g-leaders", code: "leaders", name: "Líderes" }],
    updatedAt: "2026-09-10T12:00:00.000Z",
    ...overrides,
  };
}

test("usuário não cadastrado → 403 access_unauthorized", async () => {
  const response = await handleAccessRequest(jsonRequest("http://localhost/api/analytics?action=access"), {
    resolveRequestAccess: async () => ({
      error: Response.json({ error: ACCESS_UNAUTHORIZED_MESSAGE, code: "access_unauthorized" }, { status: 403 }),
    }),
  });
  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.equal(payload.code, "access_unauthorized");
});

test("usuário inativo → 403 access_disabled", async () => {
  const response = await handleAccessRequest(jsonRequest("http://localhost/api/analytics?action=access"), {
    resolveRequestAccess: async () => ({
      error: Response.json({ error: ACCESS_DISABLED_MESSAGE, code: "access_disabled" }, { status: 403 }),
    }),
  });
  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.equal(payload.code, "access_disabled");
});

test("GET current devolve permissões calculadas", async () => {
  const response = await handleAccessRequest(jsonRequest("http://localhost/api/analytics?action=access"), {
    resolveRequestAccess: async () => ({
      user: { email: "ana@quartavia.com.br" },
      accessToken: "t",
      access: { email: "ana@quartavia.com.br", isOwner: true, isActive: true, allowedPageIds: ["general"] },
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.access.isOwner, true);
});

test("listagem exige Owner", async () => {
  const response = await handleAccessRequest(jsonRequest("http://localhost/api/analytics?action=access&scope=users"), {
    requireOwnerAccess: async () => ({
      error: Response.json({ error: "Somente Owners podem gerenciar acessos.", code: "forbidden" }, { status: 403 }),
    }),
  });
  assert.equal(response.status, 403);
});

test("Owner lista usuários e summary", async () => {
  const users = [
    userRecord(),
    userRecord({
      id: "u2",
      email: "maximo@quartavia.com.br",
      isOwner: false,
      groups: [
        { code: "leaders", name: "Líderes" },
        { code: "finance", name: "Financeiro" },
      ],
    }),
  ];
  const response = await handleAccessRequest(jsonRequest("http://localhost/api/analytics?action=access&scope=users"), {
    requireOwnerAccess: async () => ({ user: { email: "ana@quartavia.com.br" }, accessToken: "t" }),
    fetchAccessUsers: async () => users,
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.summary.active, 2);
  assert.equal(payload.summary.owners, 1);
  assert.equal(payload.summary.leaders, 2);
  assert.equal(payload.summary.finance, 1);
});

test("último owner não pode ser revogado", async () => {
  const response = await handleAccessRequest(
    jsonRequest("http://localhost/api/analytics?action=access", {
      method: "POST",
      body: { email: "ana@quartavia.com.br", isOwner: false, isActive: true, groups: ["leaders"] },
    }),
    {
      requireOwnerAccess: async () => ({ user: { email: "jessica@quartavia.com.br" }, accessToken: "t" }),
      fetchAccessUsers: async () => [userRecord()],
      fetchAccessGroups: async () => groups,
    },
  );
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.code, "last_owner");
});

test("Owner não altera o próprio Owner/status", async () => {
  const response = await handleAccessRequest(
    jsonRequest("http://localhost/api/analytics?action=access", {
      method: "POST",
      body: { email: "ana@quartavia.com.br", isOwner: true, isActive: false, groups: ["leaders"] },
    }),
    {
      requireOwnerAccess: async () => ({ user: { email: "ana@quartavia.com.br" }, accessToken: "t" }),
      fetchAccessUsers: async () => [userRecord(), userRecord({ id: "u2", email: "jessica@quartavia.com.br" })],
      fetchAccessGroups: async () => groups,
    },
  );
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.code, "self_lock");
});

test("cria usuário com múltiplos times e registra auditoria", async () => {
  const audits = [];
  const response = await handleAccessRequest(
    jsonRequest("http://localhost/api/analytics?action=access", {
      method: "POST",
      body: {
        email: "maximo@quartavia.com.br",
        displayName: "Máximo",
        groups: ["leaders", "finance"],
        isOwner: false,
        isActive: true,
      },
    }),
    {
      requireOwnerAccess: async () => ({ user: { email: "ana@quartavia.com.br" }, accessToken: "t" }),
      fetchAccessUsers: async () => [userRecord()],
      fetchAccessGroups: async () => groups,
      insertAccessUser: async () => ({
        id: "u-new",
        email: "maximo@quartavia.com.br",
        display_name: "Máximo",
        is_owner: false,
        is_active: true,
      }),
      replaceUserGroups: async () => [],
      fetchAccessUserByEmail: async () => ({
        id: "u-new",
        email: "maximo@quartavia.com.br",
        displayName: "Máximo",
        isOwner: false,
        isActive: true,
        groups: [
          { code: "leaders", name: "Líderes" },
          { code: "finance", name: "Financeiro" },
        ],
      }),
      insertAccessAudit: async (entry) => {
        audits.push(entry);
      },
    },
  );
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.deepEqual(payload.user.groupCodes.sort(), ["finance", "leaders"]);
  assert.ok(audits.some((item) => item.action === "USER_CREATED"));
  assert.ok(audits.some((item) => item.action === "GROUP_ADDED"));
});
