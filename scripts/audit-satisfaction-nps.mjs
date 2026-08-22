#!/usr/bin/env node
/**
 * Diagnóstico NPS — Pesquisa de Satisfação.
 * Read-only: compara escopos A–E e imprime breakdown GERAL / PHARUS / DAVOS / NÃO INFORMADO.
 */
import { computeSatisfactionPayload } from "../lib/analytics/satisfaction.mjs";

function fmtRow(row) {
  return [
    row.scope || row.program || row.label,
    row.n ?? "—",
    row.promoters ?? "—",
    row.neutrals ?? "—",
    row.detractors ?? "—",
    row.nps == null ? "—" : row.nps,
  ];
}

function printTable(title, rows) {
  console.log(`\n=== ${title} ===`);
  console.log("Escopo/Programa\tN\tPromotores\tNeutros\tDetratores\tNPS");
  for (const row of rows) {
    console.log(fmtRow(row).join("\t"));
  }
}

function programRows(breakdown) {
  return [
    { program: "Total", ...breakdown.total },
    { program: "Pharus", ...breakdown.pharus },
    { program: "Davos", ...breakdown.davos },
    { program: "Não informado", ...breakdown.unknown },
  ].map(({ program, n, promoters, neutrals, detractors, nps }) => ({
    scope: program,
    n,
    promoters,
    neutrals,
    detractors,
    nps,
  }));
}

async function main() {
  const payload = await computeSatisfactionPayload();
  const scopes = payload.officialNps?.scopeComparison || [];
  const breakdown = payload.benchmarks;

  printTable("Comparação de escopos (A–E)", scopes);
  printTable("NPS final por Programa (regra oficial)", programRows(breakdown));

  const total = breakdown?.total;
  const sumParts = (breakdown?.pharus?.n || 0) + (breakdown?.davos?.n || 0) + (breakdown?.unknown?.n || 0);
  console.log("\n=== Validações ===");
  console.log(`Respondentes total: ${total?.n ?? "—"}`);
  console.log(`Pharus + Davos + Não informado = ${sumParts} (esperado ${total?.n ?? "—"})`);
  console.log(`NPS total: ${total?.nps ?? "—"} (${total?.promoters ?? 0}P / ${total?.neutrals ?? 0}N / ${total?.detractors ?? 0}D)`);
  console.log(`NPS trimestre (legado V1 card): ${payload.summary?.quarterScopedNps ?? "—"} (${payload.summary?.quarterScopedRespondents ?? "—"} respondentes)`);
  console.log(`Dedupe meta: ${JSON.stringify(payload.officialNps?.meta || {})}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
