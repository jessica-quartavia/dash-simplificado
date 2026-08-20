/**
 * Métricas de Jornada e Onboarding (V2).
 * Medianas e coorte comparável seguem a V1. Sem HTTP.
 */
import { distributionFrom } from "./meeting-metrics.mjs";

export const DAY_RANGE_LABELS = [
  "0-7 dias",
  "8-15 dias",
  "16-30 dias",
  "31-60 dias",
  "61-90 dias",
  "Mais de 90 dias",
  "Sem base",
];

export const ONBOARDING_APPROVED_CHARTS = ["completion", "totalOnboarding"];
export const ONBOARDING_SUPPORT_CHARTS = ["firstMeeting", "planDelivery"];
export const ONBOARDING_HIDDEN_CHARTS = ["firstImplementation"];
export const ONBOARDING_VISIBLE_CHARTS = [...ONBOARDING_APPROVED_CHARTS, ...ONBOARDING_SUPPORT_CHARTS];

export function dayRange(value) {
  if (value == null || !Number.isFinite(value)) return "Sem base";
  if (value <= 7) return "0-7 dias";
  if (value <= 15) return "8-15 dias";
  if (value <= 30) return "16-30 dias";
  if (value <= 60) return "31-60 dias";
  if (value <= 90) return "61-90 dias";
  return "Mais de 90 dias";
}

export function median(nums) {
  const clean = (nums || [])
    .filter((num) => num != null && Number.isFinite(num) && num >= 0)
    .sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : Math.round(((clean[mid - 1] + clean[mid]) / 2) * 100) / 100;
}

export function coverageOf(sampleCount, populationCount) {
  const total = Number(populationCount) || 0;
  const sample = Number(sampleCount) || 0;
  if (total <= 0) return { sample, total: 0, percent: 0 };
  return {
    sample,
    total,
    percent: Math.round((sample / total) * 1000) / 10,
  };
}

export function isComparableOnboardingRow(row) {
  if (!row) return false;
  const total = row.totalOnboardingDays;
  const meeting = row.daysToFirstMeeting;
  const plan = row.daysToPlanDelivery;
  if (total == null || meeting == null || plan == null) return false;
  if (total < 0 || meeting < 0 || plan < 0) return false;
  return total <= meeting && total <= plan && meeting <= plan;
}

export function summarizeOnboardingRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length;
  const comparable = list.filter(isComparableOnboardingRow);
  const complete = list.filter((row) => row.completedOnboarding === true);
  const open = list.filter((row) => row.completedOnboarding === false);
  const unevaluable = list.filter((row) => row.completedOnboarding == null);
  const evaluable = complete.length + open.length;
  const withFirstMeeting = list.filter((row) => row.daysToFirstMeeting != null);
  const withPlan = list.filter((row) => row.daysToPlanDelivery != null);
  const withImplementation = list.filter((row) => row.daysToFirstImplementation != null);
  const withTotal = list.filter((row) => row.totalOnboardingDays != null);

  return {
    totalClients: total,
    completedOnboarding: complete.length,
    openOnboarding: open.length,
    unevaluableOnboarding: unevaluable.length,
    completionBaseClients: evaluable,
    completedPercent: evaluable ? Math.round((complete.length / evaluable) * 1000) / 10 : 0,
    medianTotalOnboardingDays: median(comparable.map((row) => row.totalOnboardingDays)),
    medianFirstMeetingDays: median(comparable.map((row) => row.daysToFirstMeeting)),
    medianPlanDeliveryDays: median(comparable.map((row) => row.daysToPlanDelivery)),
    medianFirstImplementationDays: median(withImplementation.map((row) => row.daysToFirstImplementation)),
    comparableClients: comparable.length,
    comparableCoverage: coverageOf(comparable.length, total),
    firstMeetingCoverage: coverageOf(withFirstMeeting.length, total),
    planDeliveryCoverage: coverageOf(withPlan.length, total),
    firstImplementationCoverage: coverageOf(withImplementation.length, total),
    totalOnboardingCoverage: coverageOf(withTotal.length, total),
    completionCoverage: coverageOf(evaluable, total),
  };
}

export function distributionsFromOnboardingRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const comparable = list.filter(isComparableOnboardingRow);
  const evaluable = list.filter((row) => row.completedOnboarding != null);
  return {
    completion: distributionFrom(
      evaluable,
      (row) => (row.completedOnboarding ? "Sim" : "Não"),
      ["Sim", "Não"],
    ),
    totalOnboarding: distributionFrom(
      comparable,
      (row) => dayRange(row.totalOnboardingDays),
      DAY_RANGE_LABELS,
    ),
    firstMeeting: distributionFrom(
      comparable,
      (row) => dayRange(row.daysToFirstMeeting),
      DAY_RANGE_LABELS,
    ),
    planDelivery: distributionFrom(
      comparable,
      (row) => dayRange(row.daysToPlanDelivery),
      DAY_RANGE_LABELS,
    ),
  };
}
