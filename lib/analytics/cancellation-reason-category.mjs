/**
 * Categorização analítica de motivos de cancelamento (BASE QV).
 * Entrada: texto de public.cancellations.motivo (nunca motivo_categoria).
 * Não altera o banco; preserva o texto original no payload.
 */

export const CANCELLATION_REASON_CATEGORIES = [
  "Questões financeiras",
  "Insatisfação com serviço ou atendimento",
  "Mudança de profissional ou estratégia",
  "Questões pessoais",
  "Problemas de adesão ou expectativa",
  "Não renovação",
  "Inatividade e falta de engajamento",
  "Cancelamento sem detalhamento",
  "Outros motivos",
  "Não informado",
];

const ABSENT_TOKENS = new Set([
  "nao informado",
  "sem informacao",
  "n/a",
  "na",
  "-",
  "—",
  ".",
]);

/** Normaliza para comparação (não substitui o texto original). */
export function normalizeCancellationReasonText(value) {
  if (value == null) return "";
  if (typeof value !== "string") {
    if (typeof value === "object") return "";
    value = String(value);
  }
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function includesAny(normalized, terms) {
  return terms.some((t) => normalized.includes(t));
}

/**
 * Classifica o motivo original em categoria analítica.
 * @param {unknown} rawReason texto de cancellations.motivo
 * @returns {{ category: string, normalized: string, isAbsent: boolean }}
 */
export function categorizeCancellationReason(rawReason) {
  // Aceita apenas string como texto válido; null/undefined/objeto → ausente
  if (rawReason == null || typeof rawReason !== "string") {
    return { category: "Não informado", normalized: "", isAbsent: true };
  }

  const trimmed = rawReason.trim();
  const normalized = normalizeCancellationReasonText(rawReason);

  if (!trimmed || !normalized || ABSENT_TOKENS.has(normalized)) {
    return { category: "Não informado", normalized, isAbsent: true };
  }

  // 1 — Questões financeiras
  if (
    includesAny(normalized, [
      "financeiro",
      "financeira",
      "financeiras",
      "dificuldade financeira",
      "sem condicoes",
      "preco",
      "custo",
      "mensalidade",
      "inadimplencia",
      "divida",
      "pagamento",
      "orcamento",
    ])
  ) {
    return { category: "Questões financeiras", normalized, isAbsent: false };
  }

  // 2 — Insatisfação
  if (
    includesAny(normalized, [
      "insatisfeito",
      "insatisfeita",
      "insatisfacao",
      "atendimento",
      "suporte",
      "demora",
      "reclamacao",
      "nao gostou",
      "expectativa nao atendida",
      "problema com servico",
    ])
  ) {
    return { category: "Insatisfação com serviço ou atendimento", normalized, isAbsent: false };
  }

  // 3 — Mudança de profissional ou estratégia
  if (
    includesAny(normalized, [
      "outro estrategista",
      "outro engenheiro",
      "outro assessor",
      "outro consultor",
      "trocou de profissional",
      "outra empresa",
      "concorrente",
      "decidiu seguir sozinho",
      "seguira sozinho",
      "mudanca de estrategia",
    ])
  ) {
    return { category: "Mudança de profissional ou estratégia", normalized, isAbsent: false };
  }

  // 4 — Questões pessoais
  if (
    includesAny(normalized, [
      "motivo pessoal",
      "questoes pessoais",
      "saude",
      "familia",
      "falecimento",
      "separacao",
      "mudanca de pais",
      "indisponibilidade pessoal",
    ])
  ) {
    return { category: "Questões pessoais", normalized, isAbsent: false };
  }

  // 5 — Problemas de adesão ou expectativa
  if (
    includesAny(normalized, [
      "nao entendeu a proposta",
      "nao aderiu",
      "nao viu valor",
      "expectativa",
      "perfil incompativel",
      "nao se adaptou",
    ])
  ) {
    return { category: "Problemas de adesão ou expectativa", normalized, isAbsent: false };
  }

  // 6 — Não renovação
  if (
    includesAny(normalized, [
      "nao renovacao",
      "nao renovou",
      "churn de nao renovacao",
      "fim de contrato sem renovacao",
      "encerramento sem renovacao",
      "sem renovacao",
    ])
  ) {
    return { category: "Não renovação", normalized, isAbsent: false };
  }

  // 7 — Inatividade e falta de engajamento
  if (
    includesAny(normalized, [
      "inativo",
      "inativa",
      "inatividade",
      "nao responde",
      "nao agenda",
      "nao interage",
      "nao acessa",
      "visualiza e nao responde",
      "tentativas de contato",
      "sem retorno",
      "sem contato",
      "abandono",
    ])
  ) {
    return { category: "Inatividade e falta de engajamento", normalized, isAbsent: false };
  }

  // 8 — Cancelamento sem detalhamento
  if (
    includesAny(normalized, [
      "solicitou cancelamento",
      "pediu cancelamento",
      "cancelamento",
      "cancelar",
      "distrato",
      "encerramento",
    ])
  ) {
    const wordCount = normalized.split(" ").filter(Boolean).length;
    if (wordCount <= 4) {
      return { category: "Cancelamento sem detalhamento", normalized, isAbsent: false };
    }
  }

  // 9 — Outros motivos (texto preenchido sem regra)
  return { category: "Outros motivos", normalized, isAbsent: false };
}
