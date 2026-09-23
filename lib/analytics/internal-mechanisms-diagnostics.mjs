/**
 * Diagnósticos de cobertura — seções CSAT, renovação e temporalidade (IMS).
 */
export function buildImsSectionDiagnostics(npsPopulation, catalog, longRows, csatComVsSem, renewalComVsSem, temporalSummary) {
  const withCsat = npsPopulation.filter((c) => c.latestCsat != null && Number(c.latestCsat) >= 1);
  const csatWithMech = withCsat.filter((c) => (c.totalImplementedMechanisms || 0) > 0);
  const csatWithoutMech = withCsat.filter((c) => !(c.totalImplementedMechanisms || 0));
  const mechNamesAmongCsat = new Set();
  for (const c of csatWithMech) {
    for (const n of c.implementedMechanismNames || []) mechNamesAmongCsat.add(n);
  }

  const eligibleRenewal = npsPopulation.filter((c) => c.cycleValid);
  const eligibleWithMech = eligibleRenewal.filter((c) => (c.totalImplementedMechanisms || 0) > 0);
  const renewedEligible = eligibleRenewal.filter((c) => c.renewed);

  const withMech = npsPopulation.filter((c) => (c.totalImplementedMechanisms || 0) > 0);
  const withNpsDate = npsPopulation.filter((c) => c.latestNpsDate);
  const withMechAndNpsDate = withMech.filter((c) => c.latestNpsDate);

  let implDatesInLong = 0;
  for (const r of longRows || []) {
    if (r.mechanismImplemented && r.mechanismImplementationDate) implDatesInLong += 1;
  }

  const csatHasData = withCsat.length > 0;
  const renewalHasData = eligibleRenewal.length > 0;
  const temporalHasData = (temporalSummary?.implementedBeforeNps || 0) + (temporalSummary?.implementedAfterNps || 0) > 0;

  return {
    csat: {
      hasData: csatHasData,
      uniqueClientsWithCsat: withCsat.length,
      withMechanism: csatWithMech.length,
      withoutMechanism: csatWithoutMech.length,
      withCsatAndMechanism: csatWithMech.length,
      distinctMechanismsAmongCsatClients: mechNamesAmongCsat.size,
      summary: csatHasData
        ? `${withCsat.length} clientes com CSAT válido no universo NPS (${csatWithMech.length} com mecanismo · ${csatWithoutMech.length} sem · ${mechNamesAmongCsat.size} mecanismos distintos entre quem tem CSAT e mecanismo).`
        : null,
      emptyReason: csatHasData
        ? null
        : "Nenhum cliente com NPS válido no recorte possui resposta CSAT (escala 1–5) após dedupe. A análise CSAT depende de formulários CSAT na BASE QV.",
    },
    renewal: {
      hasData: renewalHasData,
      clientsWithRenewalInfo: eligibleRenewal.length,
      withMechanism: eligibleWithMech.length,
      renewedAmongEligible: renewedEligible.length,
      summary: renewalHasData
        ? `${eligibleRenewal.length} clientes com ciclo elegível para renovação (${renewedEligible.length} renovaram · ${eligibleWithMech.length} com mecanismo).`
        : null,
      emptyReason: renewalHasData
        ? null
        : "Nenhum cliente no universo NPS possui ciclo válido para calcular renovação (regra de ciclo da BASE QV).",
    },
    temporal: {
      hasData: temporalHasData || withMech.length > 0,
      clientsWithMechanismAndNps: withMech.length,
      clientsWithNpsDate: withNpsDate.length,
      clientsWithMechAndNpsDate: withMechAndNpsDate.length,
      mechanismLinksWithImplementationDate: implDatesInLong,
      beforeNps: temporalSummary?.implementedBeforeNps ?? 0,
      afterNps: temporalSummary?.implementedAfterNps ?? 0,
      insufficientDates: temporalSummary?.insufficientDates ?? 0,
      summary: temporalSummary?.message || null,
      emptyReason:
        withMech.length === 0
          ? "Nenhum cliente com NPS e mecanismo implementado no recorte — temporalidade não se aplica."
          : temporalSummary?.insufficientDates === withMech.length && !temporalHasData
            ? "Há clientes com mecanismo, mas falta data de implementação (`implemented_at`) ou data da resposta NPS para comparar ordem temporal."
            : null,
    },
    catalogMechanismCount: (catalog || []).length,
  };
}
