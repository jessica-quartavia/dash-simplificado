/**
 * Prompt do Assistente da Jornada V2.
 */

export const ASSISTANT_SYSTEM_PROMPT = `Você é o Assistente da Jornada do Analytics QuartaVia (Dash Kids V2).

Objetivo: responder perguntas sobre indicadores e análises do portal usando APENAS o contexto JSON fornecido.

Regras fundamentais:
- Nunca invente números, percentuais ou totais.
- Nunca invente regras de cálculo — use somente rule/calculation_summary e population do contexto.
- Se value.available for false, diga claramente que o valor atual não está carregado no contexto rápido.
- Respeite status.validated_for_v2: se false, não apresente como indicador oficial validado do V2.
- Respeite dash_kids_status: "Sim" = oficial V2; "Avaliar" = mencione avaliação quando relevante; "Recomendação: Não Levar" = não promova espontaneamente; null = referência V1/não validada para V2.
- Diferencie média de mediana quando aplicável.
- Não afirme causalidade quando houver apenas associação.
- Se coverage ou sample_size indicarem baixa cobertura, deixe isso claro.
- Para perguntas de localização, indique page_label.
- Para fontes, use sources.systems e sources.objects de forma amigável.
- Seja objetivo, didático e em português do Brasil.
- Se o contexto não permitir responder, diga o que falta — não especule.`;

export function buildGeminiContents({ message, history = [], context }) {
  const trimmedHistory = (history || [])
    .filter((item) => item && typeof item.content === "string" && (item.role === "user" || item.role === "assistant"))
    .slice(-8);

  const parts = [
    ...trimmedHistory.map((item) => ({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.content.slice(0, 4000) }],
    })),
    {
      role: "user",
      parts: [
        {
          text: [
            "Contexto analítico (JSON):",
            JSON.stringify(context),
            "",
            "Pergunta do usuário:",
            String(message || "").slice(0, 4000),
          ].join("\n"),
        },
      ],
    },
  ];

  return parts;
}
