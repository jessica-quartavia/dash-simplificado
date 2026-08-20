/**
 * Orquestração do Assistente V2: matching → catálogo → snapshot → compute → Gemini/fallback.
 */
import { randomUUID } from "node:crypto";
import { loadAssistantCatalog } from "./catalog-loader.mjs";
import { matchMetrics, HIGH_CONFIDENCE } from "./metric-matcher.mjs";
import { buildAnalyticsContext, buildGenericContext } from "./analytics-context-builder.mjs";
import { ASSISTANT_SYSTEM_PROMPT, buildGeminiContents } from "./assistant-prompt.mjs";
import { generateAssistantReply } from "./gemini-client.mjs";
import { analyticsSnapshotStore } from "../analytics/snapshot/metric-snapshot-store.mjs";
import { parseAssistantFilters } from "./filter-parser.mjs";
import {
  validateAssistantFilters,
  collectEngineerOptions,
  collectSegmentOptions,
  resolveEngineerName,
} from "./metric-filter-contract.mjs";
import { resolveMetricValue, isSnapshotUsable } from "./compute/assistant-value-extractor.mjs";
import { formatCoverageNote } from "./value-formatter.mjs";
import { isComputeEligible } from "./compute/assistant-compute-registry.mjs";
import { runAssistantPageCompute } from "./compute/assistant-compute-runner.mjs";
import { foldSearchText } from "../analytics/filters/search.mjs";

const MAX_HISTORY = 8;

function trimHistory(history) {
  return (history || [])
    .filter((item) => item && typeof item.content === "string")
    .slice(-MAX_HISTORY);
}

function formatSources(metric) {
  const systems = Array.isArray(metric?.source_systems) ? metric.source_systems : [];
  if (systems.length === 0) return `Não há fonte registrada no catálogo para "${metric?.label || metric?.metric_id}".`;
  return `O indicador "${metric.label}" utiliza as fontes: ${systems.join(", ")}.`;
}

function formatLocation(metric) {
  return `O indicador "${metric.label}" está disponível na página ${metric.page_label} (${metric.page_id}).`;
}

function formatRule(metric) {
  const rule = metric.calculation_summary || metric.description;
  if (!rule) return `Não encontrei a regra de cálculo de "${metric.label}" no catálogo.`;
  const validated = metric.validated_for_v2
    ? ""
    : " Este indicador não está validado oficialmente para o Dash Kids V2.";
  return `Regra de "${metric.label}": ${rule}.${validated}`;
}

function formatValueUnavailable(metric, valueResult, filterWarnings = []) {
  const validatedNote = metric.validated_for_v2
    ? ""
    : " Observação: este indicador não está validado oficialmente para o Dash Kids V2.";
  const reason = valueResult?.reason;
  let detail = "o valor atual não está carregado no contexto rápido neste momento.";
  if (reason === "compute_timeout") detail = "o cálculo oficial demorou mais que o esperado.";
  else if (reason === "compute_failed") detail = "não foi possível calcular o valor agora.";
  else if (reason === "not_validated_v2") detail = "este indicador não está validado como oficial do Dash Kids V2.";
  const warningText = filterWarnings.length ? ` ${filterWarnings[0]}` : "";
  return `O indicador ${metric.label} está disponível em ${metric.page_label}, mas ${detail}${validatedNote}${warningText}`;
}

function formatRenewalWarning(metric) {
  if (metric.metric_id !== "renewal_rate" && metric.validated_for_v2 !== false) return "";
  return " Este indicador existe no catálogo histórico, mas não foi validado como indicador oficial do Dash Kids V2.";
}

function formatDeterministicValue({ metric, valueResult, filterWarnings = [] }) {
  if (!valueResult?.available) return null;

  if (metric.metric_id === "most_used_mechanism" && valueResult.data?.label) {
    return `O mecanismo mais utilizado é ${valueResult.data.label}${valueResult.data.clients != null ? ` (${valueResult.data.clients} clientes)` : ""}. Esse indicador está em ${metric.page_label}.${filterWarnings.length ? ` ${filterWarnings.join(" ")}` : ""}`;
  }

  if (!valueResult?.formatted) return null;
  const coverage = formatCoverageNote({
    coverage: valueResult.coverage,
    sampleSize: valueResult.sample_size,
    numerator: valueResult.numerator,
    denominator: valueResult.denominator,
    metricLabel: metric.label,
  });
  const warnings = filterWarnings.length ? ` ${filterWarnings.join(" ")}` : "";
  const pageNote = ` Esse indicador está em ${metric.page_label}.`;
  return `${valueResult.formatted}.${pageNote}${coverage ? ` ${coverage}` : ""}${warnings}`;
}

function shouldResolveValue(intent, metric) {
  return intent === "value" || intent === "comparison" || intent === "general";
}

async function readSnapshot({ metricId, accessToken, deps }) {
  const store = deps.analyticsSnapshotStore || analyticsSnapshotStore;
  try {
    const { rows } = await store.read({ metricId, accessToken });
    return rows?.[0] || null;
  } catch {
    return null;
  }
}

async function resolveFiltersForMetric({ message, metric, deps }) {
  const parsed = parseAssistantFilters(message);
  const validation = validateAssistantFilters(metric, parsed.filters);
  const warnings = [...validation.warnings];
  let appliedFilters = validation.appliedFilters;
  let bootstrap = null;

  if (!isComputeEligible(metric)) {
    return { appliedFilters, warnings, hints: parsed.hints, bootstrap: null };
  }

  const pageId = metric.page_id;
  const needsResolution = parsed.hints.engineerQuery || parsed.hints.segmentQuery;
  if (!needsResolution) {
    return { appliedFilters, warnings, hints: parsed.hints, bootstrap: null };
  }

  try {
    bootstrap = await runAssistantPageCompute({
      pageId,
      metricId: metric.metric_id,
      filters: appliedFilters,
      deps,
    });

    if (parsed.hints.engineerQuery) {
      const resolved = resolveEngineerName(
        parsed.hints.engineerQuery,
        collectEngineerOptions(bootstrap.payload, pageId),
      );
      if (resolved.ambiguous) {
        warnings.push("Há mais de um EP compatível com o filtro informado; o EP não foi aplicado.");
      } else if (resolved.value) {
        appliedFilters = { ...appliedFilters, engineer: resolved.value };
      } else {
        warnings.push("Não encontrei o EP informado nas opções atuais; o filtro de EP não foi aplicado.");
      }
    }

    if (parsed.hints.segmentQuery) {
      const options = collectSegmentOptions(bootstrap.payload);
      const needle = foldSearchText(parsed.hints.segmentQuery);
      const exact = options.filter((item) => foldSearchText(item) === needle);
      const partial = options.filter((item) => foldSearchText(item).includes(needle));
      const pick = exact.length === 1 ? exact[0] : partial.length === 1 ? partial[0] : null;
      if (pick) appliedFilters = { ...appliedFilters, segment: pick };
      else if (exact.length > 1 || partial.length > 1) {
        warnings.push("Há mais de um segmento compatível; o filtro de segmento não foi aplicado.");
      } else {
        warnings.push("Não encontrei o segmento informado; o filtro de segmento não foi aplicado.");
      }
    }

    return { appliedFilters, warnings, hints: parsed.hints, bootstrap };
  } catch {
    return { appliedFilters, warnings, hints: parsed.hints, bootstrap: null };
  }
}

function tryDeterministicAnswer({ intent, metric, context, matchScore, valueResult, filterWarnings }) {
  if (!metric || matchScore < HIGH_CONFIDENCE) return null;

  if (intent === "location") return formatLocation(metric);
  if (intent === "source") return formatSources(metric);
  if (intent === "rule") return formatRule(metric) + formatRenewalWarning(metric);

  if (intent === "value" || intent === "general") {
    const valueAnswer = formatDeterministicValue({ metric, valueResult, filterWarnings });
    if (valueAnswer) return valueAnswer;
    if (intent === "value" && !valueResult?.available) {
      return formatValueUnavailable(metric, valueResult, filterWarnings) + formatRenewalWarning(metric);
    }
  }

  if (intent === "limitation" && Array.isArray(metric.limitations) && metric.limitations.length > 0) {
    return `Limitações conhecidas de "${metric.label}": ${metric.limitations.join(" ")}`;
  }
  return null;
}

function buildPageRef(metric) {
  if (!metric) return null;
  return {
    page_id: metric.page_id,
    page_label: metric.page_label,
    validated_for_v2: Boolean(metric.validated_for_v2),
    dash_kids_status: metric.dash_kids_status ?? null,
  };
}

function buildMeta({
  requestId,
  catalogSource,
  context,
  valueResult,
  usedSnapshot,
  usedCompute,
  computePage,
  computeCacheHit,
  usedGemini,
  timings,
  extra = {},
}) {
  return {
    request_id: requestId,
    used_snapshot: usedSnapshot,
    used_compute: usedCompute,
    compute_page: computePage || null,
    compute_cache_hit: computeCacheHit ?? false,
    used_gemini: usedGemini,
    catalog_source: catalogSource,
    context_bytes: context?.contextBytes || 0,
    value_source: valueResult?.source || null,
    timings_ms: timings,
    ...extra,
  };
}

export async function runAssistant({
  message,
  history = [],
  accessToken,
  requestId = randomUUID().slice(0, 8),
  deps = {},
} = {}) {
  const startedAt = Date.now();
  const timings = {
    catalogMs: 0,
    matchMs: 0,
    snapshotMs: 0,
    computeMs: 0,
    geminiMs: 0,
  };

  const trimmedMessage = String(message || "").trim();
  if (!trimmedMessage) {
    return {
      status: 400,
      body: { error: "Informe a pergunta em message.", code: "message_required" },
    };
  }

  const catalogStarted = Date.now();
  const loadCatalog = deps.loadAssistantCatalog || loadAssistantCatalog;
  const { rows: catalog, source: catalogSource } = await loadCatalog({ accessToken, deps });
  timings.catalogMs = Date.now() - catalogStarted;

  if (!catalog?.length) {
    return {
      status: 503,
      body: {
        error: "Catálogo analítico indisponível no momento.",
        code: "catalog_unavailable",
      },
    };
  }

  const matchingStarted = Date.now();
  const matchFn = deps.matchMetrics || matchMetrics;
  const matchResult = matchFn(trimmedMessage, catalog);
  timings.matchMs = Date.now() - matchingStarted;

  const primary = matchResult.matches[0] || null;
  const metric = primary?.metric || null;

  if (metric?.metric_id) {
    console.info(`[assistant] matched ${metric.metric_id} id=${requestId} intent=${matchResult.intent}`);
  }

  let snapshotRow = null;
  let usedSnapshot = false;
  let usedCompute = false;
  let computePage = null;
  let computeCacheHit = false;
  let valueResult = { available: false, source: null, reason: null };
  let appliedFilters = {};
  let filterWarnings = [];

  if (metric?.metric_id) {
    const snapshotStarted = Date.now();
    snapshotRow = await readSnapshot({ metricId: metric.metric_id, accessToken, deps });
    timings.snapshotMs = Date.now() - snapshotStarted;
    if (isSnapshotUsable(snapshotRow)) {
      console.info(`[assistant] snapshot hit id=${requestId} metric=${metric.metric_id}`);
    } else {
      console.info(`[assistant] snapshot miss id=${requestId} metric=${metric.metric_id}`);
    }

    const filterState = await resolveFiltersForMetric({ message: trimmedMessage, metric, deps });
    appliedFilters = filterState.appliedFilters;
    filterWarnings = filterState.warnings;

    if (shouldResolveValue(matchResult.intent, metric)) {
      if (isSnapshotUsable(snapshotRow)) {
        const resolveValue = deps.resolveMetricValue || resolveMetricValue;
        valueResult = await resolveValue({
          metric,
          snapshotRow,
          filters: appliedFilters,
          deps,
          prefetched: filterState.bootstrap,
        });
        usedSnapshot = true;
      } else if (isComputeEligible(metric)) {
        console.info(`[assistant] compute ${metric.page_id || "page"} start id=${requestId} metric=${metric.metric_id}`);
        const computeStarted = Date.now();
        const resolveValue = deps.resolveMetricValue || resolveMetricValue;
        valueResult = await resolveValue({
          metric,
          snapshotRow: null,
          filters: appliedFilters,
          deps,
          prefetched: filterState.bootstrap,
        });
        timings.computeMs = Date.now() - computeStarted;
        usedCompute = Boolean(valueResult?.source === "compute");
        computePage = valueResult?.compute_page || metric.page_id || null;
        computeCacheHit = Boolean(valueResult?.compute_cache_hit);
        if (typeof valueResult?.compute_ms === "number" && valueResult.compute_ms > 0) {
          timings.computeMs = valueResult.compute_ms;
        }
        if (usedCompute && valueResult?.available) {
          console.info(`[assistant] compute ${computePage || metric.page_id} success id=${requestId} metric=${metric.metric_id}`);
        }
      } else {
        valueResult = { available: false, source: null, reason: "not_validated_v2" };
      }
    }
  }

  const context = metric
    ? buildAnalyticsContext({
        metric,
        valueResult,
        intent: matchResult.intent,
        filterWarnings,
        appliedFilters,
      })
    : buildGenericContext({ intent: matchResult.intent, candidates: matchResult.candidates });

  const metaBase = buildMeta({
    requestId,
    catalogSource,
    context,
    valueResult,
    usedSnapshot,
    usedCompute,
    computePage,
    computeCacheHit,
    usedGemini: false,
    timings,
  });

  const deterministic = tryDeterministicAnswer({
    intent: matchResult.intent,
    metric,
    context,
    matchScore: primary?.score || 0,
    valueResult,
    filterWarnings,
  });

  const prefersGeminiNarrative = /\b(explique|explicar|explica|de forma simples|em poucas palavras)\b/i.test(
    trimmedMessage,
  );

  if (deterministic && !prefersGeminiNarrative && (
    matchResult.intent === "location"
    || matchResult.intent === "source"
    || ((matchResult.intent === "value" || matchResult.intent === "general") && valueResult?.available)
    || matchResult.intent === "rule"
  )) {
    console.info(`[assistant] deterministic response id=${requestId} metric=${metric?.metric_id || "—"}`);
    metaBase.timings_ms.totalMs = Date.now() - startedAt;
    return {
      status: 200,
      body: {
        answer: deterministic,
        matched_metrics: matchResult.matches.slice(0, 3).map((entry) => ({
          metric_id: entry.metric_id,
          score: Number(entry.score.toFixed(3)),
          label: entry.metric?.label,
        })),
        intent: matchResult.intent,
        filters: appliedFilters,
        page: buildPageRef(metric),
        meta: { ...metaBase, used_gemini: false, deterministic: true },
      },
    };
  }

  const generate = deps.generateAssistantReply || generateAssistantReply;
  const contents = buildGeminiContents({
    message: trimmedMessage,
    history: trimHistory(history),
    context,
  });

  try {
    const geminiStarted = Date.now();
    const gemini = await generate({
      systemPrompt: ASSISTANT_SYSTEM_PROMPT,
      contents,
      deps,
    });
    timings.geminiMs = Date.now() - geminiStarted;
    metaBase.timings_ms.totalMs = Date.now() - startedAt;

    return {
      status: 200,
      body: {
        answer: gemini.text,
        matched_metrics: matchResult.matches.slice(0, 3).map((entry) => ({
          metric_id: entry.metric_id,
          score: Number(entry.score.toFixed(3)),
          label: entry.metric?.label,
        })),
        intent: matchResult.intent,
        filters: appliedFilters,
        page: buildPageRef(metric),
        meta: {
          ...metaBase,
          used_gemini: true,
          gemini_model: gemini.model,
          gemini_latency_ms: gemini.latencyMs,
        },
      },
    };
  } catch (error) {
    const fallback = deterministic
      || (metric && matchResult.intent === "rule" ? formatRule(metric) : null)
      || (metric && matchResult.intent === "value" ? formatValueUnavailable(metric, valueResult, filterWarnings) : null)
      || (matchResult.matches.length === 0
        ? "Não identifiquei um indicador específico com confiança suficiente. Reformule citando o indicador ou a página do dashboard."
        : "Não foi possível gerar a resposta com IA neste momento. Tente novamente em instantes.");

    metaBase.timings_ms.totalMs = Date.now() - startedAt;
    return {
      status: 200,
      body: {
        answer: fallback,
        matched_metrics: matchResult.matches.slice(0, 3).map((entry) => ({
          metric_id: entry.metric_id,
          score: Number(entry.score.toFixed(3)),
          label: entry.metric?.label,
        })),
        intent: matchResult.intent,
        filters: appliedFilters,
        page: buildPageRef(metric),
        meta: {
          ...metaBase,
          used_gemini: false,
          gemini_error: error?.code || "gemini_failed",
          deterministic: Boolean(deterministic),
        },
      },
    };
  }
}
