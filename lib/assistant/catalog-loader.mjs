/**
 * Catálogo analítico para o Assistente V2 — cache em memória + REST autenticado.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchAssistantMetricCatalogRows } from "../data/analytics-catalog-assistant-rest.mjs";

const CACHE_TTL_MS = 10 * 60 * 1000;
const SEED_PATH = join(dirname(fileURLToPath(import.meta.url)), "../analytics/metric-catalog-seed.json");

let cache = { expiresAt: 0, rows: null, source: null };

function loadSeedCatalog() {
  const raw = JSON.parse(readFileSync(SEED_PATH, "utf8"));
  return Array.isArray(raw?.metrics) ? raw.metrics : [];
}

export function clearAssistantCatalogCache() {
  cache = { expiresAt: 0, rows: null, source: null };
}

export async function loadAssistantCatalog({ accessToken, forceRefresh = false, deps = {} } = {}) {
  const now = Date.now();
  if (!forceRefresh && cache.rows && cache.expiresAt > now) {
    return { rows: cache.rows, queryMs: 0, source: cache.source, cached: true };
  }

  const fetchRows = deps.fetchAssistantMetricCatalogRows || fetchAssistantMetricCatalogRows;
  if (accessToken) {
    try {
      const { rows, queryMs } = await fetchRows({ accessToken });
      if (Array.isArray(rows) && rows.length > 0) {
        cache = { expiresAt: now + CACHE_TTL_MS, rows, source: "rest" };
        return { rows, queryMs, source: "rest", cached: false };
      }
    } catch {
      // fallback abaixo
    }
  }

  const rows = deps.seedRows || loadSeedCatalog();
  cache = { expiresAt: now + CACHE_TTL_MS, rows, source: "seed" };
  return { rows, queryMs: 0, source: "seed", cached: false };
}
