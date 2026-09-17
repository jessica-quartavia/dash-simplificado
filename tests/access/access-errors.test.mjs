import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCESS_DISABLED_MESSAGE,
  ACCESS_FORBIDDEN_MESSAGE,
  ACCESS_LEGACY_OWNER_MESSAGE,
  ACCESS_TECHNICAL_MESSAGE,
  ACCESS_UNAUTHORIZED_MESSAGE,
} from "../../lib/access/access-policy.mjs";
import { classifyAccessPostgrestError } from "../../lib/access/access-postgrest-error.mjs";
import { requirePageAccess, resolveRequestAccess } from "../../lib/access/require-page-access.mjs";
import { accessDenialMessage } from "../../js/access-context.js";

test("PGRST106 vira erro técnico, não unauthorized", () => {
  const classified = classifyAccessPostgrestError(406, {
    code: "PGRST106",
    message: "Invalid schema: analytics",
    hint: "Only the following schemas are exposed: public",
  });
  assert.equal(classified.code, "access_schema_not_exposed");
  assert.equal(classified.error, ACCESS_TECHNICAL_MESSAGE);
});

test("tabela ausente vira access_schema_missing", () => {
  const classified = classifyAccessPostgrestError(404, {
    code: "PGRST205",
    message: "Could not find the table 'analytics.dashboard_users' in the schema cache",
  });
  assert.equal(classified.code, "access_schema_missing");
});

test("mensagens de UI não se misturam", () => {
  assert.equal(accessDenialMessage("access_unauthorized"), ACCESS_UNAUTHORIZED_MESSAGE);
  assert.equal(accessDenialMessage("access_disabled"), ACCESS_DISABLED_MESSAGE);
  assert.equal(accessDenialMessage("forbidden"), ACCESS_FORBIDDEN_MESSAGE);
  assert.equal(accessDenialMessage("access_schema_not_exposed"), ACCESS_TECHNICAL_MESSAGE);
  assert.equal(ACCESS_UNAUTHORIZED_MESSAGE, "Seu usuário não possui acesso ao Analytics.");
  assert.equal(ACCESS_DISABLED_MESSAGE, "Seu acesso ao Analytics está desativado.");
});

test("owner ativo entra", async () => {
  const resolved = await resolveRequestAccess(new Request("http://localhost/api/analytics?action=access"), {
    requireCorporateAuthUser: async () => ({
      user: { email: "jessicacarvalho@quartavia.com.br" },
      accessToken: "t",
    }),
    fetchAccessUserByEmail: async () => ({
      id: "1",
      email: "jessicacarvalho@quartavia.com.br",
      isOwner: true,
      isActive: true,
      groups: [],
    }),
  });
  assert.equal(resolved.access.isOwner, true);
  assert.equal(resolved.access.isActive, true);
  assert.ok(resolved.access.allowedPageIds.includes("executive_summary"));
});

test("user ativo com grupo entra", async () => {
  const resolved = await resolveRequestAccess(new Request("http://localhost/api/analytics?action=access"), {
    requireCorporateAuthUser: async () => ({
      user: { email: "victor@quartavia.com.br" },
      accessToken: "t",
    }),
    fetchAccessUserByEmail: async () => ({
      id: "2",
      email: "victor@quartavia.com.br",
      isOwner: false,
      isActive: true,
      groups: [{ code: "leaders", name: "Líderes" }],
    }),
  });
  assert.equal(resolved.access.isOwner, false);
  assert.ok(resolved.access.allowedPageIds.includes("general"));
  assert.equal(resolved.access.canManageAccess, false);
});

test("user inexistente → mensagem de cadastro", async () => {
  const resolved = await resolveRequestAccess(new Request("http://localhost/api/analytics?action=access"), {
    requireCorporateAuthUser: async () => ({
      user: { email: "novo@quartavia.com.br" },
      accessToken: "t",
    }),
    fetchAccessUserByEmail: async () => null,
  });
  assert.equal(resolved.error.status, 403);
  const payload = await resolved.error.json();
  assert.equal(payload.code, "access_unauthorized");
  assert.equal(payload.error, ACCESS_UNAUTHORIZED_MESSAGE);
});

test("user inativo → mensagem de desativado", async () => {
  const resolved = await resolveRequestAccess(new Request("http://localhost/api/analytics?action=access"), {
    requireCorporateAuthUser: async () => ({
      user: { email: "inativo@quartavia.com.br" },
      accessToken: "t",
    }),
    fetchAccessUserByEmail: async () => ({
      id: "3",
      email: "inativo@quartavia.com.br",
      isOwner: false,
      isActive: false,
      groups: [{ code: "eps", name: "EPs" }],
    }),
  });
  const payload = await resolved.error.json();
  assert.equal(payload.code, "access_disabled");
  assert.equal(payload.error, ACCESS_DISABLED_MESSAGE);
});

test("erro técnico de query → mensagem técnica", async () => {
  const resolved = await resolveRequestAccess(new Request("http://localhost/api/analytics?action=access"), {
    requireCorporateAuthUser: async () => ({
      user: { email: "ana@quartavia.com.br" },
      accessToken: "t",
    }),
    fetchAccessUserByEmail: async () => {
      const error = new Error(ACCESS_TECHNICAL_MESSAGE);
      error.code = "access_schema_not_exposed";
      error.postgrestCode = "PGRST106";
      error.status = 406;
      throw error;
    },
  });
  assert.equal(resolved.error.status, 503);
  const payload = await resolved.error.json();
  assert.equal(payload.code, "access_schema_not_exposed");
  assert.equal(payload.error, ACCESS_TECHNICAL_MESSAGE);
  assert.equal(payload.postgrestCode, "PGRST106");
});

test("API de Acionamentos é owner-only", async () => {
  const leaderDenied = await requirePageAccess(new Request("http://localhost/api/support"), "support", {
    requireCorporateAuthUser: async () => ({ user: { email: "lider@quartavia.com.br" }, accessToken: "t" }),
    fetchAccessUserByEmail: async () => ({
      email: "lider@quartavia.com.br",
      isOwner: false,
      isActive: true,
      groups: [{ code: "leaders", name: "Líderes" }],
    }),
  });
  assert.equal(leaderDenied.status, 403);
  const deniedBody = await leaderDenied.json();
  assert.equal(deniedBody.error, ACCESS_LEGACY_OWNER_MESSAGE);

  const ownerOk = await requirePageAccess(new Request("http://localhost/api/support"), "support", {
    requireCorporateAuthUser: async () => ({ user: { email: "owner@quartavia.com.br" }, accessToken: "t" }),
    fetchAccessUserByEmail: async () => ({
      email: "owner@quartavia.com.br",
      isOwner: true,
      isActive: true,
      groups: [],
    }),
  });
  assert.equal(ownerOk, null);
});

test("Satisfaction API segue a policy atual", async () => {
  const leaderOk = await requirePageAccess(new Request("http://localhost/api/satisfaction"), "satisfaction", {
    requireCorporateAuthUser: async () => ({ user: { email: "lider@quartavia.com.br" }, accessToken: "t" }),
    fetchAccessUserByEmail: async () => ({
      email: "lider@quartavia.com.br",
      isOwner: false,
      isActive: true,
      groups: [{ code: "leaders", name: "Líderes" }],
    }),
  });
  assert.equal(leaderOk, null);

  const productOk = await requirePageAccess(new Request("http://localhost/api/satisfaction"), "satisfaction", {
    requireCorporateAuthUser: async () => ({ user: { email: "produto@quartavia.com.br" }, accessToken: "t" }),
    fetchAccessUserByEmail: async () => ({
      email: "produto@quartavia.com.br",
      isOwner: false,
      isActive: true,
      groups: [{ code: "product", name: "Produto" }],
    }),
  });
  assert.equal(productOk, null);

  const financeDenied = await requirePageAccess(new Request("http://localhost/api/satisfaction"), "satisfaction", {
    requireCorporateAuthUser: async () => ({ user: { email: "fin@quartavia.com.br" }, accessToken: "t" }),
    fetchAccessUserByEmail: async () => ({
      email: "fin@quartavia.com.br",
      isOwner: false,
      isActive: true,
      groups: [{ code: "finance", name: "Financeiro" }],
    }),
  });
  assert.equal(financeDenied.status, 403);
});

test("viewer/grupo não recebe owner", async () => {
  const resolved = await resolveRequestAccess(new Request("http://localhost/api/analytics?action=access"), {
    requireCorporateAuthUser: async () => ({
      user: { email: "ep@quartavia.com.br" },
      accessToken: "t",
    }),
    fetchAccessUserByEmail: async () => ({
      id: "4",
      email: "ep@quartavia.com.br",
      isOwner: false,
      isActive: true,
      groups: [{ code: "eps", name: "EPs" }],
    }),
  });
  assert.equal(resolved.access.isOwner, false);
  assert.equal(resolved.access.canManageAccess, false);
});
