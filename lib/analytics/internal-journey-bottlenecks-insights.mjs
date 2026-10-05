/**
 * Insights automáticos — Gargalos da Jornada (somente com suporte nos dados).
 */
function pct(part, total) {
  if (!total) return null;
  return Math.round((part / total) * 1000) / 10;
}

export function buildJourneyBottleneckInsights(ctx) {
  const insights = [];
  const push = (text, meta = {}) => {
    if (text) insights.push({ text, ...meta });
  };

  const n = ctx.population || 0;
  if (!n) return insights;

  const { summary, funnel, velocity, meetings, quality, cancellationCompare, rankings, epTable } = ctx;

  if (funnel?.mainBottleneck?.label) {
    push(
      `Maior perda relativa no funil: ${funnel.mainBottleneck.label} (${funnel.mainBottleneck.dropOffPct ?? "—"}% de drop-off entre etapas consecutivas).`,
      { kind: "funnel", n },
    );
  }

  if (velocity?.slowestStep?.label && velocity.slowestStep.medianDays != null) {
    push(
      `Etapa mais lenta (mediana): ${velocity.slowestStep.label} — ${velocity.slowestStep.medianDays} dias.`,
      { kind: "velocity", n },
    );
  }

  const noMeet = summary?.withoutAnyMeeting ?? 0;
  const openOb = summary?.openOnboarding ?? 0;
  if (noMeet > 0 && openOb > 0) {
    const both = ctx.overlapNoMeetingAndOpenOnboarding ?? 0;
    const share = pct(both, openOb);
    if (share != null && share >= 15) {
      push(
        `Concentração observada: ${share}% dos onboardings incompletos também não têm primeira reunião registrada (N=${both} de ${openOb}).`,
        { kind: "association", n: both },
      );
    }
  }

  if (meetings?.firstMeeting?.pctOver30 != null && meetings.firstMeeting.pctOver30 >= 20) {
    push(
      `${meetings.firstMeeting.pctOver30}% dos clientes levaram mais de 30 dias até a primeira reunião (padrão de atenção).`,
      { kind: "first_meeting", n },
    );
  }

  const seg = (epTable || []).find((r) => !r.smallSample && r.medianOnboardingDays != null && r.medianFirstMeetingDays != null);
  const segWorst = [...(epTable || [])]
    .filter((r) => !r.smallSample && r.medianFirstMeetingDays != null)
    .sort((a, b) => (b.medianFirstMeetingDays ?? 0) - (a.medianFirstMeetingDays ?? 0))[0];
  if (segWorst && segWorst.clients >= 30) {
    push(
      `EP ${segWorst.ep} apresenta mediana de ${segWorst.medianFirstMeetingDays} dias até a 1ª reunião (N=${segWorst.clients}).`,
      { kind: "ep", n: segWorst.clients },
    );
  }

  if (cancellationCompare?.rows?.length) {
    const diff = cancellationCompare.rows.find((r) => r.metric === "onboardingCompletedPct");
    if (diff?.active != null && diff?.cancelled != null && Math.abs(diff.active - diff.cancelled) >= 8) {
      push(
        `Associação com cancelamento: ${diff.cancelled}% dos cancelados efetivos concluíram onboarding vs ${diff.active}% nos ativos filtrados.`,
        { kind: "cancellation", n: cancellationCompare.cancelledN },
      );
    }
  }

  if (quality?.topGap?.label && quality.topGap.pct != null) {
    push(
      `Qualidade dos dados: ${quality.topGap.pct}% dos clientes filtrados sem ${quality.topGap.label}.`,
      { kind: "quality", n },
    );
  }

  if (rankings?.[0]?.label) {
    push(
      `Maior volume afetado: ${rankings[0].label} — ${rankings[0].clients} clientes (${rankings[0].sharePct ?? "—"}% da base).`,
      { kind: "ranking", n: rankings[0].clients },
    );
  }

  if (meetings?.recency?.pct60Plus != null && meetings.recency.pct60Plus >= 10) {
    push(
      `${meetings.recency.pct60Plus}% dos clientes estão há 60+ dias sem reunião (sinal de cadência baixa).`,
      { kind: "recency", n },
    );
  }

  return insights.slice(0, 12);
}

export function buildJourneyRecommendations(ctx) {
  const recs = [];
  const add = (text) => {
    if (text) recs.push(text);
  };

  if (ctx.summary?.withoutAnyMeetingPct >= 15) {
    add(
      `Há concentração de clientes sem nenhuma reunião (${ctx.summary.withoutAnyMeetingPct}% da base filtrada) — vale revisar cadência e agendamento inicial.`,
    );
  }

  if (ctx.funnel?.mainBottleneck?.label?.toLowerCase().includes("reunião")) {
    add(
      `O funil indica perda relevante antes/da primeira reunião — os dados sugerem testar ações operacionais focadas nesse marco.`,
    );
  }

  return recs.slice(0, 5);
}
