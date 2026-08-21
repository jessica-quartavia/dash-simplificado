/**
 * Filtros — Uso da Plataforma (App Pharus).
 */
import { matchesSearch } from "./filters/search.mjs";

export const LOGIN_FILTER_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "yes", label: "Sim" },
  { value: "no", label: "Não" },
];

export const LAST_ACCESS_FILTER_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "0-7", label: "0–7 dias" },
  { value: "8-30", label: "8–30 dias" },
  { value: "31-90", label: "31–90 dias" },
  { value: "90+", label: "Mais de 90 dias" },
  { value: "none", label: "Sem acesso" },
];

export function defaultPlatformUsageFilters() {
  return {
    search: "",
    realizedLogin: "all",
    lastAccess: "all",
  };
}

export function filtersMatchDefault(filters = {}) {
  const defaults = defaultPlatformUsageFilters();
  return (
    String(filters.search || "") === defaults.search
    && String(filters.realizedLogin || "all") === defaults.realizedLogin
    && String(filters.lastAccess || "all") === defaults.lastAccess
  );
}

function matchesLastAccess(row, band) {
  if (band === "all") return true;
  const days = row.daysSinceLastAccess;
  if (band === "none") return days == null || !row.realizedLogin;
  if (days == null) return false;
  if (band === "0-7") return days <= 7;
  if (band === "8-30") return days >= 8 && days <= 30;
  if (band === "31-90") return days >= 31 && days <= 90;
  if (band === "90+") return days > 90;
  return true;
}

export function filterPlatformUsageClients(clients, filters = {}) {
  const f = { ...defaultPlatformUsageFilters(), ...filters };
  return (Array.isArray(clients) ? clients : []).filter((row) => {
    if (f.realizedLogin === "yes" && !row.realizedLogin) return false;
    if (f.realizedLogin === "no" && row.realizedLogin) return false;
    if (!matchesLastAccess(row, f.lastAccess)) return false;
    if (!matchesSearch(row, f.search, ["userName", "email", "userId"])) return false;
    return true;
  });
}

export function summarizeFilteredPlatformUsage(rows, summaryBase = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length;
  const withLogin = list.filter((r) => r.realizedLogin).length;
  const totalLogins = list.reduce((sum, r) => sum + (Number(r.totalLogins) || 0), 0);
  return {
    totalUsers: total,
    usersWithLogin: withLogin,
    loginCoverage: total ? Math.round((withLogin / total) * 1000) / 10 : 0,
    totalLogins,
    typicalDaysSinceLastAccess: median(list.map((r) => r.daysSinceLastAccess).filter((v) => v != null)),
    averageLoginsPerMonth: average(list.map((r) => r.loginsPerMonth).filter((v) => v != null)),
    averageWeeklyFrequency: average(list.map((r) => r.weeklyAccessFrequency).filter((v) => v != null)),
    averageMonthlyFrequency: average(list.map((r) => r.monthlyAccessFrequency).filter((v) => v != null)),
    baseSummary: summaryBase,
  };
}

function average(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

function median(values) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : Math.round(((nums[mid - 1] + nums[mid]) / 2) * 100) / 100;
}
