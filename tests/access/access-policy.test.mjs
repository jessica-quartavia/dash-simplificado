import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCESS_MANAGEMENT_PAGE_ID,
  canAccessPage,
  canDeactivateUser,
  canPreloadPage,
  canRevokeOwner,
  expandAccessGroups,
  filterPagesForMenu,
  firstAllowedPageId,
  listAllowedPageIds,
  pagesGrantedByGroups,
  buildAccessUserTags,
} from "../../lib/access/access-policy.mjs";

function access(groups, extra = {}) {
  return { isOwner: false, isActive: true, groups, ...extra };
}

test("OWNER → tudo permitido, inclusive construção e gerenciamento", () => {
  const owner = access([], { isOwner: true });
  for (const pageId of [
    "executive_summary",
    "reports",
    "platform_usage",
    "journey",
    "support",
    "statistical_crosses",
    ACCESS_MANAGEMENT_PAGE_ID,
  ]) {
    assert.equal(canAccessPage(owner, pageId), true, pageId);
  }
});

test("Líder → tudo menos construção e access management", () => {
  const leader = access(["leaders"]);
  assert.equal(canAccessPage(leader, "executive_summary"), true);
  assert.equal(canAccessPage(leader, "reports"), true);
  assert.equal(canAccessPage(leader, "ep_performance"), true);
  assert.equal(canAccessPage(leader, "statistical_crosses"), true);
  assert.equal(canAccessPage(leader, "quality"), true);
  assert.equal(canAccessPage(leader, "journey"), false);
  assert.equal(canAccessPage(leader, "platform_usage"), false);
  assert.equal(canAccessPage(leader, "support"), false);
  assert.equal(canAccessPage(leader, ACCESS_MANAGEMENT_PAGE_ID), false);
});

test("EP → visão geral sem relatórios, jornada sem plataforma, sem inteligência", () => {
  const ep = access(["eps"]);
  assert.equal(canAccessPage(ep, "executive_summary"), true);
  assert.equal(canAccessPage(ep, "general"), true);
  assert.equal(canAccessPage(ep, "reports"), false);
  assert.equal(canAccessPage(ep, "meetings"), true);
  assert.equal(canAccessPage(ep, "mechanisms"), true);
  assert.equal(canAccessPage(ep, "satisfaction"), true);
  assert.equal(canAccessPage(ep, "platform_usage"), false);
  assert.equal(canAccessPage(ep, "journey"), false);
  assert.equal(canAccessPage(ep, "statistical_crosses"), false);
  assert.equal(canAccessPage(ep, "health_score"), false);
  assert.equal(canAccessPage(ep, "ep_performance"), false);
  assert.equal(canAccessPage(ep, ACCESS_MANAGEMENT_PAGE_ID), false);
});

test("Team Leader EP herda EP + Relatórios + Performance EP", () => {
  const tl = access(["team_leaders_ep"]);
  assert.deepEqual(expandAccessGroups(["team_leaders_ep"]).sort(), ["eps", "team_leaders_ep"]);
  assert.equal(canAccessPage(tl, "executive_summary"), true);
  assert.equal(canAccessPage(tl, "meetings"), true);
  assert.equal(canAccessPage(tl, "reports"), true);
  assert.equal(canAccessPage(tl, "ep_performance"), true);
  assert.equal(canAccessPage(tl, "statistical_crosses"), false);
  assert.equal(canAccessPage(tl, "platform_usage"), false);
});

test("Qualidade → somente páginas autorizadas", () => {
  const quality = access(["quality"]);
  assert.equal(canAccessPage(quality, "general"), true);
  assert.equal(canAccessPage(quality, "satisfaction"), true);
  assert.equal(canAccessPage(quality, "cancellations"), true);
  assert.equal(canAccessPage(quality, "renewal"), true);
  assert.equal(canAccessPage(quality, "support"), false);
  assert.equal(canAccessPage(quality, "executive_summary"), false);
  assert.equal(canAccessPage(quality, "reports"), false);
  assert.equal(canAccessPage(quality, "meetings"), false);
});

test("Financeiro → Dados Gerais, Executive, Cancelamento e Renovação", () => {
  const finance = access(["finance"]);
  assert.equal(canAccessPage(finance, "general"), true);
  assert.equal(canAccessPage(finance, "executive_summary"), true);
  assert.equal(canAccessPage(finance, "cancellations"), true);
  assert.equal(canAccessPage(finance, "renewal"), true);
  assert.equal(canAccessPage(finance, "satisfaction"), false);
  assert.equal(canAccessPage(finance, "reports"), false);
});

test("Máximo: leaders + finance → união correta", () => {
  const maximo = access(["leaders", "finance"]);
  const pages = listAllowedPageIds(maximo);
  assert.ok(pages.includes("executive_summary"));
  assert.ok(pages.includes("cancellations"));
  assert.ok(pages.includes("statistical_crosses"));
  assert.ok(!pages.includes("journey"));
  assert.ok(!pages.includes(ACCESS_MANAGEMENT_PAGE_ID));
});

test("Team Leader com eps + team_leaders_ep não duplica e ganha extras", () => {
  const granted = [...pagesGrantedByGroups(["eps", "team_leaders_ep"])].sort();
  const inherited = [...pagesGrantedByGroups(["team_leaders_ep"])].sort();
  assert.deepEqual(granted, inherited);
  assert.ok(granted.includes("reports"));
  assert.ok(granted.includes("ep_performance"));
  assert.ok(granted.includes("meetings"));
});

test("Owner + qualquer grupo → tudo permitido", () => {
  const owner = access(["eps"], { isOwner: true });
  assert.equal(canAccessPage(owner, "statistical_crosses"), true);
  assert.equal(canAccessPage(owner, ACCESS_MANAGEMENT_PAGE_ID), true);
});

test("usuário inativo ou sem cadastro → bloqueado", () => {
  assert.equal(canAccessPage(access(["leaders"], { isActive: false }), "general"), false);
  assert.equal(canAccessPage(null, "general"), false);
});

test("menu oculta categorias vazias e gerenciamento para não-owner", () => {
  const financeMenu = filterPagesForMenu(access(["finance"]));
  assert.deepEqual(financeMenu.map((group) => group.id).sort(), ["overview", "retention"]);
  assert.ok(!financeMenu.some((group) => group.id === "intelligence"));
  const ownerMenu = filterPagesForMenu(access([], { isOwner: true }));
  assert.ok(ownerMenu.some((group) => group.id === "system" && group.pages.some((page) => page.id === ACCESS_MANAGEMENT_PAGE_ID)));
});

test("preload não inclui gerenciamento nem página sem permissão", () => {
  const ep = access(["eps"]);
  assert.equal(canPreloadPage(ep, "statistical_crosses"), false);
  assert.equal(canPreloadPage(ep, "meetings"), true);
  assert.equal(canPreloadPage(access([], { isOwner: true }), ACCESS_MANAGEMENT_PAGE_ID), false);
});

test("tags visuais: owner nunca aparece como Sem time", () => {
  assert.deepEqual(buildAccessUserTags({ isOwner: true, groupLabels: [] }), [
    { label: "Owner", kind: "owner" },
  ]);
  assert.deepEqual(buildAccessUserTags({ isOwner: true, groupLabels: ["Líderes"] }), [
    { label: "Owner", kind: "owner" },
    { label: "Líderes", kind: "group" },
  ]);
  assert.deepEqual(buildAccessUserTags({ isOwner: false, groupLabels: [] }), [
    { label: "Sem time", kind: "empty" },
  ]);
  assert.deepEqual(buildAccessUserTags({ isOwner: false, groupLabels: ["Qualidade"] }), [
    { label: "Qualidade", kind: "group" },
  ]);
});

test("home padrão cai na primeira página permitida", () => {
  assert.equal(firstAllowedPageId(access(["quality"])), "general");
  assert.equal(firstAllowedPageId(access(["finance"])), "executive_summary");
});

test("último owner e auto-alteração são bloqueados", () => {
  const last = canRevokeOwner({
    actorEmail: "a@quartavia.com.br",
    target: { email: "b@quartavia.com.br", is_owner: true, is_active: true },
    activeOwnerCount: 1,
  });
  assert.equal(last.ok, false);
  const self = canDeactivateUser({
    actorEmail: "a@quartavia.com.br",
    target: { email: "a@quartavia.com.br", is_owner: true, is_active: true },
    activeOwnerCount: 3,
  });
  assert.equal(self.ok, false);
});
