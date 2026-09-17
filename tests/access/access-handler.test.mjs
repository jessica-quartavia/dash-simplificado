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
  assert.equal(payload.summary.product, 0);
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
  const saved = [];
  const response = await handleAccessRequest(
    jsonRequest("http://localhost/api/analytics?action=access", {
      method: "POST",
      body: {
        mode: "create",
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
      saveAccessRecord: async (input) => {
        saved.push(input);
        return {
          id: "u-new",
          email: "maximo@quartavia.com.br",
          displayName: "Máximo",
          isOwner: false,
          isActive: true,
          groups: [
            { code: "leaders", name: "Líderes" },
            { code: "finance", name: "Financeiro" },
          ],
        };
      },
    },
  );
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.deepEqual(payload.user.groupCodes.sort(), ["finance", "leaders"]);
  assert.equal(saved[0].mode, "create");
  assert.ok(saved[0].audits.some((item) => item.action === "USER_CREATED"));
  assert.ok(saved[0].audits.some((item) => item.action === "GROUP_ADDED"));
});

test("domínio inválido é rejeitado", async () => {
  const response = await handleAccessRequest(
    jsonRequest("http://localhost/api/analytics?action=access", {
      method: "POST",
      body: { mode: "create", email: "pessoa@gmail.com", groups: ["eps"] },
    }),
    {
      requireOwnerAccess: async () => ({ user: { email: "ana@quartavia.com.br" }, accessToken: "t" }),
      fetchAccessUsers: async () => [userRecord()],
    },
  );
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.code, "invalid_email");
});

test("duplicado é rejeitado no create", async () => {
  const response = await handleAccessRequest(
    jsonRequest("http://localhost/api/analytics?action=access", {
      method: "POST",
      body: { mode: "create", email: "ana@quartavia.com.br", groups: ["leaders"] },
    }),
    {
      requireOwnerAccess: async () => ({ user: { email: "jessica@quartavia.com.br" }, accessToken: "t" }),
      fetchAccessUsers: async () => [userRecord()],
    },
  );
  assert.equal(response.status, 409);
  const payload = await response.json();
  assert.equal(payload.code, "duplicate_email");
});

test("edita nome, grupos e owner", async () => {
  const saved = [];
  const response = await handleAccessRequest(
    jsonRequest("http://localhost/api/analytics?action=access", {
      method: "POST",
      body: {
        mode: "update",
        email: "maximo@quartavia.com.br",
        displayName: "Máximo Marmund",
        groups: ["leaders", "finance"],
        isOwner: false,
        isActive: true,
      },
    }),
    {
      requireOwnerAccess: async () => ({ user: { email: "ana@quartavia.com.br" }, accessToken: "t" }),
      fetchAccessUsers: async () => [
        userRecord(),
        userRecord({
          id: "u2",
          email: "maximo@quartavia.com.br",
          displayName: "Máximo",
          isOwner: false,
          groups: [{ code: "leaders", name: "Líderes" }],
        }),
      ],
      saveAccessRecord: async (input) => {
        saved.push(input);
        return {
          id: "u2",
          email: "maximo@quartavia.com.br",
          displayName: input.displayName,
          isOwner: false,
          isActive: true,
          groups: [
            { code: "leaders", name: "Líderes" },
            { code: "finance", name: "Financeiro" },
          ],
        };
      },
    },
  );
  assert.equal(response.status, 200);
  assert.ok(saved[0].audits.some((item) => item.action === "GROUP_ADDED"));
  assert.ok(saved[0].audits.some((item) => item.action === "USER_UPDATED"));
});

test("cria Owner novo", async () => {
  const response = await handleAccessRequest(
    jsonRequest("http://localhost/api/analytics?action=access", {
      method: "POST",
      body: { mode: "create", email: "novo@quartavia.com.br", isOwner: true, isActive: true, groups: [] },
    }),
    {
      requireOwnerAccess: async () => ({ user: { email: "ana@quartavia.com.br" }, accessToken: "t" }),
      fetchAccessUsers: async () => [userRecord()],
      saveAccessRecord: async (input) => ({
        id: "u-owner",
        email: input.email,
        displayName: "",
        isOwner: true,
        isActive: true,
        groups: [],
      }),
    },
  );
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.user.isOwner, true);
});

test("remove grupo e desativa com auditoria", async () => {
  const saved = [];
  const response = await handleAccessRequest(
    jsonRequest("http://localhost/api/analytics?action=access", {
      method: "POST",
      body: {
        mode: "update",
        email: "maximo@quartavia.com.br",
        displayName: "Máximo",
        groups: ["finance"],
        isOwner: false,
        isActive: false,
      },
    }),
    {
      requireOwnerAccess: async () => ({ user: { email: "ana@quartavia.com.br" }, accessToken: "t" }),
      fetchAccessUsers: async () => [
        userRecord(),
        userRecord({
          id: "u2",
          email: "maximo@quartavia.com.br",
          displayName: "Máximo",
          isOwner: false,
          isActive: true,
          groups: [
            { code: "leaders", name: "Líderes" },
            { code: "finance", name: "Financeiro" },
          ],
        }),
      ],
      saveAccessRecord: async (input) => {
        saved.push(input);
        return {
          id: "u2",
          email: "maximo@quartavia.com.br",
          displayName: "Máximo",
          isOwner: false,
          isActive: false,
          groups: [{ code: "finance", name: "Financeiro" }],
        };
      },
    },
  );
  assert.equal(response.status, 200);
  assert.ok(saved[0].audits.some((item) => item.action === "GROUP_REMOVED"));
  assert.ok(saved[0].audits.some((item) => item.action === "DEACTIVATED"));
});

test("não-owner recebe 403 em mutação", async () => {
  const response = await handleAccessRequest(
    jsonRequest("http://localhost/api/analytics?action=access", {
      method: "POST",
      body: { mode: "create", email: "novo@quartavia.com.br", groups: ["eps"] },
    }),
    {
      requireOwnerAccess: async () => ({
        error: Response.json({ error: "Somente Owners podem gerenciar acessos.", code: "forbidden" }, { status: 403 }),
      }),
    },
  );
  assert.equal(response.status, 403);
});

test("exclui usuário comum e registra USER_DELETED", async () => {
  const deleted = [];
  const response = await handleAccessRequest(
    jsonRequest("http://localhost/api/analytics?action=access", {
      method: "DELETE",
      body: { email: "maximo@quartavia.com.br" },
    }),
    {
      requireOwnerAccess: async () => ({ user: { email: "ana@quartavia.com.br" }, accessToken: "t" }),
      fetchAccessUsers: async () => [
        userRecord(),
        userRecord({ id: "u2", email: "maximo@quartavia.com.br", isOwner: false, groups: [{ code: "leaders", name: "Líderes" }] }),
      ],
      deleteAccessRecord: async (input) => {
        deleted.push(input);
        return { deleted: true, email: input.email };
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(deleted[0].email, "maximo@quartavia.com.br");
  assert.equal(deleted[0].audits[0].action, "USER_DELETED");
});

test("não exclui o último Owner ativo", async () => {
  const response = await handleAccessRequest(
    jsonRequest("http://localhost/api/analytics?action=access", {
      method: "DELETE",
      body: { email: "ana@quartavia.com.br" },
    }),
    {
      requireOwnerAccess: async () => ({ user: { email: "jessica@quartavia.com.br" }, accessToken: "t" }),
      fetchAccessUsers: async () => [userRecord()],
    },
  );
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.code, "last_owner");
});

test("Owner não exclui a si mesmo", async () => {
  const response = await handleAccessRequest(
    jsonRequest("http://localhost/api/analytics?action=access", {
      method: "DELETE",
      body: { email: "ana@quartavia.com.br" },
    }),
    {
      requireOwnerAccess: async () => ({ user: { email: "ana@quartavia.com.br" }, accessToken: "t" }),
      fetchAccessUsers: async () => [userRecord(), userRecord({ id: "u2", email: "jessica@quartavia.com.br" })],
    },
  );
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.code, "self_lock");
});
