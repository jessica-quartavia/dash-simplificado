/**
 * Parser conservador de filtros em linguagem natural para o Assistente V2.
 */
import { foldSearchText } from "../analytics/filters/search.mjs";
import { normalizePeriodMode } from "../analytics/filters/period.mjs";

const PERIOD_PATTERNS = [
  { mode: "last_30", pattern: /\b(ultimos|últimos)\s+30\s+dias\b/ },
  { mode: "last_90", pattern: /\b(ultimos|últimos)\s+90\s+dias\b/ },
  { mode: "last_6m", pattern: /\b(ultimos|últimos)\s+6\s+meses\b/ },
  { mode: "last_12m", pattern: /\b(ultimos|últimos)\s+12\s+meses\b/ },
  { mode: "this_year", pattern: /\beste ano\b/ },
  { mode: "last_year", pattern: /\bano anterior\b/ },
];

const SEGMENT_PATTERN = /\b(?:do\s+)?segmento\s+([a-z0-9][a-z0-9\s\-_/]+?)(?:\?|$|\bdo\b|\bda\b|\bde\b)/i;
const ENGINEER_PATTERNS = [
  /\b(?:do|da)\s+ep\s+([^?]+?)(?:\?|$)/i,
  /\bep\s+([^?]+?)(?:\?|$)/i,
];

export function parseAssistantFilters(message) {
  const normalized = foldSearchText(message);
  const filters = {
    status: "all",
    engineer: "all",
    segment: "all",
    period: "all",
    from: "",
    to: "",
  };
  const hints = { engineerQuery: null, segmentQuery: null, periodMode: null };

  for (const { mode, pattern } of PERIOD_PATTERNS) {
    if (pattern.test(normalized)) {
      filters.period = normalizePeriodMode(mode);
      hints.periodMode = filters.period;
      break;
    }
  }

  const segmentMatch = String(message || "").match(SEGMENT_PATTERN);
  if (segmentMatch?.[1]) {
    hints.segmentQuery = segmentMatch[1].trim();
    filters.segment = hints.segmentQuery;
  }

  for (const pattern of ENGINEER_PATTERNS) {
    const match = String(message || "").match(pattern);
    if (match?.[1]) {
      hints.engineerQuery = match[1].trim();
      break;
    }
  }

  return { filters, hints };
}

export function mergeResolvedFilters(baseFilters, resolved = {}) {
  return {
    ...baseFilters,
    engineer: resolved.engineer || baseFilters.engineer,
    segment: resolved.segment || baseFilters.segment,
  };
}
