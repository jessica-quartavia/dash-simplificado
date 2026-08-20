/**
 * Normalização central de tipos/títulos de reunião (Calendly event_name / CSV Event Type Name).
 * Preserva o nome original e deriva família + contexto de produto.
 */
function fold(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[®™]/g, "")
    .replace(/\|/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const PRODUCT_HINTS = [
  { re: /\bpharus\b/, label: "Pharus" },
  { re: /\bpatrimonium\b/, label: "Patrimonium" },
  { re: /\bdavos\b/, label: "DAVOS" },
  { re: /\bquartavia\b|\bqv\b/, label: "QV" },
];

const FAMILY_RULES = [
  { family: "Checkpoint", re: /\bcheckpoint\b/ },
  { family: "Kickoff", re: /\bkick\s*off\b|\bkickoff\b/ },
  { family: "Rota Patrimonial", re: /\brota patrimonial\b/ },
  { family: "Especial", re: /\bespecial\b/ },
  { family: "Ativação das Engrenagens", re: /\bativacao das engrenagens\b|\bativa[cç][aã]o das engrenagens\b/ },
  { family: "Tração Patrimonial", re: /\btracao patrimonial\b|\btra[cç][aã]o patrimonial\b/ },
  { family: "Central de Inteligência", re: /\bcentral de inteligencia\b|\bcentral de intelig[eê]ncia\b/ },
  { family: "Implementação", re: /\bimplementacao\b|\bimplementa[cç][aã]o\b/ },
  { family: "Mapeamento", re: /\bmapeamento\b/ },
  { family: "Mecanismos", re: /\bmecanismos?\b/ },
  { family: "Alinhamento", re: /\balinhamento\b/ },
  { family: "DAVOS", re: /\bdavos\b/ },
  { family: "VIP Planning", re: /\bvip planning\b/ },
  { family: "Acompanhamento", re: /\bacompanhamento\b/ },
  { family: "Revisão", re: /\brevisao\b|\brevis[aã]o\b/ },
];

function detectProduct(folded) {
  for (const hint of PRODUCT_HINTS) {
    if (hint.re.test(folded)) return hint.label;
  }
  return null;
}

function detectFamily(folded, raw) {
  // Prefer explicit family tokens; DAVOS alone without other family stays DAVOS
  for (const rule of FAMILY_RULES) {
    if (rule.family === "DAVOS") continue;
    if (rule.re.test(folded)) return rule.family;
  }
  if (/\bdavos\b/.test(folded)) return "DAVOS";
  const trimmed = String(raw || "").trim();
  if (!trimmed || /^reuni[aã]o( manual)?$/i.test(trimmed)) return "Outros tipos";
  return "Outros tipos";
}

/**
 * @param {string|null|undefined} rawEventType
 * @returns {{
 *  rawEventType: string,
 *  meetingFamily: string,
 *  productContext: string|null,
 *  normalizedLabel: string,
 *  folded: string
 * }}
 */
export function normalizeMeetingEventType(rawEventType) {
  const raw = String(rawEventType || "").trim() || "Não informado";
  const folded = fold(raw);
  const meetingFamily = detectFamily(folded, raw);
  const productContext = detectProduct(folded);
  const normalizedLabel = productContext && meetingFamily !== "Outros tipos"
    ? `${meetingFamily} — ${productContext}`
    : meetingFamily;
  return {
    rawEventType: raw,
    meetingFamily,
    productContext,
    normalizedLabel,
    folded,
  };
}

export function buildMeetingTypeDistributions(meetings, { now = new Date() } = {}) {
  const byFamily = new Map();
  const byRaw = new Map();

  const bump = (map, key, patch) => {
    const cur = map.get(key) || {
      label: key,
      count: 0,
      canceled: 0,
      noShows: 0,
      future: 0,
    };
    cur.count += 1;
    if (patch.canceled) cur.canceled += 1;
    if (patch.noShow) cur.noShows += 1;
    if (patch.future) cur.future += 1;
    map.set(key, cur);
  };

  for (const m of meetings || []) {
    const start = m.startTime ? new Date(m.startTime) : null;
    const future = Boolean(start && !Number.isNaN(start.getTime()) && start > now);
    const canceled = m.attendanceStatus === "cancelada" || m.canceled === true;
    const noShow = m.attendanceStatus === "nao_compareceu";
    const norm = normalizeMeetingEventType(m.title || m.eventType || m.rawEventType);
    bump(byFamily, norm.meetingFamily, { canceled, noShow, future });
    bump(byRaw, norm.rawEventType, { canceled, noShow, future });
  }

  const finish = (map) => {
    const total = [...map.values()].reduce((a, r) => a + r.count, 0) || 1;
    return [...map.values()]
      .map((r) => ({
        ...r,
        percent: Math.round((r.count / total) * 1000) / 10,
        cancelRate: r.count ? Math.round((r.canceled / r.count) * 1000) / 10 : null,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
  };

  return {
    byFamily: finish(byFamily),
    byRaw: finish(byRaw),
  };
}
