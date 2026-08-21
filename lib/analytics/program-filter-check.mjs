/**
 * Program Filter Check — coerência Todos / Pharus / Davos / Não informado por página.
 */
import { resolveClientProgram } from "./filters/program.mjs";
import { defaultGeneralFilters, filterGeneralClients } from "./general-filters.mjs";
import { defaultOnboardingFilters, filterOnboardingClients } from "./onboarding-filters.mjs";
import { defaultMeetingFilters, applyMeetingFilters } from "./meeting-filters.mjs";
import { defaultPlanFilters, filterPlanClients } from "./patrimonial-plan-filters.mjs";
import { defaultMechanismFilters, filterMechanismClients } from "./mechanism-filters.mjs";
import { defaultFinancialUpdatesFilters, filterFinancialUpdateClients } from "./financial-updates-filters.mjs";
import { defaultSatisfactionFilters, filterSatisfactionClients } from "./satisfaction-filters.mjs";
import { defaultCancellationFilters, filterCancellationClients } from "./cancellations-filters.mjs";
import { defaultRenewalFilters, filterRenewalClients } from "./renewal-filters.mjs";
import { defaultEpPerformanceFilters, filterEpClients } from "./ep-performance-filters.mjs";
import { defaultTemporalIndicatorsFilters, filterTemporalActivityRecency } from "./temporal-indicators-filters.mjs";
import { programMatches } from "./filters/program.mjs";

function countByProgram(rows, key = "program") {
  let pharus = 0;
  let davos = 0;
  let unknown = 0;
  for (const row of rows || []) {
    const resolved = resolveClientProgram(row);
    const tokens = new Set();
    if (resolved === "Pharus") tokens.add("Pharus");
    if (resolved === "Davos") tokens.add("Davos");
    if (resolved === "Não informado") {
      const raw = row?.[key] ?? row?.program ?? row?.programa;
      if (raw && /pharus/i.test(String(raw))) tokens.add("Pharus");
      if (raw && /davos/i.test(String(raw))) tokens.add("Davos");
    }
    if (tokens.has("Pharus") && !tokens.has("Davos")) pharus += 1;
    else if (tokens.has("Davos") && !tokens.has("Pharus")) davos += 1;
    else if (tokens.has("Pharus") && tokens.has("Davos")) {
      pharus += 1;
      davos += 1;
    } else unknown += 1;
  }
  return { pharus, davos, unknown, total: (rows || []).length };
}

function evaluateCoherence({ all, pharus, davos, unknown, total }) {
  const sum = pharus + davos + unknown;
  const pass = sum >= total && pharus <= all && davos <= all;
  return pass ? "PASS" : "FAIL";
}

export function runProgramFilterCheck(payloads = {}) {
  const pages = [
    {
      page: "Dados Gerais",
      filter: (rows, program) => filterGeneralClients(rows, { ...defaultGeneralFilters(), status: "all", program }),
      rows: payloads.general?.clients || [],
    },
    {
      page: "Jornada",
      filter: (rows, program) => filterOnboardingClients(rows, { ...defaultOnboardingFilters(), program }),
      rows: payloads.journey?.clients || payloads.onboarding?.clients || [],
    },
    {
      page: "Reuniões",
      filter: (rows, program) => {
        const result = applyMeetingFilters(rows, { ...defaultMeetingFilters(), program });
        return result?.clients || result?.rows || (Array.isArray(result) ? result : []);
      },
      rows: payloads.meetings?.clients || [],
    },
    {
      page: "Plano Patrimonial",
      filter: (rows, program) => filterPlanClients(rows, { ...defaultPlanFilters(), program }),
      rows: payloads.patrimonial_plan?.clients || payloads.plan?.clients || [],
    },
    {
      page: "Mecanismos",
      filter: (rows, program) => filterMechanismClients(rows, { ...defaultMechanismFilters(), program }),
      rows: payloads.mechanisms?.clients || [],
    },
    {
      page: "Atualização Financeira",
      filter: (rows, program) => filterFinancialUpdateClients(rows, { ...defaultFinancialUpdatesFilters(), status: "all", program }),
      rows: payloads.financial_updates?.clients || [],
    },
    {
      page: "Satisfação",
      filter: (rows, program) => filterSatisfactionClients(rows, { ...defaultSatisfactionFilters(), program }),
      rows: payloads.satisfaction?.clients || [],
    },
    {
      page: "Cancelamento",
      filter: (rows, program) => filterCancellationClients(rows, { ...defaultCancellationFilters(), program }),
      rows: payloads.cancellations?.clients || [],
    },
    {
      page: "Renovação",
      filter: (rows, program) => filterRenewalClients(rows, { ...defaultRenewalFilters(), program }),
      rows: payloads.renewal?.clients || [],
    },
    {
      page: "EP Performance",
      filter: (rows, program) => filterEpClients(rows, { ...defaultEpPerformanceFilters(), program }),
      rows: payloads.ep_performance?.clients || payloads.ep?.clients || [],
    },
    {
      page: "Temporal",
      filter: (rows, program) => filterTemporalActivityRecency(rows, { ...defaultTemporalIndicatorsFilters(), program }),
      rows: payloads.temporal?.activityRecency || payloads.temporal_indicators?.activityRecency || [],
    },
    {
      page: "Estatísticas",
      filter: (rows, program) =>
        (rows || []).filter((row) => programMatches(row, program)),
      rows: payloads.statistical_crosses?.subjects || payloads.general?.clients || [],
    },
  ];

  return pages.map(({ page, filter, rows }) => {
    const safeRows = Array.isArray(rows) ? rows : [];
    const allRows = filter(safeRows, "all") || [];
    const pharusRows = filter(safeRows, "Pharus") || [];
    const davosRows = filter(safeRows, "Davos") || [];
    const breakdown = countByProgram(allRows);
    return {
      page,
      todos: allRows.length,
      pharus: pharusRows.length,
      davos: davosRows.length,
      naoInformado: breakdown.unknown,
      status: evaluateCoherence({
        all: allRows.length,
        pharus: pharusRows.length,
        davos: davosRows.length,
        unknown: breakdown.unknown,
        total: allRows.length,
      }),
    };
  });
}

export { countByProgram, evaluateCoherence };
