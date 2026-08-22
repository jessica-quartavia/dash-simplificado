import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  CLIENT_DISPLAY,
  filterOutTestAcionamentos,
  hasSecureBaseQvMatch,
  isExactTestAcionamentoTitle,
  resolveSupportClientDisplay,
} from "../../lib/analytics/support-client-display.mjs";
import { buildSupportAnalyticsPayload } from "../../lib/analytics/support-analytics.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

test("título teste exato é excluído", () => {
  assert.equal(isExactTestAcionamentoTitle("teste"), true);
  assert.equal(isExactTestAcionamentoTitle(" TESTE "), true);
  assert.equal(isExactTestAcionamentoTitle("Erro no teste de importação"), false);
});

test("filterOutTestAcionamentos remove apenas título exato", () => {
  const { rows, excludedCount } = filterOutTestAcionamentos([
    { id: 1, titulo: "teste" },
    { id: 2, titulo: " TESTE " },
    { id: 3, titulo: "Erro no teste de importação" },
    { id: 4, titulo: "Suporte real" },
  ]);
  assert.equal(excludedCount, 2);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.id), [3, 4]);
});

test("client_id BASE QV mostra nome oficial", () => {
  const result = resolveSupportClientDisplay({
    row: { client_name: "Gabriel Luis Rodrigues de Oliveira", nome_solicitante: "Gabriel Luis Rodrigues de Oliveira" },
    tratado: { baseqv_client_id: "c1", baseqv_client_name: "Maria Cliente", baseqv_codigo: "QV-01" },
    clients: [{ clientId: "c1", name: "Maria Cliente", code: "QV-01" }],
    hasBaseQvMatch: true,
    requester: "Gabriel Luis Rodrigues de Oliveira",
    countClients: 1,
  });
  assert.equal(result.display, "Maria Cliente (QV-01)");
  assert.equal(result.displayKind, CLIENT_DISPLAY.BASE_QV);
});

test("e-mail externo com match BASE QV mostra nome", () => {
  const result = resolveSupportClientDisplay({
    row: { email_cliente: "cliente@email.com" },
    tratado: {
      baseqv_client_id: "c2",
      baseqv_client_name: "João Silva",
      cliente_encontrado_baseqv: true,
    },
    clients: [{ clientId: "c2", name: "João Silva" }],
    hasBaseQvMatch: true,
    requester: "Atendente Interno",
    countClients: 1,
  });
  assert.equal(result.display, "João Silva");
  assert.equal(result.displayKind, CLIENT_DISPLAY.BASE_QV);
});

test("e-mail externo sem match mostra e-mail", () => {
  const result = resolveSupportClientDisplay({
    row: { email_cliente: "cliente@email.com", nome_solicitante: "Gabriel Luis Rodrigues de Oliveira" },
    tratado: { email_cliente_original: "cliente@email.com", classificacao_email: "sem match" },
    clients: [],
    hasBaseQvMatch: false,
    requester: "Gabriel Luis Rodrigues de Oliveira",
    countClients: 0,
  });
  assert.equal(result.display, "cliente@email.com");
  assert.equal(result.displayKind, CLIENT_DISPLAY.EXTERNAL_EMAIL);
});

test("e-mail corporativo mostra traço", () => {
  const result = resolveSupportClientDisplay({
    row: { email_cliente: "interno@quartavia.com.br", nome_solicitante: "Gabriel Luis Rodrigues de Oliveira" },
    tratado: { email_campo_corporativo: true, email_cliente_original: "interno@quartavia.com.br" },
    clients: [],
    hasBaseQvMatch: false,
    requester: "Gabriel Luis Rodrigues de Oliveira",
    countClients: 0,
  });
  assert.equal(result.display, "—");
  assert.equal(result.displayKind, CLIENT_DISPLAY.CORPORATE_DASH);
});

test("sem identificador mostra Não identificado", () => {
  const result = resolveSupportClientDisplay({
    row: { nome_solicitante: "Gabriel Luis Rodrigues de Oliveira" },
    tratado: null,
    clients: [],
    hasBaseQvMatch: false,
    requester: "Gabriel Luis Rodrigues de Oliveira",
    countClients: 0,
  });
  assert.equal(result.display, "Não identificado");
  assert.equal(result.displayKind, CLIENT_DISPLAY.UNIDENTIFIED);
});

test("nome do responsável não vira cliente", () => {
  const result = resolveSupportClientDisplay({
    row: {
      client_name: "Gabriel Luis Rodrigues de Oliveira",
      nome_solicitante: "Gabriel Luis Rodrigues de Oliveira",
    },
    tratado: null,
    clients: [],
    hasBaseQvMatch: false,
    requester: "Gabriel Luis Rodrigues de Oliveira",
    countClients: 0,
  });
  assert.notEqual(result.display, "Gabriel Luis Rodrigues de Oliveira");
  assert.equal(result.displayKind, CLIENT_DISPLAY.UNIDENTIFIED);
});

test("nome externo confiável sem match BASE QV", () => {
  const result = resolveSupportClientDisplay({
    row: { client_name: "Empresa ABC Ltda", nome_solicitante: "Ana Interna" },
    tratado: null,
    clients: [],
    hasBaseQvMatch: false,
    requester: "Ana Interna",
    countClients: 0,
  });
  assert.equal(result.display, "Empresa ABC Ltda");
  assert.equal(result.displayKind, CLIENT_DISPLAY.EXTERNAL_NAME);
});

test("hasSecureBaseQvMatch exige correspondência segura", () => {
  assert.equal(hasSecureBaseQvMatch({ baseqv_client_id: "1" }, []), true);
  assert.equal(hasSecureBaseQvMatch({ cliente_encontrado_baseqv: true }, [{ clientId: "1" }]), true);
  assert.equal(hasSecureBaseQvMatch(null, [{ email: "a@b.com", partial: true }]), false);
});

test("buildSupportAnalyticsPayload exclui teste antes dos KPIs", () => {
  const payload = buildSupportAnalyticsPayload({
    acionamentos: [
      { id: "1", titulo: "teste", prioridade: "Alta", area_setor: "App Pharus", tipo_solicitacao: "Suporte", status: "Novo", nome_solicitante: "X" },
      { id: "2", titulo: "Chamado real", prioridade: "Baixa", area_setor: "App Pharus", tipo_solicitacao: "Suporte", status: "Novo", nome_solicitante: "Y", email_cliente: "cliente@email.com" },
    ],
    tratados: [],
    qualidade: null,
  });
  assert.equal(payload.meta.excludedTestTitles, 1);
  assert.equal(payload.summary.totalTickets, 1);
  assert.equal(payload.tickets[0].clientDisplay, "cliente@email.com");
});

test("support.js remove Escalou problema da UI", () => {
  const source = readFileSync(join(ROOT, "js/support.js"), "utf8");
  assert.doesNotMatch(source, /Escalou problema/);
  assert.match(source, /support-client-cell/);
});
