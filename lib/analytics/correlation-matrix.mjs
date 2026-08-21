/**
 * Matriz de correlação pairwise (Spearman / Pearson) sobre a população analítica.
 * Pares com casos completos; diagonal = 1; simétrica.
 */
import { dataConfigurationError } from "../env.mjs";
import {
  associationStrength,
  coveragePct,
  pearson,
  round3,
  round4,
  spearman,
} from "./stats-tests.mjs";

export const DEFAULT_MATRIX_VARIABLES = [
  { id: "stayDays", label: "Permanência (dias)", field: "stayDays" },
  { id: "meetingCount", label: "Reuniões", field: "meetingCount" },
  { id: "daysSinceLastMeeting", label: "Dias desde última reunião", field: "daysSinceLastMeeting" },
  { id: "daysToFirstMeeting", label: "Dias até 1ª reunião", field: "daysToFirstMeeting" },
  { id: "noShowCount", label: "No-shows", field: "noShowCount" },
  { id: "rescheduleCount", label: "Remarcações", field: "rescheduleCount" },
  { id: "attendanceRate", label: "Taxa de presença", field: "attendanceRate" },
  { id: "monthlyIncome", label: "Renda mensal", field: "monthlyIncome" },
  { id: "liquidityReserve", label: "Reserva de liquidez", field: "liquidityReserve" },
  { id: "lastContribution", label: "Último aporte", field: "lastContribution" },
  { id: "paidPropertiesValue", label: "Patrimônio imóveis quitados", field: "paidPropertiesValue" },
  { id: "mechanismCount", label: "Mecanismos disponíveis", field: "mechanismCount" },
  { id: "implementedMechanismCount", label: "Mecanismos implementados", field: "implementedMechanismCount" },
  { id: "implementationPercent", label: "% implementação", field: "implementationPercent" },
  { id: "npsScore", label: "NPS", field: "npsScore" },
  { id: "currentCycle", label: "Ciclo atual", field: "currentCycle" },
  { id: "renewalCount", label: "Renovações", field: "renewalCount" },
  { id: "averageIntervalDays", label: "Intervalo médio entre reuniões", field: "averageIntervalDays" },
  { id: "daysSinceFinancialUpdate", label: "Dias desde atualização financeira", field: "daysSinceFinancialUpdate" },
];

const MAX_VARS = 15;
const MIN_N = 20;

function resolveVariables(variableIds) {
  const byId = new Map(DEFAULT_MATRIX_VARIABLES.map((v) => [v.id, v]));
  let selected;
  if (Array.isArray(variableIds) && variableIds.length) {
    selected = variableIds
      .map((id) => String(id).trim())
      .filter(Boolean)
      .map((id) => byId.get(id) || { id, label: id, field: id });
  } else {
    selected = DEFAULT_MATRIX_VARIABLES.slice();
  }
  return selected.slice(0, MAX_VARS);
}

function seriesFor(clients, field) {
  return (clients || []).map((c) => {
    const v = c?.[field];
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });
}

function directionOf(value) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "none";
}

/**
 * @param {object[]} clients
 * @param {{ method?: 'spearman'|'pearson', variableIds?: string[] }} [options]
 */
export function buildCorrelationMatrix(clients, options = {}) {
  const method = String(options.method || "spearman").toLowerCase() === "pearson" ? "pearson" : "spearman";
  const variables = resolveVariables(options.variableIds);
  const total = Array.isArray(clients) ? clients.length : 0;
  const series = variables.map((v) => seriesFor(clients, v.field));
  const cells = [];
  const matrix = Array.from({ length: variables.length }, () => Array(variables.length).fill(null));

  for (let i = 0; i < variables.length; i += 1) {
    for (let j = 0; j < variables.length; j += 1) {
      const idA = variables[i].id;
      const idB = variables[j].id;
      const labelA = variables[i].label;
      const labelB = variables[j].label;

      if (i === j) {
        const valid = series[i].filter((v) => v != null).length;
        const cell = {
          i,
          j,
          idA,
          idB,
          labelA,
          labelB,
          value: 1,
          n: valid,
          coveragePercent: coveragePct(valid, total),
          method,
          strength: associationStrength(1, "r"),
          direction: "none",
          status: "ok",
          reason: null,
        };
        cells.push(cell);
        matrix[i][j] = cell;
        continue;
      }

      if (j < i) {
        const mirror = matrix[j][i];
        const cell = mirror
          ? {
              ...mirror,
              i,
              j,
              idA,
              idB,
              labelA,
              labelB,
            }
          : null;
        if (cell) {
          cells.push(cell);
          matrix[i][j] = cell;
        }
        continue;
      }

      const corr = method === "pearson" ? pearson(series[i], series[j]) : spearman(series[i], series[j]);
      const n = corr.n || 0;
      let status = corr.status || (corr.warning || "ok");
      let reason = corr.reason || corr.warning || null;
      let value = corr.r ?? corr.rho ?? null;

      if (n < MIN_N) {
        status = "small_sample";
        reason = `n < ${MIN_N}`;
        value = null;
      } else if (status === "ok" && value != null) {
        status = "ok";
        reason = null;
      } else if (value == null && status === "ok") {
        status = corr.warning || "unavailable";
        reason = corr.reason || corr.warning || "não calculável";
      }

      const cell = {
        i,
        j,
        idA,
        idB,
        labelA,
        labelB,
        value: value != null ? round4(value) : null,
        n,
        coveragePercent: coveragePct(n, total),
        method,
        strength: value != null ? associationStrength(value, "r") : "não calculável",
        direction: directionOf(value),
        status,
        reason,
      };
      cells.push(cell);
      matrix[i][j] = cell;
    }
  }

  const validOffDiag = cells.filter((c) => c.i < c.j && c.status === "ok" && c.value != null);
  const strongest = [...validOffDiag].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0] || null;

  return {
    method,
    variables: variables.map((v, idx) => ({
      id: v.id,
      label: v.label,
      index: idx,
      coveragePercent: coveragePct(series[idx].filter((x) => x != null).length, total),
    })),
    cells,
    matrix: matrix.map((row) => row.map((c) => (c ? c.value : null))),
    minN: MIN_N,
    maxVariables: MAX_VARS,
    clientCount: total,
    metadata: {
      pairwiseComplete: true,
      diagonal: 1,
      symmetric: true,
      strongestPair: strongest
        ? {
            idA: strongest.idA,
            idB: strongest.idB,
            labelA: strongest.labelA,
            labelB: strongest.labelB,
            value: strongest.value,
            n: strongest.n,
            strength: strongest.strength,
          }
        : null,
      validPairs: validOffDiag.length,
      meanAbsCorrelation: validOffDiag.length
        ? round3(validOffDiag.reduce((a, c) => a + Math.abs(c.value), 0) / validOffDiag.length)
        : null,
    },
  };
}
