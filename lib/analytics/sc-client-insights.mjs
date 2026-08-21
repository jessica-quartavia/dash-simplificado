/**
 * Insights simples, sinais de risco em ativos, índice de alta performance,
 * Top Pharus/Davos, matriz NPS expandida.
 * Sem alteração de banco. Sem LLM.
 */
import { dataConfigurationError } from "../env.mjs";
import { median, mean, coveragePct, round3, round4, sampleSd, standardizedDifference } from "./stats-tests.mjs";

function num(v) {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmt(v, digits = 1) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toFixed(digits).replace(".", ",");
}

function isDavos(c) {
  if (c?.davosContractSigned === true) return true;
  const p = String(c?.program || c?.programa || "").toLowerCase();
  return /davos/.test(p);
}

function isPharus(c) {
  if (isDavos(c)) return false;
  const p = String(c?.program || c?.programa || "").toLowerCase();
  if (/pharus|quarta\s*via|4via|base\s*qv|^$/.test(p) || !p) return true;
  // programa declarado sem Davos → trata como Pharus/QV
  return !/davos/.test(p);
}

/** Insights didáticos a partir de evidências já calculadas. */
export function buildSimpleInsights(ctx) {
  const list = [];
  const push = (item) => {
    if (!item?.title || !item?.text) return;
    if ((item.sample != null && item.sample < 20) || (item.coverage != null && item.coverage < 20)) {
      item.caveat = item.caveat || "Amostra ou cobertura limitada — interpretar com cautela.";
      item.lowConfidence = true;
    }
    list.push(item);
  };

  const diffs = ctx.activeVsCancelled || [];
  const meeting = diffs.find((d) => d.id === "meetingCount");
  if (meeting && meeting.medianActive != null && meeting.medianCancelled != null) {
    const a = meeting.medianActive;
    const c = meeting.medianCancelled;
    if (Math.abs(c - a) >= 0.5) {
      push({
        id: "meetings_cancelled_lower",
        category: "Cancelamento",
        title: c < a ? "Menos reuniões entre cancelados" : "Mais reuniões entre cancelados",
        text: c < a
          ? `Clientes cancelados tiveram mediana de ${fmt(c, 0)} reuniões, enquanto ativos tiveram mediana de ${fmt(a, 0)}.`
          : `Clientes cancelados tiveram mediana de ${fmt(c, 0)} reuniões, acima dos ativos (${fmt(a, 0)}).`,
        primaryValue: `${fmt(c, 0)} vs ${fmt(a, 0)}`,
        sample: (meeting.nActive || 0) + (meeting.nCancelled || 0),
        coverage: meeting.coveragePercent,
        strength: meeting.strength || null,
        technical: `Diferença de medianas; associação=${meeting.association ?? "—"}`,
        caveat: "Associação observada, não causalidade.",
      });
    }
  }

  const days = diffs.find((d) => d.id === "daysSinceLastMeeting");
  if (days && days.medianActive != null && days.medianCancelled != null && days.medianCancelled > days.medianActive) {
    push({
      id: "days_since_meeting_risk",
      category: "Cancelamento",
      title: "Mais tempo sem reunião entre cancelados",
      text: `Cancelados ficaram em média mais tempo sem reunião (mediana ${fmt(days.medianCancelled, 0)} dias) do que ativos (${fmt(days.medianActive, 0)} dias).`,
      primaryValue: `${fmt(days.medianCancelled, 0)} dias`,
      sample: (days.nActive || 0) + (days.nCancelled || 0),
      coverage: days.coveragePercent,
      technical: `associação=${days.association ?? "—"}`,
      caveat: "Associação observada, não causalidade.",
    });
  }

  const npsGroups = ctx.npsGroups || [];
  const pro = npsGroups.find((g) => /promo/i.test(g.label || g.class || ""));
  const det = npsGroups.find((g) => /detrat/i.test(g.label || g.class || ""));
  if (pro && det && (pro.n || 0) >= 10 && (det.n || 0) >= 10) {
    if ((det.cancelledPct || 0) > (pro.cancelledPct || 0) + 2) {
      push({
        id: "nps_cancel_gap",
        category: "NPS",
        title: "Detratores cancelam mais neste recorte",
        text: `Detratores tiveram ${fmt(det.cancelledPct)}% de cancelamento observado, contra ${fmt(pro.cancelledPct)}% entre promotores.`,
        primaryValue: `${fmt(det.cancelledPct)}%`,
        sample: (pro.n || 0) + (det.n || 0),
        coverage: ctx.summary?.npsPortfolioCoverage,
        caveat: ctx.summary?.npsPortfolioCoverage != null && ctx.summary.npsPortfolioCoverage < 30
          ? "Cobertura de NPS ainda é baixa — cautela na interpretação."
          : "Associação observada, não causalidade.",
        technical: `n promotores=${pro.n}; n detratores=${det.n}`,
      });
    }
    if ((pro.renewedPct || 0) > (det.renewedPct || 0) + 2) {
      push({
        id: "nps_renew_gap",
        category: "NPS",
        title: "Promotores renovam mais",
        text: `Promotores tiveram ${fmt(pro.renewedPct)}% de renovação observada neste recorte, acima dos detratores (${fmt(det.renewedPct)}%).`,
        primaryValue: `${fmt(pro.renewedPct)}%`,
        sample: (pro.n || 0) + (det.n || 0),
        coverage: ctx.summary?.npsPortfolioCoverage,
        caveat: "Cobertura NPS e tempo de ciclo afetam a leitura.",
      });
    }
  }

  if (ctx.summary?.npsPortfolioCoverage != null && ctx.summary.npsPortfolioCoverage < 30) {
    push({
      id: "nps_low_coverage",
      category: "Qualidade",
      title: "Cobertura de NPS ainda baixa",
      text: `Apenas ${fmt(ctx.summary.npsPortfolioCoverage)}% da população tem NPS válido neste recorte. Conclusões sobre satisfação pedem cautela.`,
      primaryValue: `${fmt(ctx.summary.npsPortfolioCoverage)}%`,
      sample: ctx.summary.validNpsResponses,
      coverage: ctx.summary.npsPortfolioCoverage,
      lowConfidence: true,
      caveat: "Baixa cobertura reduz generalização.",
    });
  }

  const renDiff = (ctx.renewedVsNotRenewed || []).find((d) => d.id === "stayDays" || /perman/i.test(d.label || ""));
  if (renDiff) {
    const a = renDiff.medianRenewed ?? renDiff.median1;
    const b = renDiff.medianNotRenewed ?? renDiff.median0;
    if (a != null && b != null && a > b) {
      push({
        id: "renewed_longer_stay",
        category: "Renovação",
        title: "Renovados com maior permanência",
        text: `Clientes renovados tiveram mediana de permanência de ${fmt(a, 0)} dias, acima dos não renovados (${fmt(b, 0)} dias).`,
        primaryValue: `${fmt(a, 0)} dias`,
        sample: renDiff.n ?? null,
        coverage: renDiff.coveragePercent,
        caveat: "Permanência e renovação se influenciam mutuamente — não é causalidade.",
      });
    }
  }

  const surv = ctx.survival?.overall;
  if (surv?.curve?.length) {
    const at = (day) => {
      let last = surv.curve[0];
      for (const pt of surv.curve) {
        if (Number(pt.time) > day) break;
        last = pt;
      }
      return last;
    };
    const p365 = at(365);
    if (p365?.survival != null) {
      push({
        id: "survival_12m",
        category: "Permanência",
        title: "Permanência estimada em 12 meses",
        text: `Após 12 meses, a probabilidade estimada de permanência é ${fmt(p365.survival * 100)}%.`,
        primaryValue: `${fmt(p365.survival * 100)}%`,
        sample: surv.nStart,
        technical: `Kaplan–Meier; eventos=${surv.events}; censurados=${surv.censored}`,
        caveat: "Estimativa com censura; não é garantia individual.",
      });
    }
  }

  const rules = ctx.riskRulesPreview || [];
  if (rules[0] && rules[0].lift > 1.2 && rules[0].clients >= 30) {
    push({
      id: "combo_risk",
      category: "Risco",
      title: "Combinação com taxa acima da média",
      text: `Clientes com “${rules[0].label}” tiveram taxa observada de cancelamento de ${fmt(rules[0].ratePct)}%, com lift ${fmt(rules[0].lift, 2)} vs a média do recorte.`,
      primaryValue: `${fmt(rules[0].ratePct)}%`,
      sample: rules[0].clients,
      caveat: "Padrão exploratório — não é previsão individual de cancelamento.",
      technical: `baseline implícita; lift=${rules[0].lift}`,
    });
  }

  const hp = (ctx.highPerformance?.groups || []).find((g) => /promotor e renovado/i.test(g.label || ""));
  if (hp && (hp.n || 0) >= 10) {
    push({
      id: "high_perf",
      category: "Alta performance",
      title: "Alta performance: promotores renovados",
      text: `${hp.n} clientes são promotores e renovados. Neste grupo, o cancelamento observado foi ${fmt(hp.cancelledPct)}%.`,
      primaryValue: String(hp.n),
      sample: hp.n,
      caveat: "Definição descritiva (Promotor ∩ Renovado), não Health Score oficial.",
    });
  }

  return list.slice(0, 10);
}

const RISK_SIGNAL_DEFS = [
  {
    id: "no_meeting",
    label: "Sem reunião registrada",
    test: (c) => Number(c.meetingCount || 0) === 0,
    evidenceKey: "hasMeeting",
  },
  {
    id: "long_since_meeting",
    label: "Mais de 60 dias sem reunião",
    test: (c) => num(c.daysSinceLastMeeting) != null && num(c.daysSinceLastMeeting) > 60,
    evidenceKey: "daysSinceLastMeeting",
  },
  {
    id: "nps_detractor",
    label: "NPS detrator",
    test: (c) => c.npsClass === "detractor",
    evidenceKey: "npsScore",
  },
  {
    id: "no_mechanism",
    label: "Sem mecanismo registrado",
    test: (c) => !c.hasMechanism,
    evidenceKey: "hasMechanism",
  },
  {
    id: "no_financial",
    label: "Sem diagnóstico financeiro",
    test: (c) => !c.hasFinancialData,
    evidenceKey: "hasFinancialData",
  },
  {
    id: "low_attendance",
    label: "Taxa de comparecimento abaixo de 50%",
    test: (c) => num(c.attendanceRate) != null && num(c.attendanceRate) < 0.5,
    evidenceKey: "attendanceRate",
  },
  {
    id: "high_noshow",
    label: "2 ou mais no-shows",
    test: (c) => num(c.noShowCount) != null && num(c.noShowCount) >= 2,
    evidenceKey: "noShowCount",
  },
];

export function buildActiveRiskSignals(clients, associations = []) {
  const pool = (clients || []).filter((c) => c.isActive && !c.isCancelled);
  const baseline = pool.length
    ? (clients.filter((c) => c.isCancelled).length / Math.max(clients.length, 1))
    : 0;
  const assocById = new Map(associations.map((a) => [a.id, a]));

  const signalStats = RISK_SIGNAL_DEFS.map((def) => {
    const matched = pool.filter(def.test);
    // taxa histórica no universo completo com o sinal (exploratório)
    const withSignal = (clients || []).filter(def.test);
    const cancelledWith = withSignal.filter((c) => c.isCancelled).length;
    const rate = withSignal.length ? cancelledWith / withSignal.length : null;
    const lift = rate != null && baseline > 0 ? rate / baseline : null;
    const assoc = assocById.get(def.evidenceKey);
    return {
      id: def.id,
      label: def.label,
      rule: def.label,
      activeClientsWithSignal: matched.length,
      sampleUniverse: withSignal.length,
      cancelledInUniverse: cancelledWith,
      observedRatePct: rate == null ? null : round3(rate * 100),
      baselinePct: round3(baseline * 100),
      lift: lift == null ? null : round4(lift),
      association: assoc?.association ?? null,
      coveragePercent: assoc?.coveragePercent ?? null,
      caveat: "Sinal exploratório em clientes ativos — não é previsão certa de cancelamento.",
    };
  }).filter((s) => s.activeClientsWithSignal > 0 && (s.lift == null || s.lift >= 1));

  const clientsOut = pool
    .map((c) => {
      const signals = RISK_SIGNAL_DEFS.filter((d) => d.test(c)).map((d) => d.label);
      if (!signals.length) return null;
      return {
        clientId: c.clientId,
        clientCode: c.clientCode,
        clientName: c.clientName,
        engineer: c.engineer,
        segment: c.segment,
        program: c.program || null,
        signals,
        signalCount: signals.length,
        intensity: signals.length >= 3 ? "alta" : signals.length === 2 ? "média" : "baixa",
        daysSinceLastMeeting: c.daysSinceLastMeeting,
        npsClass: c.npsClass,
        npsScore: c.npsScore,
        hasMechanism: c.hasMechanism,
        currentCycle: c.currentCycle,
        hasFinancialData: c.hasFinancialData,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.signalCount - a.signalCount || String(a.clientName).localeCompare(String(b.clientName), "pt-BR"))
    .slice(0, 50);

  return {
    title: "Clientes ativos com sinais detectados",
    note: "Clientes ainda ativos que apresentam padrões associados ao cancelamento nas análises. Não significa que vão cancelar.",
    baselinePct: round3(baseline * 100),
    signalStats,
    clients: clientsOut,
    summary: {
      activeWithSignals: clientsOut.length,
      engineersAffected: new Set(clientsOut.map((c) => c.engineer).filter(Boolean)).size,
      segmentsAffected: new Set(clientsOut.map((c) => c.segment).filter(Boolean)).size,
    },
  };
}

/** Índice exploratório transparente (0–100). */
export function computeExploratoryPerformanceScore(c) {
  const parts = [];
  const add = (id, label, weight, raw, max = 1) => {
    const v = num(raw);
    const norm = v == null ? null : Math.max(0, Math.min(1, v / max));
    parts.push({ id, label, weight, value: v, normalized: norm, points: norm == null ? 0 : round3(norm * weight) });
  };
  add("nps", "Satisfação (NPS)", 20, c.npsScore, 10);
  add("renewed", "Renovação", 15, c.hasRenewed ? 1 : 0, 1);
  add("meetings", "Reuniões (até 6)", 15, Math.min(num(c.meetingCount) ?? 0, 6), 6);
  add("mechanisms", "Mecanismos implementados (até 3)", 15, Math.min(num(c.implementedMechanismCount) ?? 0, 3), 3);
  add("financial", "Diagnóstico financeiro", 10, c.hasFinancialData ? 1 : 0, 1);
  add("attendance", "Taxa de comparecimento", 10, num(c.attendanceRate), 1);
  add("stay", "Permanência (até 365 dias)", 10, Math.min(num(c.stayDays) ?? 0, 365), 365);
  // perfil financeiro: renda com teto para não dominar
  const income = num(c.monthlyIncome);
  add("income", "Renda (normalizada até 50 mil)", 5, income == null ? null : Math.min(income, 50000), 50000);

  const score = round3(parts.reduce((a, p) => a + (p.points || 0), 0));
  const covered = parts.filter((p) => p.normalized != null).length;
  return {
    score,
    maxScore: 100,
    coverageCriteria: covered,
    criteriaTotal: parts.length,
    parts,
    positiveSignals: parts.filter((p) => (p.normalized || 0) >= 0.6).map((p) => p.label),
    alerts: parts.filter((p) => p.normalized == null).map((p) => `${p.label}: sem dado`),
  };
}

export function buildTopClientsByProgram(clients, { limit = 25 } = {}) {
  const active = (clients || []).filter((c) => c.isActive && !c.isCancelled);
  const rank = (subset, programLabel) => {
    const rows = subset
      .map((c) => {
        const idx = computeExploratoryPerformanceScore(c);
        return {
          clientId: c.clientId,
          clientCode: c.clientCode,
          clientName: c.clientName,
          program: c.program || programLabel,
          programBucket: programLabel,
          engineer: c.engineer,
          segment: c.segment,
          statusAnalytic: c.statusAnalytic || c.analyticalStatus,
          npsClass: c.npsClass,
          npsScore: c.npsScore,
          currentCycle: c.currentCycle,
          renewalCount: c.renewalCount,
          monthlyIncome: c.monthlyIncome,
          lastContribution: c.lastContribution,
          liquidityReserve: c.liquidityReserve,
          paidPropertiesValue: c.paidPropertiesValue,
          implementedMechanismCount: c.implementedMechanismCount,
          meetingCount: c.meetingCount,
          averageIntervalDays: c.averageIntervalDays,
          attendanceRate: c.attendanceRate,
          stayDays: c.stayDays,
          exploratoryScore: idx.score,
          positiveSignals: idx.positiveSignals,
          alerts: idx.alerts,
          scoreBreakdown: idx.parts,
        };
      })
      .sort((a, b) => b.exploratoryScore - a.exploratoryScore || (b.npsScore || 0) - (a.npsScore || 0))
      .slice(0, limit)
      .map((r, i) => ({ rank: i + 1, ...r }));
    return rows;
  };

  const pharus = active.filter(isPharus);
  const davos = active.filter(isDavos);

  return {
    methodology: {
      name: "Índice exploratório de alta performance",
      note: "Não é Health Score oficial. Equilibra satisfação, renovação, engajamento, mecanismos, atualização, permanência e perfil financeiro (renda com teto para não dominar).",
      weights: [
        { criterion: "NPS", weight: 20 },
        { criterion: "Renovação", weight: 15 },
        { criterion: "Reuniões", weight: 15 },
        { criterion: "Mecanismos implementados", weight: 15 },
        { criterion: "Diagnóstico financeiro", weight: 10 },
        { criterion: "Taxa de comparecimento", weight: 10 },
        { criterion: "Permanência", weight: 10 },
        { criterion: "Renda (teto 50 mil)", weight: 5 },
      ],
      programRule: "Davos: clients.davos_contrato_assinado ou programa contendo 'Davos'. Demais ativos elegíveis entram em Pharus/QV.",
    },
    pharus: { label: "Top clientes — Pharus", nUniverse: pharus.length, rows: rank(pharus, "Pharus") },
    davos: { label: "Top clientes — Davos", nUniverse: davos.length, rows: rank(davos, "Davos") },
  };
}

export function buildNpsComparativeMatrix(clients) {
  const groups = [
    { id: "promoter", label: "Promotores", test: (c) => c.npsClass === "promoter" },
    { id: "passive", label: "Neutros", test: (c) => c.npsClass === "passive" },
    { id: "detractor", label: "Detratores", test: (c) => c.npsClass === "detractor" },
  ];
  const variables = [
    { id: "monthlyIncome", label: "Renda mensal", kind: "median" },
    { id: "lastContribution", label: "Aporte", kind: "median" },
    { id: "liquidityReserve", label: "Reserva", kind: "median" },
    { id: "paidPropertiesValue", label: "Patrimônio", kind: "median" },
    { id: "implementedMechanismCount", label: "Mecanismos implementados", kind: "median" },
    { id: "meetingCount", label: "Reuniões", kind: "median" },
    { id: "averageIntervalDays", label: "Intervalo médio", kind: "median" },
    { id: "daysSinceLastMeeting", label: "Dias desde última reunião", kind: "median" },
    { id: "attendanceRate", label: "Taxa de comparecimento", kind: "median" },
    { id: "noShowCount", label: "No-shows", kind: "median" },
    { id: "rescheduleCount", label: "Remarcações", kind: "median" },
    { id: "stayDays", label: "Permanência", kind: "median" },
    { id: "currentCycle", label: "Ciclo atual", kind: "median" },
    { id: "renewalCount", label: "Quantidade de renovações", kind: "median" },
    { id: "isCancelled", label: "Cancelamento", kind: "pct" },
    { id: "hasRenewed", label: "Renovação", kind: "pct" },
    { id: "hasFinancialData", label: "% com financeiro", kind: "pct" },
    { id: "hasMeeting", label: "% com reunião", kind: "pct" },
  ];

  const eligible = clients || [];
  const eligibleN = eligible.length;
  // NPS válido descritivo da matriz: resposta mais recente já consolidada no cliente + classe.
  // Alinha à cobertura preditiva da seção principal quando npsPredictiveOk estiver disponível.
  const withNps = eligible.filter((c) => c.hasNps && c.npsClass && (c.npsPredictiveOk !== false));
  const withNpsN = withNps.length;
  const npsCoverageGeneral = coveragePct(withNpsN, eligibleN);

  const groupData = groups.map((g) => {
    const rows = withNps.filter(g.test);
    return { ...g, n: rows.length, rows };
  });

  const classCoverage = Object.fromEntries(
    groupData.map((g) => [g.id, {
      n: g.n,
      pctOfNps: coveragePct(g.n, withNpsN),
      pctOfEligible: coveragePct(g.n, eligibleN),
    }])
  );

  const globalMed = {};
  const globalSd = {};
  const globalValidN = {};
  for (const v of variables) {
    if (v.kind === "median") {
      const allVals = withNps.map((c) => num(c[v.id])).filter((x) => x != null);
      globalMed[v.id] = median(allVals);
      globalSd[v.id] = sampleSd(allVals);
      globalValidN[v.id] = allVals.length;
    } else {
      const valid = withNps.filter((c) => c[v.id] != null && c[v.id] !== "");
      globalMed[v.id] = valid.length
        ? (valid.filter((c) => !!c[v.id] && c[v.id] !== 0).length / valid.length) * 100
        : null;
      globalSd[v.id] = null;
      globalValidN[v.id] = valid.length;
    }
  }

  const cells = [];
  for (let i = 0; i < variables.length; i += 1) {
    const v = variables[i];
    for (let j = 0; j < groupData.length; j += 1) {
      const g = groupData[j];
      let value = null;
      let indicatorCoverageInClass = null;
      let nValidInClass = null;
      if (g.n >= 5) {
        if (v.kind === "median") {
          const vals = g.rows.map((c) => num(c[v.id])).filter((x) => x != null);
          value = vals.length ? median(vals) : null;
          nValidInClass = vals.length;
          indicatorCoverageInClass = coveragePct(vals.length, g.n);
        } else {
          const vals = g.rows.filter((c) => c[v.id] != null && c[v.id] !== "");
          const pos = vals.filter((c) => !!c[v.id] && c[v.id] !== 0).length;
          value = vals.length ? round3((pos / vals.length) * 100) : null;
          nValidInClass = vals.length;
          indicatorCoverageInClass = coveragePct(vals.length, g.n);
        }
      }
      const gref = globalMed[v.id];
      let standardized = null;
      let difference = null;
      let pctDiff = null;
      if (value != null && gref != null) {
        difference = round4(value - gref);
        if (Math.abs(gref) > 1e-9) pctDiff = round3((difference / Math.abs(gref)) * 100);
        if (v.kind === "median" && globalSd[v.id] != null && globalSd[v.id] > 1e-12) {
          standardized = standardizedDifference(value, gref, globalSd[v.id]);
        } else if (Math.abs(gref) > 1e-9) {
          standardized = round4((value - gref) / Math.abs(gref));
        } else {
          standardized = round4(value - gref);
        }
      }
      const dir = standardized == null ? "sem dado"
        : Math.abs(standardized) < 0.15 ? "semelhante à referência"
        : standardized > 0 ? "acima da referência" : "abaixo da referência";
      cells.push({
        i, j,
        varId: v.id,
        groupId: g.id,
        labelRow: v.label,
        labelCol: g.label,
        value,
        reference: gref,
        difference,
        pctDiff,
        standardized,
        coveragePercent: indicatorCoverageInClass,
        indicatorCoverageInClass,
        n: g.n,
        nValid: nValidInClass,
        npsValidWithIndicator: globalValidN[v.id] ?? null,
        npsCoverageGeneral,
        observation: dir,
      });
    }
  }

  const categorical = groups.map((g) => {
    const rows = withNps.filter(g.test);
    const topEng = modeLabel(rows.map((c) => c.engineer));
    const topSeg = modeLabel(rows.map((c) => c.segment));
    return { group: g.label, n: rows.length, topEngineer: topEng, topSegment: topSeg };
  });

  return {
    title: "Matriz comparativa NPS (Promotores / Neutros / Detratores)",
    mode: "standardized_vs_nps_population",
    note: "Cada cor compara a classe NPS com a referência geral dos clientes com NPS válido no recorte. Azul = abaixo; cinza = semelhante; laranja/vermelho = acima.",
    referenceNote: "Referência = clientes com resposta NPS válida (mais recente, nota 0–10) após os filtros aplicados — não a população total do portal.",
    referenceN: withNpsN,
    eligiblePopulation: eligibleN,
    clientsWithValidNps: withNpsN,
    npsCoverageGeneral,
    classCoverage,
    coverageWarning: (npsCoverageGeneral == null || npsCoverageGeneral < 40)
      ? "Cobertura baixa: os resultados representam somente a parcela de clientes que respondeu ao NPS."
      : null,
    variables,
    groups: groupData.map((g) => ({ id: g.id, label: g.label, n: g.n })),
    cells,
    categoricalHighlights: categorical,
  };
}

function modeLabel(arr) {
  const counts = new Map();
  for (const v of arr) {
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best = null;
  let n = 0;
  for (const [k, c] of counts) {
    if (c > n) { best = k; n = c; }
  }
  return best ? { label: best, n } : null;
}

export function buildHighPerformanceProfile(clients) {
  const pool = clients || [];
  const both = pool.filter((c) => c.npsClass === "promoter" && c.hasRenewed);
  const promoters = pool.filter((c) => c.npsClass === "promoter");
  const renewed = pool.filter((c) => c.hasRenewed);

  function profile(rows, label) {
    if (!rows.length) return { label, n: 0, status: "insufficient_sample" };
    const med = (field) => median(rows.map((c) => num(c[field])).filter((x) => x != null));
    return {
      label,
      n: rows.length,
      cancelledPct: round3((rows.filter((c) => c.isCancelled).length / rows.length) * 100),
      renewedPct: round3((rows.filter((c) => c.hasRenewed).length / rows.length) * 100),
      medianIncome: med("monthlyIncome"),
      medianContribution: med("lastContribution"),
      medianMechanismsImplemented: med("implementedMechanismCount"),
      medianMeetings: med("meetingCount"),
      medianInterval: med("averageIntervalDays"),
      medianRenewals: med("renewalCount"),
      medianCycle: med("currentCycle"),
      medianReserve: med("liquidityReserve"),
      medianPatrimony: med("paidPropertiesValue"),
      medianStay: med("stayDays"),
      medianDaysSinceMeeting: med("daysSinceLastMeeting"),
      medianAttendance: med("attendanceRate"),
      hasFinancialPct: round3((rows.filter((c) => c.hasFinancialData).length / rows.length) * 100),
      topEngineer: modeLabel(rows.map((c) => c.engineer)),
      topSegment: modeLabel(rows.map((c) => c.segment)),
    };
  }

  return {
    definition: "Alta performance principal = Promotor E Renovado. Também exibimos somente Promotor e somente Renovado.",
    note: "Perfil descritivo. Importância preditiva guia priorização de variáveis, sem afirmar causalidade.",
    groups: [
      profile(promoters, "Somente Promotor"),
      profile(renewed, "Somente Renovado"),
      profile(both, "Promotor e Renovado (alta performance)"),
    ],
  };
}

export function buildClientInsightsBundle(ctx) {
  const associations = ctx.associations || [];
  const highPerformance = buildHighPerformanceProfile(ctx.clients);
  const riskRulesPreview = ctx.riskRulesPreview || [];
  const simpleInsights = buildSimpleInsights({ ...ctx, highPerformance, riskRulesPreview });
  const activeRiskSignals = buildActiveRiskSignals(ctx.clients, associations);
  const topClients = buildTopClientsByProgram(ctx.clients);
  const npsComparative = buildNpsComparativeMatrix(ctx.clients);
  return {
    simpleInsights,
    activeRiskSignals,
    topClients,
    npsComparative,
    highPerformance,
    challengeCohort: {
      available: false,
      reason: "Não foi localizada uma fonte confiável com data de início e resultado dos desafios (tabelas/colunas de desafio) na BASE QV acessível por este endpoint.",
    },
  };
}
