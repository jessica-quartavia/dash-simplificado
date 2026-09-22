/**
 * Registry global de exportação CSV por página.
 */
import { canCurrentUserAccessPage } from "./access-context.js";
import { downloadCsv } from "./export-csv.js";
import { composePageCsvDownload, PAGE_EXPORT_BUILDERS } from "../lib/analytics/page-csv-builders.mjs";

export const PAGE_CSV_EXPORT_IDS = Object.freeze(Object.keys(PAGE_EXPORT_BUILDERS));

export const CSV_EXPORT_EXCLUDED_PAGE_IDS = Object.freeze([
  "access_management",
  "metrics_documentation",
  "reports",
]);

const contextProviders = new Map();

export function registerPageExportContext(pageId, getContext) {
  if (!pageId || typeof getContext !== "function") {
    contextProviders.delete(pageId);
    return;
  }
  contextProviders.set(pageId, getContext);
}

export function clearPageExportContext(pageId) {
  if (pageId) contextProviders.delete(pageId);
  else contextProviders.clear();
}

export function getPageExportContext(pageId) {
  const fn = contextProviders.get(pageId);
  return fn ? fn() : null;
}

export function canExportPageCsv(pageId) {
  if (!pageId || CSV_EXPORT_EXCLUDED_PAGE_IDS.includes(pageId)) return false;
  if (!PAGE_EXPORT_BUILDERS[pageId]) return false;
  return canCurrentUserAccessPage(pageId);
}

export async function runPageCsvExport(pageId) {
  if (!canExportPageCsv(pageId)) {
    const err = new Error("forbidden");
    err.code = "forbidden";
    throw err;
  }
  const ctx = getPageExportContext(pageId);
  if (!ctx?.payload && pageId !== "executive_summary") {
    throw new Error("Dados ainda não carregados.");
  }
  if (ctx?.loading) {
    throw new Error("Aguarde o carregamento da página.");
  }
  const { csv, filename } = composePageCsvDownload(pageId, ctx);
  downloadCsv(csv, filename);
  return { filename };
}

export const PAGE_EXPORT_REGISTRY = PAGE_EXPORT_BUILDERS;
