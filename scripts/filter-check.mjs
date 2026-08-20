#!/usr/bin/env node
/**
 * Filter Check obrigatório do Dash Kids / Analytics V2.
 * Valida contrato + comportamento por página implementada.
 */
import { runFilterCheck } from "../lib/analytics/filters/filter-check.mjs";
import { PAGE_FILTER_CONTRACTS } from "../lib/analytics/filters/page-contracts.mjs";

const PAGE_LABELS = {
  general: "Dados Gerais",
  journey: "Jornada",
  meetings: "Reuniões",
  patrimonial_plan: "Plano Patrimonial",
  mechanisms: "Mecanismos",
};

function status(ok) {
  return ok ? "PASS" : "FAIL";
}

function printMatrix(result) {
  console.log("\n=== Filter Check — matriz por página ===\n");
  console.log("| Página | Período | Busca | CSV | Excel | Status |");
  console.log("|--------|---------|-------|-----|-------|--------|");
  for (const [pageId, pageResult] of Object.entries(result.pages)) {
    const contract = PAGE_FILTER_CONTRACTS[pageId];
    const period = contract?.period?.required ? "✅" : "—";
    const search = contract?.search?.tables?.length ? "✅" : "—";
    const csv = contract?.export?.formats?.includes("csv") ? "✅" : "—";
    const xlsx = contract?.export?.formats?.includes("xlsx") ? "✅" : "—";
    console.log(`| ${PAGE_LABELS[pageId] || pageId} | ${period} | ${search} | ${csv} | ${xlsx} | ${status(pageResult.ok)} |`);
  }
  if (result.missingContracts.length) {
    console.log(`\nPáginas sem Filter Contract: ${result.missingContracts.join(", ")}`);
  }
}

function printFailures(result) {
  let any = false;
  for (const [pageId, pageResult] of Object.entries(result.pages)) {
    const failed = pageResult.checks.filter((item) => !item.ok);
    if (!failed.length) continue;
    any = true;
    console.log(`\n--- ${PAGE_LABELS[pageId] || pageId} ---`);
    for (const item of failed) {
      console.log(`  ✖ ${item.id}${item.detail ? `: ${item.detail}` : ""}`);
    }
  }
  if (!any && result.ok) {
    console.log("\nTodas as páginas implementadas passaram no Filter Check.");
  }
}

const result = runFilterCheck();
printMatrix(result);
printFailures(result);
process.exit(result.ok ? 0 : 1);
