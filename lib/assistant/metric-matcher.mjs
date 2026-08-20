/**
 * Matching determinístico de métricas e intenção da pergunta.
 */
import { foldSearchText } from "../analytics/filters/search.mjs";

export const INTENTS = [
  "value",
  "rule",
  "source",
  "location",
  "limitation",
  "comparison",
  "general",
];

const STOP_WORDS = new Set([
  "a", "as", "ao", "aos", "com", "como", "da", "das", "de", "do", "dos", "e", "em",
  "eu", "isso", "me", "na", "nas", "no", "nos", "o", "os", "ou", "para", "por", "qual",
  "quais", "que", "se", "ser", "sao", "tem", "temos", "um", "uma", "voce", "voces",
  "eh", "e", "esta", "estao", "ver", "vejo", "vemos",
]);

const INTENT_PATTERNS = [
  { intent: "source", pattern: /\b(de onde vem|de onde|fonte|origem|sistema|vem de|prov[eê]m|prov[eê]m de)\b/ },
  { intent: "location", pattern: /\b(onde vejo|onde encontro|onde fica|onde esta|onde está|qual pagina|qual tela|localizo|localizacao|localização)\b/ },
  { intent: "rule", pattern: /\b(como (e )?calcul|regra|metodolog|formula|fórmula|definicao|definição|calculam|calculado|calculada)\b/ },
  { intent: "limitation", pattern: /\b(limita|limitacao|limitação|restri|restricao|restrição|cuidado|nao posso|não posso|nao usar|não usar|problema|alerta)\b/ },
  { intent: "comparison", pattern: /\b(compar|versus|\bvs\b|diferenca|diferença|maior que|menor que)\b/ },
  { intent: "value", pattern: /\b(quantos|quanto|qual o total|qual a taxa|qual o percentual|numero|número|media|média|mediana|percentual|taxa|total de|temos)\b/ },
];

const DISAMBIGUATION = [
  { tokens: ["ativo", "ativos"], boost: ["active_clients"], penalize: ["total_clients"] },
  { tokens: ["total", "carteira", "todos"], boost: ["total_clients"], penalize: ["active_clients"], unless: ["ativo", "ativos"] },
  { tokens: ["comparecimento", "comparecer"], boost: ["attendance_rate"] },
  { tokens: ["no show", "no-show", "noshow", "faltou", "faltas"], boost: ["no_show_meetings", "no_show_rate"] },
  { tokens: ["implementado", "implementados", "implementacao", "implementação"], boost: ["implemented_mechanisms", "implementation_rate"] },
  { tokens: ["onboarding", "integracao", "integração"], boost: ["onboarding_completion_chart", "total_onboarding_time_chart", "average_onboarding_days"] },
  { tokens: ["tempo", "leva", "duracao", "duração", "quanto tempo"], boost: ["total_onboarding_time_chart", "plan_days_to_approval"], penalize: ["completed_onboarding_clients", "onboarding_completion_chart", "average_onboarding_days"] },
  { tokens: ["concluiu", "concluiram", "conclusao", "conclusão", "quem"], boost: ["onboarding_completion_chart"], penalize: ["completed_onboarding_clients"] },
  { tokens: ["plano", "aprovacao", "aprovação"], boost: ["plan_days_to_approval", "plan_approved_clients"] },
  { tokens: ["renovacao", "renovação"], boost: ["renewal_rate"] },
];

export function normalizeQuestion(text) {
  return foldSearchText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text) {
  return normalizeQuestion(text)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function detectIntent(message) {
  const normalized = normalizeQuestion(message);
  for (const { intent, pattern } of INTENT_PATTERNS) {
    if (pattern.test(normalized)) return intent;
  }
  return "general";
}

function includesPhrase(haystack, phrase) {
  const h = normalizeQuestion(haystack);
  const p = normalizeQuestion(phrase);
  if (!p) return false;
  return h.includes(p) || p.includes(h);
}

function scoreMetric(question, metric, intent) {
  const normalized = normalizeQuestion(question);
  const metricIdPhrase = String(metric.metric_id || "").replace(/_/g, " ");
  let score = 0;

  if (metricIdPhrase && normalized.includes(metricIdPhrase)) score = Math.max(score, 0.98);

  const label = String(metric.label || "");
  if (label && includesPhrase(normalized, label)) score = Math.max(score, 0.88);

  const aliases = Array.isArray(metric.aliases) ? metric.aliases : [];
  const sortedAliases = [...aliases].sort((a, b) => String(b).length - String(a).length);
  for (const alias of sortedAliases) {
    if (includesPhrase(normalized, alias)) {
      const ratio = Math.min(1, normalizeQuestion(alias).length / Math.max(normalized.length, 1));
      score = Math.max(score, 0.55 + ratio * 0.4);
    }
  }

  const pageLabel = String(metric.page_label || "");
  if (intent === "location" && pageLabel && includesPhrase(normalized, pageLabel)) {
    score = Math.max(score, 0.72);
  }

  const qTokens = tokenize(question);
  const metricTokens = new Set([
    ...tokenize(label),
    ...tokenize(metricIdPhrase),
    ...aliases.flatMap((alias) => tokenize(alias)),
    ...tokenize(metric.description || ""),
  ]);
  if (qTokens.length > 0) {
    const overlap = qTokens.filter((token) => metricTokens.has(token)).length;
    score = Math.max(score, (overlap / qTokens.length) * 0.65);
  }

  for (const rule of DISAMBIGUATION) {
    if (!rule.tokens.some((token) => normalized.includes(token))) continue;
    if (rule.unless?.some((token) => normalized.includes(token))) continue;
    const tokenCount = rule.tokens.filter((token) => normalized.includes(token)).length;
    const weight = tokenCount > 1 ? 0.28 : 0.2;
    if (rule.boost?.includes(metric.metric_id)) score += weight;
    if (rule.penalize?.includes(metric.metric_id)) score -= 0.25;
  }

  return Math.max(0, Math.min(1, score));
}

export const MATCH_THRESHOLD = 0.45;
export const HIGH_CONFIDENCE = 0.65;

/**
 * @param {string} message
 * @param {object[]} catalog
 * @returns {{ intent: string, matches: Array<{ metric_id: string, score: number, metric: object }>, candidates: Array<{ metric_id: string, score: number, metric: object }> }}
 */
const OUT_OF_DOMAIN = /\b(investimento|comprar acao|comprar ação|vender acao|melhor acao|melhor ação|acao devo|ação devo|devo comprar|devo investir)\b/;

export function matchMetrics(message, catalog) {
  const normalized = normalizeQuestion(message);
  if (OUT_OF_DOMAIN.test(normalized)) {
    return { intent: detectIntent(message), matches: [], candidates: [] };
  }

  const intent = detectIntent(message);
  const scored = (catalog || [])
    .map((metric) => ({
      metric_id: metric.metric_id,
      score: scoreMetric(message, metric, intent),
      metric,
    }))
    .filter((entry) => entry.score > 0.15)
    .sort((a, b) => b.score - a.score);

  const matches = scored.filter((entry) => entry.score >= MATCH_THRESHOLD);
  const candidates = scored.slice(0, 5).filter((entry) => entry.score >= 0.2);

  return { intent, matches, candidates };
}

export function hasHighConfidenceMatch(result) {
  return Boolean(result?.matches?.[0]?.score >= HIGH_CONFIDENCE);
}
