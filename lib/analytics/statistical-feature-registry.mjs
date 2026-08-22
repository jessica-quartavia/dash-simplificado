/**
 * Registry de features derivadas — Análises Estatísticas.
 * Fonte: buildAnalyticalPopulation() + joinLatestNpsOntoClients().
 * Não inclui raw payloads de BASE QV.
 */

/** @typedef {'text'|'number'|'boolean'|'iso_date'} StatFeatureType */

/**
 * @type {Array<{
 *   featureId: string,
 *   clientField: string,
 *   column: string,
 *   type: StatFeatureType,
 *   nullable: boolean,
 *   source: string,
 *   usedBy: string[],
 *   pii?: boolean,
 * }>}
 */
export const STATISTICAL_FEATURE_REGISTRY = [
  { featureId: "clientId", clientField: "clientId", column: "client_id", type: "text", nullable: false, source: "clients.id", usedBy: ["identity", "filters", "cohort", "survival", "ranking"], pii: false },
  { featureId: "clientCode", clientField: "clientCode", column: "client_code", type: "text", nullable: true, source: "clients.codigo", usedBy: ["filters.search"], pii: false },
  { featureId: "clientName", clientField: "clientName", column: "client_name", type: "text", nullable: true, source: "clients.nome", usedBy: ["filters.search"], pii: true },
  { featureId: "analyticalStatus", clientField: "analyticalStatus", column: "analytical_status", type: "text", nullable: false, source: "analytical-cancellation", usedBy: ["filters.status", "cancellation", "cohort"], pii: false },
  { featureId: "program", clientField: "program", column: "program", type: "text", nullable: true, source: "clients.programa", usedBy: ["filters.program", "matrix", "ranking"], pii: false },
  { featureId: "engineer", clientField: "engineer", column: "engineer", type: "text", nullable: true, source: "clients.engenheiro_patrimonial", usedBy: ["filters.engineer", "cancellation", "survival", "matrix"], pii: false },
  { featureId: "segment", clientField: "segment", column: "segment", type: "text", nullable: true, source: "general-data.segment", usedBy: ["filters.segment", "cancellation", "survival", "matrix"], pii: false },
  { featureId: "hireDate", clientField: "hireDate", column: "hire_date", type: "iso_date", nullable: true, source: "clients.data_inicio_ciclo", usedBy: ["filters.period", "cohort", "survival", "tenure"], pii: false },
  { featureId: "cancellationDate", clientField: "cancellationDate", column: "cancellation_date", type: "iso_date", nullable: true, source: "cancellations", usedBy: ["filters.period", "survival", "cancellation"], pii: false },
  { featureId: "isActive", clientField: "isActive", column: "is_active", type: "boolean", nullable: false, source: "analytical status", usedBy: ["filters.status", "cancellation"], pii: false },
  { featureId: "isCancelled", clientField: "isCancelled", column: "is_cancelled", type: "boolean", nullable: false, source: "analytical status", usedBy: ["filters.status", "cancellation", "survival"], pii: false },
  { featureId: "isFrozen", clientField: "isFrozen", column: "is_frozen", type: "boolean", nullable: false, source: "analytical status", usedBy: ["filters.status"], pii: false },
  { featureId: "stayDays", clientField: "stayDays", column: "stay_days", type: "number", nullable: true, source: "client-tenure", usedBy: ["cancellation", "renewal", "matrix", "cohort", "survival", "ranking"], pii: false },
  { featureId: "stayBand", clientField: "stayBand", column: "stay_band", type: "text", nullable: true, source: "derived tenure", usedBy: ["filters.stayBand", "matrix"], pii: false },
  { featureId: "meetingCount", clientField: "meetingCount", column: "total_meetings", type: "number", nullable: true, source: "meetings.totalMeetings", usedBy: ["cancellation", "renewal", "matrix", "ranking"], pii: false },
  { featureId: "meetingsPerMonth", clientField: "meetingsPerMonth", column: "meetings_per_month", type: "number", nullable: true, source: "derived meetings/stay", usedBy: ["cancellation", "renewal", "matrix"], pii: false },
  { featureId: "noShowCount", clientField: "noShowCount", column: "no_shows", type: "number", nullable: true, source: "meetings.absences", usedBy: ["cancellation", "renewal", "matrix"], pii: false },
  { featureId: "rescheduleCount", clientField: "rescheduleCount", column: "reschedules", type: "number", nullable: true, source: "meetings", usedBy: ["cancellation", "matrix"], pii: false },
  { featureId: "attendanceRate", clientField: "attendanceRate", column: "attendance_rate", type: "number", nullable: true, source: "meetings proxy", usedBy: ["cancellation", "matrix"], pii: false },
  { featureId: "daysSinceLastMeeting", clientField: "daysSinceLastMeeting", column: "days_since_last_meeting", type: "number", nullable: true, source: "meetings", usedBy: ["cancellation", "matrix"], pii: false },
  { featureId: "averageIntervalDays", clientField: "averageIntervalDays", column: "average_meeting_interval", type: "number", nullable: true, source: "meetings", usedBy: ["cancellation", "matrix"], pii: false },
  { featureId: "daysToFirstMeeting", clientField: "daysToFirstMeeting", column: "days_to_first_meeting", type: "number", nullable: true, source: "meetings", usedBy: ["cancellation", "matrix", "ranking"], pii: false },
  { featureId: "hasMeeting", clientField: "hasMeeting", column: "has_meeting", type: "boolean", nullable: false, source: "meetings", usedBy: ["cancellation", "survival", "filters"], pii: false },
  { featureId: "firstMeetingCompleted", clientField: "firstMeetingCompleted", column: "first_meeting_completed", type: "boolean", nullable: false, source: "meetings", usedBy: ["onboarding"], pii: false },
  { featureId: "mechanismCount", clientField: "mechanismCount", column: "mechanism_count", type: "number", nullable: true, source: "mechanisms", usedBy: ["cancellation", "renewal", "matrix"], pii: false },
  { featureId: "implementedMechanismCount", clientField: "implementedMechanismCount", column: "implemented_mechanism_count", type: "number", nullable: true, source: "mechanisms", usedBy: ["cancellation", "matrix"], pii: false },
  { featureId: "implementationPercent", clientField: "implementationPercent", column: "implementation_percent", type: "number", nullable: true, source: "mechanisms", usedBy: ["cancellation", "matrix"], pii: false },
  { featureId: "implementationRate", clientField: "implementationRate", column: "implementation_rate", type: "number", nullable: true, source: "mechanisms", usedBy: ["matrix"], pii: false },
  { featureId: "hasMechanism", clientField: "hasMechanism", column: "has_mechanism", type: "boolean", nullable: false, source: "mechanisms", usedBy: ["cancellation", "survival", "filters"], pii: false },
  { featureId: "hasFirstImplementation", clientField: "hasFirstImplementation", column: "has_implemented_mechanism", type: "boolean", nullable: false, source: "mechanisms", usedBy: ["cancellation"], pii: false },
  { featureId: "monthlyIncome", clientField: "monthlyIncome", column: "monthly_income", type: "number", nullable: true, source: "client_financial_data", usedBy: ["cancellation", "renewal", "matrix"], pii: false },
  { featureId: "liquidityReserve", clientField: "liquidityReserve", column: "liquidity_reserve", type: "number", nullable: true, source: "client_financial_data", usedBy: ["cancellation", "renewal", "matrix"], pii: false },
  { featureId: "lastContribution", clientField: "lastContribution", column: "last_contribution", type: "number", nullable: true, source: "client_financial_data", usedBy: ["cancellation", "matrix"], pii: false },
  { featureId: "paidPropertiesValue", clientField: "paidPropertiesValue", column: "patrimony", type: "number", nullable: true, source: "client_financial_data", usedBy: ["cancellation", "matrix"], pii: false },
  { featureId: "hasFinancialData", clientField: "hasFinancialData", column: "has_financial_data", type: "boolean", nullable: false, source: "general-data", usedBy: ["cancellation", "survival", "filters"], pii: false },
  { featureId: "incomeBand", clientField: "incomeBand", column: "income_band", type: "text", nullable: true, source: "derived income", usedBy: ["cancellation", "filters"], pii: false },
  { featureId: "liquidityBand", clientField: "liquidityBand", column: "liquidity_band", type: "text", nullable: true, source: "derived liquidity", usedBy: ["cancellation", "filters"], pii: false },
  { featureId: "financialUpdateCount", clientField: "financialUpdateCount", column: "financial_update_count", type: "number", nullable: true, source: "general-data", usedBy: ["cancellation"], pii: false },
  { featureId: "daysSinceFinancialUpdate", clientField: "daysSinceFinancialUpdate", column: "days_since_financial_update", type: "number", nullable: true, source: "general-data", usedBy: ["cancellation", "matrix"], pii: false },
  { featureId: "currentCycle", clientField: "currentCycle", column: "current_cycle", type: "number", nullable: true, source: "clients.ciclo", usedBy: ["renewal", "filters", "matrix"], pii: false },
  { featureId: "renewalCount", clientField: "renewalCount", column: "renewal_count", type: "number", nullable: true, source: "clients.ciclo", usedBy: ["renewal", "matrix"], pii: false },
  { featureId: "hasRenewed", clientField: "hasRenewed", column: "has_renewed", type: "boolean", nullable: false, source: "clients.ciclo", usedBy: ["renewal", "survival", "filters"], pii: false },
  { featureId: "renewedValid", clientField: "renewedValid", column: "renewed_valid", type: "boolean", nullable: false, source: "clients.ciclo", usedBy: ["renewal"], pii: false },
  { featureId: "npsScore", clientField: "npsScore", column: "latest_nps", type: "number", nullable: true, source: "nps_responses", usedBy: ["cancellation", "renewal", "matrix", "ranking"], pii: false },
  { featureId: "npsClass", clientField: "npsClass", column: "nps_class", type: "text", nullable: true, source: "nps_responses", usedBy: ["cancellation", "survival", "filters"], pii: false },
  { featureId: "hasNps", clientField: "hasNps", column: "has_nps", type: "boolean", nullable: false, source: "nps_responses", usedBy: ["filters", "nps"], pii: false },
  { featureId: "npsPredictiveOk", clientField: "npsPredictiveOk", column: "nps_predictive_ok", type: "boolean", nullable: false, source: "nps join rule", usedBy: ["cancellation", "renewal", "nps"], pii: false },
  { featureId: "survivalTime", clientField: "survivalTime", column: "survival_duration_days", type: "number", nullable: true, source: "survival derive", usedBy: ["survival", "cohort"], pii: false },
  { featureId: "survivalEvent", clientField: "survivalEvent", column: "survival_event", type: "number", nullable: true, source: "survival derive", usedBy: ["survival", "cohort"], pii: false },
  { featureId: "survivalValid", clientField: "survivalValid", column: "survival_valid", type: "boolean", nullable: false, source: "survival derive", usedBy: ["survival", "cohort"], pii: false },
];

export const STATISTICAL_SNAPSHOT_CLIENT_FIELDS = STATISTICAL_FEATURE_REGISTRY.map((r) => r.clientField);

export const STATISTICAL_SNAPSHOT_PII_FIELDS = STATISTICAL_FEATURE_REGISTRY
  .filter((r) => r.pii)
  .map((r) => r.featureId);

export function pickStatisticalClientFeatures(client) {
  const out = {};
  for (const field of STATISTICAL_SNAPSHOT_CLIENT_FIELDS) {
    out[field] = client?.[field] ?? null;
  }
  return out;
}

export function restoreStatisticalClientRecord(features) {
  if (!features || typeof features !== "object") return null;
  return { ...features };
}
