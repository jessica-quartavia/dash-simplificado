/**
 * Descobertas determinísticas + blocos narrativos do relatório (Cruzamentos Estatísticos).
 * Sem LLM — regras fixas em português a partir do payload analítico.
 */

const MIN_ASSOC = 0.1;
const MIN_DESCRIPTIVE_N = 5;
const MIN_INFERENCE_N = 30;
const MAX_DISCOVERIES = 12;
const MIN_DISCOVERIES = 3;

function absNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.abs(n) : null;
}

function fmtPct(v, digits = 1) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Number(v).toFixed(digits)}%`;
}

function fmtNum(v, digits = 2) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toFixed(digits);
}

function assocValue(row) {
  return (
    row?.association ??
    row?.associationAbs ??
    row?.absMeasure ??
    row?.abs ??
    row?.r ??
    row?.rho ??
    row?.cramersV ??
    row?.rankBiserial ??
    null
  );
}

function assocN(row) {
  if (row?.n != null && Number.isFinite(Number(row.n))) return Number(row.n);
  if (row?.nValid != null && Number.isFinite(Number(row.nValid))) return Number(row.nValid);
  if (row?.sampleSize != null && Number.isFinite(Number(row.sampleSize))) return Number(row.sampleSize);
  if (row?.n1 != null || row?.n2 != null) return (Number(row.n1) || 0) + (Number(row.n2) || 0);
  return null;
}

function pushDiscovery(list, item) {
  if (!item || !item.title || !item.text) return;
  list.push({
    id: item.id,
    priority: item.priority ?? 50,
    title: item.title,
    text: item.text,
    evidence: item.evidence || {},
    section: item.section || "geral",
  });
}

function topNumericChurn(churnAssociations) {
  const rows = [
    ...(churnAssociations?.numeric || []),
    ...(Array.isArray(churnAssociations) ? churnAssociations.filter((r) => r.type === "numeric") : []),
  ];
  return [...rows]
    .map((r) => ({ row: r, abs: absNum(assocValue(r)) }))
    .filter((x) => x.abs != null && x.abs >= MIN_ASSOC && (assocN(x.row) == null || assocN(x.row) >= MIN_DESCRIPTIVE_N))
    .sort((a, b) => b.abs - a.abs);
}

function topCategoricalChurn(churnAssociations) {
  const rows = [
    ...(churnAssociations?.categorical || []),
    ...(Array.isArray(churnAssociations) ? churnAssociations.filter((r) => r.type === "categorical") : []),
  ];
  return [...rows]
    .map((r) => ({ row: r, abs: absNum(assocValue(r) ?? r.cramersV) }))
    .filter((x) => x.abs != null && x.abs >= MIN_ASSOC && (assocN(x.row) == null || assocN(x.row) >= MIN_DESCRIPTIVE_N))
    .sort((a, b) => b.abs - a.abs);
}

function topRenewal(renewalAssociations) {
  const rows = [
    ...(renewalAssociations?.numeric || []),
    ...(renewalAssociations?.categorical || []),
  ];
  return [...rows]
    .map((r) => ({ row: r, abs: absNum(assocValue(r) ?? r.cramersV) }))
    .filter((x) => x.abs != null && x.abs >= MIN_ASSOC && (assocN(x.row) == null || assocN(x.row) >= MIN_DESCRIPTIVE_N))
    .sort((a, b) => b.abs - a.abs);
}

function activeVsCancelledHighlights(activeVsCancelled) {
  const rows = Array.isArray(activeVsCancelled) ? activeVsCancelled : [];
  return [...rows]
    .map((r) => {
      const delta = r.medianDiff ?? r.diff ?? ((r.medianCancelled != null && r.medianActive != null)
        ? r.medianCancelled - r.medianActive
        : null);
      const n1 = r.nActive ?? r.n1 ?? null;
      const n2 = r.nCancelled ?? r.n2 ?? null;
      const nOk =
        (n1 == null || n1 >= MIN_DESCRIPTIVE_N) &&
        (n2 == null || n2 >= MIN_DESCRIPTIVE_N);
      return { row: r, abs: absNum(delta ?? r.rankBiserial ?? r.effect), delta, nOk };
    })
    .filter((x) => x.nOk && x.abs != null && x.abs > 0)
    .sort((a, b) => b.abs - a.abs);
}

/**
 * @param {{
 *   activeVsCancelled?: object[],
 *   churnAssociations?: object,
 *   renewalAssociations?: object,
 *   npsGroups?: object[],
 *   survival?: object,
 *   cohort?: object,
 *   summary?: object,
 *   correlationMatrix?: object,
 *   tenureCorrelations?: object[],
 * }} payloadParts
 */
export function buildStatisticalDiscoveries(payloadParts = {}) {
  const discoveries = [];
  const {
    activeVsCancelled,
    churnAssociations,
    renewalAssociations,
    npsGroups,
    survival,
    cohort,
    summary,
    correlationMatrix,
    tenureCorrelations,
  } = payloadParts;

  const analyzed = summary?.analyzedClients ?? summary?.total ?? null;
  const cancelled = summary?.confirmedCancellations ?? summary?.cancelled ?? null;
  const active = summary?.activeClients ?? summary?.active ?? null;
  const coverage = summary?.averageCoverage ?? null;

  if (analyzed != null && analyzed >= MIN_DESCRIPTIVE_N) {
    pushDiscovery(discoveries, {
      id: "pop_overview",
      priority: 10,
      section: "populacao",
      title: "Recorte analítico",
      text:
        `A análise cobre ${analyzed} cliente(s)` +
        (active != null ? `, com ${active} ativo(s)` : "") +
        (cancelled != null ? ` e ${cancelled} cancelamento(s) confirmado(s)` : "") +
        (coverage != null ? `. Cobertura média das variáveis: ${fmtPct(coverage)}.` : "."),
      evidence: { analyzed, active, cancelled, averageCoverage: coverage },
    });
  }

  const churnNum = topNumericChurn(churnAssociations);
  if (churnNum[0]) {
    const { row, abs } = churnNum[0];
    const dir = Number(assocValue(row)) >= 0 ? "positiva" : "negativa";
    pushDiscovery(discoveries, {
      id: "churn_top_numeric",
      priority: 20,
      section: "churn",
      title: `Associação numérica com churn: ${row.label || row.id}`,
      text:
        `A variável “${row.label || row.id}” apresenta associação ${dir} com cancelamento ` +
        `(medida ${fmtNum(assocValue(row))}, |efeito|=${fmtNum(abs)}, força ${row.strength || row.associationStrength || "—" }` +
        (assocN(row) != null ? `, n=${assocN(row)}` : "") +
        `). Interpretação descritiva do recorte — não implica causalidade.`,
      evidence: {
        id: row.id,
        label: row.label,
        association: assocValue(row),
        abs,
        n: assocN(row),
        strength: row.strength || row.associationStrength,
      },
    });
  }
  if (churnNum[1]) {
    const { row, abs } = churnNum[1];
    pushDiscovery(discoveries, {
      id: "churn_second_numeric",
      priority: 25,
      section: "churn",
      title: `Segunda associação numérica: ${row.label || row.id}`,
      text:
        `“${row.label || row.id}” também se destaca (|efeito|=${fmtNum(abs)}, força ${row.strength || "—"}). ` +
        `Vale cruzar com cobertura e qualidade dos dados antes de priorizar ações.`,
      evidence: { id: row.id, label: row.label, association: assocValue(row), abs, n: assocN(row) },
    });
  }

  const churnCat = topCategoricalChurn(churnAssociations);
  if (churnCat[0]) {
    const { row, abs } = churnCat[0];
    pushDiscovery(discoveries, {
      id: "churn_top_categorical",
      priority: 22,
      section: "churn",
      title: `Associação categórica com churn: ${row.label || row.id}`,
      text:
        `Entre categorias, “${row.label || row.id}” tem Cramér’s V ≈ ${fmtNum(abs)} ` +
        `(${row.strength || row.associationStrength || "—"})` +
        (assocN(row) != null ? ` com n=${assocN(row)}` : "") +
        `. Diferenças entre níveis merecem leitura operacional, não só estatística.`,
      evidence: { id: row.id, label: row.label, cramersV: abs, n: assocN(row) },
    });
  }

  const avc = activeVsCancelledHighlights(activeVsCancelled);
  if (avc[0]) {
    const { row, delta } = avc[0];
    const medA = row.medianActive ?? row.medianA ?? null;
    const medC = row.medianCancelled ?? row.medianB ?? null;
    pushDiscovery(discoveries, {
      id: "avc_top_diff",
      priority: 30,
      section: "ativos_vs_cancelados",
      title: `Diferença ativos × cancelados: ${row.label || row.id}`,
      text:
        `Na comparação ativos versus cancelados, “${row.label || row.id}” mostra diferença relevante` +
        (medA != null && medC != null
          ? ` (mediana ativos ${fmtNum(medA, 1)} vs cancelados ${fmtNum(medC, 1)})`
          : delta != null
            ? ` (Δ≈${fmtNum(delta, 1)})`
            : "") +
        `. Amostra descritiva mínima atendida; estabilidade melhora com n≥${MIN_INFERENCE_N} por grupo.`,
      evidence: {
        id: row.id,
        label: row.label,
        medianActive: medA,
        medianCancelled: medC,
        delta,
        nActive: row.nActive ?? row.n1,
        nCancelled: row.nCancelled ?? row.n2,
      },
    });
  }

  const ren = topRenewal(renewalAssociations);
  if (ren[0] && (renewalAssociations?.eligible || 0) >= MIN_DESCRIPTIVE_N) {
    const { row, abs } = ren[0];
    pushDiscovery(discoveries, {
      id: "renewal_top",
      priority: 35,
      section: "renovacao",
      title: `Sinal de renovação: ${row.label || row.id}`,
      text:
        `No universo elegível de renovação (ciclo≥1), “${row.label || row.id}” associa-se a renovação ` +
        `(|efeito|=${fmtNum(abs)}, ${row.strength || "—"}; elegíveis=${renewalAssociations.eligible}, ` +
        `renovados=${renewalAssociations.renewed ?? "—"}). Regra: ciclo atual > 1 ⇒ renovado.`,
      evidence: {
        id: row.id,
        label: row.label,
        association: assocValue(row),
        eligible: renewalAssociations.eligible,
        renewed: renewalAssociations.renewed,
        notRenewed: renewalAssociations.notRenewed,
      },
    });
  } else if ((renewalAssociations?.eligible || 0) > 0 && (renewalAssociations?.renewed || 0) >= 0) {
    pushDiscovery(discoveries, {
      id: "renewal_coverage",
      priority: 36,
      section: "renovacao",
      title: "Cobertura de renovação",
      text:
        `Há ${renewalAssociations.eligible} cliente(s) elegível(is) para análise de renovação ` +
        `(${renewalAssociations.renewed ?? 0} renovado(s), ${renewalAssociations.notRenewed ?? 0} no ciclo 1). ` +
        `Associações fortes (|efeito|≥${MIN_ASSOC}) ainda não se destacaram com os limiares atuais.`,
      evidence: {
        eligible: renewalAssociations.eligible,
        renewed: renewalAssociations.renewed,
        notRenewed: renewalAssociations.notRenewed,
      },
    });
  }

  const npsRows = Array.isArray(npsGroups) ? npsGroups : [];
  const npsWithN = npsRows.filter((g) => (g.n || 0) >= MIN_DESCRIPTIVE_N);
  if (npsWithN.length >= 2) {
    const ranked = [...npsWithN].sort((a, b) => (b.cancelledPct ?? -1) - (a.cancelledPct ?? -1));
    const hi = ranked[0];
    const lo = ranked[ranked.length - 1];
    if (hi && lo && hi !== lo && hi.cancelledPct != null && lo.cancelledPct != null) {
      const gap = hi.cancelledPct - lo.cancelledPct;
      if (Math.abs(gap) >= 5) {
        pushDiscovery(discoveries, {
          id: "nps_churn_gap",
          priority: 40,
          section: "nps",
          title: "NPS e taxa de cancelamento",
          text:
            `Entre classes NPS com n≥${MIN_DESCRIPTIVE_N}, “${hi.label || hi.id}” tem cancelamento ${fmtPct(hi.cancelledPct)} ` +
            `versus ${fmtPct(lo.cancelledPct)} em “${lo.label || lo.id}” (gap ${fmtPct(gap)}). ` +
            `NPS pós-cancelamento não entra no cruzamento preditivo.`,
          evidence: {
            high: { label: hi.label, n: hi.n, cancelledPct: hi.cancelledPct },
            low: { label: lo.label, n: lo.n, cancelledPct: lo.cancelledPct },
            gapPp: gap,
          },
        });
      }
    }
  }

  const surv = survival?.overall || survival;
  if (surv && (surv.nStart || 0) >= MIN_DESCRIPTIVE_N) {
    pushDiscovery(discoveries, {
      id: "survival_km",
      priority: 45,
      section: "sobrevivencia",
      title: "Sobrevivência contratual (Kaplan–Meier)",
      text:
        `Curva KM com nStart=${surv.nStart}, ${surv.events ?? 0} evento(s) e ${surv.censored ?? 0} censura(s)` +
        (surv.medianSurvival != null
          ? `; mediana de sobrevivência ≈ ${surv.medianSurvival} dia(s)`
          : "; mediana ainda não cruzou 50% no horizonte observado") +
        `. Ativos/congelados censurados na data de geração.`,
      evidence: {
        nStart: surv.nStart,
        events: surv.events,
        censored: surv.censored,
        medianSurvival: surv.medianSurvival,
      },
    });
  }

  if (cohort?.averages?.length) {
    const a3 = cohort.averages.find((a) => a.age === 3 && a.meanRetentionPct != null);
    const a6 = cohort.averages.find((a) => a.age === 6 && a.meanRetentionPct != null);
    const a12 = cohort.averages.find((a) => a.age === 12 && a.meanRetentionPct != null);
    const pick = a12 || a6 || a3;
    if (pick && (cohort.cohorts?.length || 0) >= 1) {
      pushDiscovery(discoveries, {
        id: "cohort_retention",
        priority: 50,
        section: "coorte",
        title: `Retenção média na idade ${pick.age}`,
        text:
          `Nas coortes ${cohort.granularity === "quarter" ? "trimestrais" : "mensais"} observáveis, ` +
          `a retenção média aos ${pick.age} mês(es) é ${fmtPct(pick.meanRetentionPct)}` +
          (pick.deltaPp != null ? ` (Δ vs idade anterior: ${fmtNum(pick.deltaPp, 1)} p.p.)` : "") +
          `. Células futuras permanecem nulas até o corte ${cohort.cutoffDate || "—"}.`,
        evidence: {
          age: pick.age,
          meanRetentionPct: pick.meanRetentionPct,
          deltaPp: pick.deltaPp,
          cohortCount: cohort.cohorts?.length,
          granularity: cohort.granularity,
        },
      });
    }
  }

  const strongest = correlationMatrix?.metadata?.strongestPair;
  if (strongest && absNum(strongest.value) >= MIN_ASSOC && (strongest.n || 0) >= 20) {
    pushDiscovery(discoveries, {
      id: "corr_strongest",
      priority: 55,
      section: "correlacao",
      title: `Correlação mais forte: ${strongest.labelA} × ${strongest.labelB}`,
      text:
        `Na matriz ${correlationMatrix.method || "spearman"}, o par “${strongest.labelA}” × “${strongest.labelB}” ` +
        `atinge ${fmtNum(strongest.value)} (${strongest.strength || "—"}, n=${strongest.n}). ` +
        `Correlação não implica causalidade; verificar cobertura e outliers.`,
      evidence: strongest,
    });
  }

  const tenure = Array.isArray(tenureCorrelations) ? tenureCorrelations : [];
  const tenureTop = [...tenure]
    .map((r) => ({ row: r, abs: absNum(r.rho ?? r.r ?? r.association) }))
    .filter((x) => x.abs != null && x.abs >= MIN_ASSOC && (x.row.n || 0) >= MIN_DESCRIPTIVE_N)
    .sort((a, b) => b.abs - a.abs)[0];
  if (tenureTop) {
    const { row, abs } = tenureTop;
    pushDiscovery(discoveries, {
      id: "tenure_corr",
      priority: 58,
      section: "permanencia",
      title: `Permanência × ${row.label || row.id}`,
      text:
        `Spearman entre permanência (stayDays) e “${row.label || row.id}”: ρ=${fmtNum(row.rho ?? row.r)} ` +
        `(|ρ|=${fmtNum(abs)}, n=${row.n ?? "—"}). Não-cancelados entram censurados na definição de permanência.`,
      evidence: { id: row.id, label: row.label, rho: row.rho ?? row.r, n: row.n },
    });
  }

  // Garantir piso mínimo com achados de cobertura/limitação quando pouco sinal
  if (discoveries.length < MIN_DISCOVERIES) {
    pushDiscovery(discoveries, {
      id: "coverage_caveat",
      priority: 90,
      section: "qualidade",
      title: "Limiar de evidência",
      text:
        `Poucos sinais cruzaram os limiares (|associação|≥${MIN_ASSOC}, n descritivo≥${MIN_DESCRIPTIVE_N}). ` +
        `Ampliar o recorte, melhorar preenchimento de variáveis ou reduzir filtros pode aumentar a potência.`,
      evidence: { minAssoc: MIN_ASSOC, minDescriptiveN: MIN_DESCRIPTIVE_N, discoveriesSoFar: discoveries.length },
    });
  }
  if (discoveries.length < MIN_DISCOVERIES && coverage != null && coverage < 70) {
    pushDiscovery(discoveries, {
      id: "low_coverage",
      priority: 91,
      section: "qualidade",
      title: "Cobertura de dados",
      text:
        `A cobertura média das variáveis (${fmtPct(coverage)}) está abaixo de 70%. ` +
        `Associações e a matriz de correlação ficam mais instáveis com muitos missings.`,
      evidence: { averageCoverage: coverage },
    });
  }
  if (discoveries.length < MIN_DISCOVERIES) {
    pushDiscovery(discoveries, {
      id: "method_note",
      priority: 95,
      section: "metodologia",
      title: "Leitura metodológica",
      text:
        "Os cruzamentos descrevem coocorrência no recorte BASE QV filtrado. " +
        "Cancelamento usa status analítico efetivado; renovação usa clients.ciclo; sobrevivência é Kaplan–Meier com censura na data de geração.",
      evidence: { source: "BASE QV" },
    });
  }

  discoveries.sort((a, b) => (a.priority - b.priority) || String(a.id).localeCompare(String(b.id)));
  const trimmed = discoveries.slice(0, MAX_DISCOVERIES);

  const generatedNarratives = trimmed.map((d) => ({
    id: d.id,
    section: d.section,
    title: d.title,
    text: d.text,
  }));

  const limitations = [
    "Associações estatísticas não estabelecem causalidade.",
    "Amostras pequenas (n < 30 por grupo) reduzem estabilidade inferencial; limiar descritivo usado é n ≥ 5.",
    "Dados ausentes e filtros do portal alteram cobertura e composição da população.",
    "NPS pós-cancelamento é excluído de cruzamentos preditivos.",
    "App Pharus não fornece desfecho próprio de churn nesta fase.",
    "Células futuras da retenção por coorte são nulas (não zero) até o corte observável.",
  ];

  const methodology = [
    "População: join BASE QV (general-data + meetings + mechanisms + nps_responses) após filtros do portal.",
    "Churn: status analítico via isEffectiveCancelledStatus / isConfirmedCancelledStatus.",
    "Renovação: currentCycle > 1 ⇒ renovado; renewalCount = max(ciclo−1, 0).",
    "Associações numéricas com churn: point-biserial; categóricas: Cramér’s V.",
    "Comparação ativos vs cancelados: Mann–Whitney + rank-biserial (quando n suficiente).",
    "Matriz de correlação: Spearman (padrão) ou Pearson; pares com casos completos; n mínimo 20.",
    "Coortes: mês/trimestre de contratação; retenção por meses completos até cancelamento ou corte.",
    "Sobrevivência: Kaplan–Meier; evento = cancelamento com data; demais censurados no corte.",
  ];

  const glossary = [
    { term: "Point-biserial", definition: "Correlação entre variável contínua e desfecho binário (ex.: cancelado)." },
    { term: "Cramér’s V", definition: "Força de associação entre duas variáveis categóricas (0–1)." },
    { term: "Spearman ρ", definition: "Correlação por postos; robusta a relações monotônicas e outliers." },
    { term: "Pearson r", definition: "Correlação linear entre duas variáveis contínuas." },
    { term: "Kaplan–Meier", definition: "Estimador de sobrevivência com censura à direita." },
    { term: "Coorte", definition: "Grupo de clientes que iniciaram no mesmo mês/trimestre de contratação." },
    { term: "Retenção idade N", definition: "Percentual ainda não cancelado após N meses completos desde a contratação." },
    { term: "Censura", definition: "Cliente sem evento de cancelamento até a data de corte da análise." },
  ];

  return {
    discoveries: trimmed,
    report: {
      generatedNarratives,
      limitations,
      methodology,
      glossary,
    },
  };
}
