/**
 * Normalização explícita de status por fonte — sem mapper genérico único.
 */
import { foldToken } from "../mechanism-metrics.mjs";

/** BASE QV: concluido → Implementado; apto → Apto */
export function normalizeBaseQvMechanismStatus(rawStatus) {
  const token = foldToken(rawStatus);
  if (!token) return { label: "Não informado", recognized: false };
  if (token === "apto") return { label: "Apto", recognized: true };
  if (token === "iniciado" || token === "em andamento" || token === "andamento") {
    return { label: "Em andamento", recognized: true };
  }
  if (token === "concluido" || token === "concluida") {
    return { label: "Implementado", recognized: true };
  }
  return { label: "Não informado", recognized: false };
}

/** SQL de auditoria BASE QV: lower(trim(status)) = 'concluido' */
export function isBaseQvImplementedRawStatus(rawStatus) {
  const token = foldToken(rawStatus);
  return token === "concluido" || token === "concluida";
}

/** App Pharus: suggested → Implementado (não pendente) */
export function normalizePharusMechanismStatus(rawStatus) {
  const token = foldToken(rawStatus);
  if (!token) return "Não informado";
  if (token === "suggested") return "Implementado";
  if (token === "apto" || token === "eligible") return "Apto";
  if (token === "iniciado" || token === "em andamento" || token === "andamento" || token === "started") {
    return "Em andamento";
  }
  if (token === "concluido" || token === "concluida" || token === "implementado" || token === "completed") {
    return "Implementado";
  }
  return "Não informado";
}

export function isPharusImplementedRawStatus(rawStatus) {
  return foldToken(rawStatus) === "suggested";
}

/** created_at do App Pharus ainda não validado semanticamente como implementação. */
export const PHARUS_CREATED_AT_VALID_FOR_IMPLEMENTATION = false;
