/**
 * Pré-carga única de fontes BASE QV compartilhadas pelo Resumo Executivo (Fase 1b).
 * Todas as leituras passam pelo AnalyticsDataContext — uma Promise por tabela.
 */
import { getAnalyticsDataContext } from "./analytics-data-context.mjs";
import { excludedClientIds, filterExcludedClients } from "./data-exclusions.mjs";
import { loadAirtableFirstMeetingIndex } from "./first-meeting-fallback.mjs";

function keepClientRow(removedIds) {
  return (row) => !removedIds.has(String(row?.client_id || ""));
}

export async function preloadExecutiveSharedBundle(ctx = getAnalyticsDataContext()) {
  if (!ctx) {
    throw new Error("preloadExecutiveSharedBundle requer AnalyticsDataContext ativo");
  }

  const started = Date.now();
  const [
    clientsRaw,
    cancellationsRaw,
    financialRaw,
    calendlyRaw,
    manualRaw,
    attendanceRaw,
    mechanismsRaw,
    catalogRaw,
    journeysRaw,
    implRaw,
    npsRaw,
    csatRaw,
    npsSendsRaw,
    statusRaw,
    airtableIndex,
  ] = await Promise.all([
    ctx.getClients(),
    ctx.getCancellations(),
    ctx.getFinancial(),
    ctx.getCalendlyMeetings(),
    ctx.getManualMeetings(),
    ctx.getMeetingAttendance(),
    ctx.getClientMechanisms(),
    ctx.getMechanismsCatalog(),
    ctx.getClientJourneys(),
    ctx.getClientImplementationMeetings(),
    ctx.getNpsResponses(),
    ctx.getCsatResponses(),
    ctx.getNpsSends(),
    ctx.getCancellationStatuses(),
    loadAirtableFirstMeetingIndex().catch(() => ({
      available: false,
      reason: "Falha ao carregar índice Airtable.",
      clientsByKey: null,
      meetingsByBackupId: null,
      statusValues: [],
      warnings: [],
      meta: null,
    })),
  ]);

  const removedIds = excludedClientIds(clientsRaw);
  const clients = filterExcludedClients(clientsRaw);
  const keepClient = keepClientRow(removedIds);

  return {
    preloadMs: Date.now() - started,
    clients,
    clientsRaw,
    removedIds,
    cancellations: (cancellationsRaw || []).filter(keepClient),
    financialRows: (financialRaw || []).filter(keepClient),
    calendlyRows: (calendlyRaw || []).filter(keepClient),
    manualRows: (manualRaw || []).filter(keepClient),
    attendanceRows: attendanceRaw || [],
    mechanismsRaw: (mechanismsRaw || []).filter(keepClient),
    catalog: catalogRaw || [],
    journeys: (journeysRaw || []).filter(keepClient),
    implRows: (implRaw || []).filter(keepClient),
    npsRows: (npsRaw || []).filter((row) => !removedIds.has(String(row.client_id || ""))),
    csatRows: (csatRaw || []).filter((row) => !removedIds.has(String(row.client_id || ""))),
    npsSends: (npsSendsRaw || []).filter((row) => !removedIds.has(String(row.client_id || ""))),
    statusRows: statusRaw || [],
    airtableIndex,
  };
}
