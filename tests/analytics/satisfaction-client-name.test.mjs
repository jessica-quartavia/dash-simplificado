import assert from "node:assert/strict";
import { test } from "node:test";
import { getPageFilterContract } from "../../lib/analytics/filters/page-contracts.mjs";
import { filterSatisfactionClients } from "../../lib/analytics/satisfaction-filters.mjs";
import {
  buildSatisfactionQuarterView,
  enrichSatisfactionClientRows,
} from "../../lib/analytics/satisfaction.mjs";

const CLIENT = {
  id: "c-1",
  name: "Ana Silva",
  codigo: "QV03130",
  engenheiro_patrimonial: "EP Oficial",
  status: "Ativo",
  programa: "Pharus",
};

const CLIENT_MAP = new Map([["c-1", CLIENT]]);

function quarterView(extra = {}) {
  return buildSatisfactionQuarterView({
    allNpsRows: [
      {
        client_id: "c-1",
        score: 9,
        created_at: "2026-03-10T12:00:00.000Z",
        tipo_de_forms: "NPS",
        client_name: "",
      },
    ],
    allCsatRows: [
      {
        client_id: "c-1",
        score: 5,
        created_at: "2026-03-11T12:00:00.000Z",
        tipo_de_forms: "CSAT",
      },
    ],
    npsSends: [{ client_id: "c-1", sent_at: "2026-03-01T12:00:00.000Z" }],
    selectedQuarter: "2026 T1",
    npsQuarterly: [{ quarter: "2026 T1" }],
    totalClients: 10,
    clientMap: CLIENT_MAP,
    ...extra,
  });
}

test("client_id válido resolve nome oficial da BASE QV, não o placeholder da resposta", () => {
  const view = quarterView();
  const row = view.clients.find((item) => item.clientId === "c-1");
  assert.equal(row.clientName, "Ana Silva");
  assert.equal(row.clientCode, "QV03130");
  assert.equal(row.engineer, "EP Oficial");
  assert.equal(row.latestNps, 9);
  assert.equal(row.averageCsat, 5);
});

test("client_code válido resolve nome quando client_id não casa", () => {
  const rows = enrichSatisfactionClientRows(
    [
      {
        clientId: "missing",
        clientCode: "qv03130",
        clientName: "Não informado",
        engineer: "EP Oficial",
        latestNps: 8,
        averageCsat: 4,
      },
    ],
    CLIENT_MAP,
  );
  assert.equal(rows[0].clientName, "Ana Silva");
  assert.equal(rows[0].clientCode, "QV03130");
  assert.equal(rows[0].engineer, "EP Oficial");
  assert.equal(rows[0].latestNps, 8);
  assert.equal(rows[0].averageCsat, 4);
});

test("sem match oficial permanece Não informado", () => {
  const rows = enrichSatisfactionClientRows(
    [{ clientId: "x", clientCode: "QV99999", clientName: "Nome da pesquisa", latestNps: 7 }],
    CLIENT_MAP,
  );
  assert.equal(rows[0].clientName, "Não informado");
  assert.equal(rows[0].clientCode, null);
  assert.equal(rows[0].latestNps, 7);
});

test("placeholder da resposta NPS não bloqueia o nome oficial", () => {
  const rows = enrichSatisfactionClientRows(
    [{ clientId: "c-1", clientName: "Não informado", latestNps: 10 }],
    CLIENT_MAP,
  );
  assert.equal(rows[0].clientName, "Ana Silva");
});

test("amostra de 10 códigos da tabela resolve 10/10 pelo client_id", () => {
  const codes = ["QV03130", "QV02877", "QV00324", "QV01001", "QV01002", "QV01003", "QV01004", "QV01005", "QV01006", "QV01007"];
  const clientMap = new Map(
    codes.map((codigo, index) => [
      `id-${index}`,
      {
        id: `id-${index}`,
        name: `Cliente ${codigo}`,
        codigo,
        engenheiro_patrimonial: "EP A",
      },
    ]),
  );
  const rows = enrichSatisfactionClientRows(
    codes.map((codigo, index) => ({
      clientId: `id-${index}`,
      clientName: "Não informado",
      clientCode: codigo,
    })),
    clientMap,
  );
  assert.equal(rows.length, 10);
  assert.equal(rows.filter((row) => row.clientName.startsWith("Cliente QV")).length, 10);
  assert.equal(rows.filter((row) => row.engineer === "EP A").length, 10);
});

test("busca por nome oficial encontra a linha", () => {
  const view = quarterView();
  const found = filterSatisfactionClients(view.clients, { search: "Ana Silva" });
  assert.equal(found.length, 1);
  assert.equal(found[0].clientCode, "QV03130");
});

test("export da Satisfação usa o mesmo clientName resolvido", () => {
  const view = quarterView();
  const contract = getPageFilterContract("satisfaction");
  const nameCol = contract.exportColumns.find((col) => col.key === "clientName");
  assert.equal(nameCol.header, "Cliente");
  assert.equal(view.clients[0][nameCol.key], "Ana Silva");
});
