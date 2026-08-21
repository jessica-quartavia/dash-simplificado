/**
 * Analytics de Atendimento:
 * - operacional: research.acionamentos
 * - identificação: research.v_acionamentos_tratados (consolidado por id)
 * - qualidade: research.v_acionamentos_qualidade_email
 */

const PRIORITY_ORDER = ["Urgente", "Alta", "Média", "Baixa", "Não informado"];
const AREA_CHART_ORDER = ["App Pharus", "QV360 Web", "Não informado"];

export function blankToNull(value) {
  if (value == null) return null;
  if (typeof value === "string" && !value.trim()) return null;
  return value;
}

export function toBool(value) {
  const raw = blankToNull(value);
  if (raw == null) return null;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  const s = String(raw).trim().toLowerCase();
  if (["true", "t", "1", "sim", "yes", "y"].includes(s)) return true;
  if (["false", "f", "0", "nao", "não", "no", "n"].includes(s)) return false;
  return null;
}

export function parseDate(value) {
  const raw = blankToNull(value);
  if (!raw) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  const text = String(raw).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [y, m, d] = text.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function foldToken(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeLabel(raw, fallback = "Não informado") {
  const trimmed = blankToNull(typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : raw);
  if (trimmed == null) return { key: "", label: fallback, raw: null };
  return { key: foldToken(trimmed), label: String(trimmed), raw: String(trimmed) };
}

function normalizePriority(rawPriority) {
  const token = foldToken(rawPriority);
  if (!token) return "Não informado";
  if (["baixa", "low", "baixo"].includes(token)) return "Baixa";
  if (["media", "medium", "medio", "normal"].includes(token)) return "Média";
  if (["alta", "high", "alto"].includes(token)) return "Alta";
  if (["urgente", "urgent", "critica", "critical", "critico"].includes(token)) return "Urgente";
  const label = normalizeLabel(rawPriority).label;
  if (PRIORITY_ORDER.includes(label)) return label;
  return "Não informado";
}

function normalizeAreaChart(raw) {
  const trimmed = blankToNull(typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : raw);
  const token = foldToken(trimmed);
  if (!token) return "Não informado";
  if (token === "app pharus" || token.includes("pharus")) return "App Pharus";
  // "QV360 App" e "QV360 Web" caem na família QV360; auditados na base operacional.
  if (token === "qv360 web" || token === "qv360 app" || token.includes("qv360")) return "QV360 Web";
  return "Não informado";
}

function statusInfo(rawStatus) {
  const token = foldToken(rawStatus);
  if (!token) return { label: "Não informado", isOpen: false, isResolved: false };
  if (/(resolv|conclu|fechad|closed|done|finaliz)/.test(token)) {
    return { label: "Resolvido", isOpen: false, isResolved: true };
  }
  if (token === "novo" || token === "nova") return { label: "Novo", isOpen: true, isResolved: false };
  if (token === "pendente" || token === "pending") return { label: "Pendente", isOpen: true, isResolved: false };
  if (token.includes("andamento")) return { label: "Em andamento", isOpen: true, isResolved: false };
  if (/(abert|open)/.test(token)) return { label: "Aberto", isOpen: true, isResolved: false };
  const display = blankToNull(rawStatus) ? String(rawStatus).trim().replace(/\s+/g, " ") : "Não informado";
  return { label: display, isOpen: false, isResolved: false };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function ensureArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [text];
    } catch {
      return [text];
    }
  }
  if (typeof value === "object") return Object.values(value);
  return [value];
}

function isCorporateEmail(email) {
  return String(email || "").trim().toLowerCase().endsWith("@quartavia.com.br");
}

function hasAttachments(anexos, linkAnexos) {
  if (blankToNull(linkAnexos)) return true;
  if (anexos == null) return false;
  if (Array.isArray(anexos)) return anexos.length > 0;
  if (typeof anexos === "object") return Object.keys(anexos).length > 0;
  const text = String(anexos).trim();
  return Boolean(text && text !== "null" && text !== "[]" && text !== "{}");
}

function dayKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function consolidateTratadoById(tratadosRows) {
  const map = new Map();
  for (const row of tratadosRows || []) {
    const id = blankToNull(row.id);
    if (!id) continue;
    const key = String(id);
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}

function extractClients(tratado) {
  if (!tratado) return [];
  const clients = [];
  const seen = new Set();
  const push = (entry) => {
    const email = blankToNull(entry.email);
    if (email && isCorporateEmail(email)) return;
    const id = blankToNull(entry.clientId);
    const key = id ? `id:${id}` : email ? `email:${foldToken(email)}` : null;
    if (!key || seen.has(key)) return;
    seen.add(key);
    clients.push(entry);
  };

  if (blankToNull(tratado.baseqv_client_id)) {
    push({
      clientId: String(tratado.baseqv_client_id),
      code: blankToNull(tratado.baseqv_codigo),
      name: blankToNull(tratado.baseqv_client_name) || "Não informado",
      email: blankToNull(tratado.baseqv_email_match) || blankToNull(tratado.email_cliente_identificado),
      emailSource: blankToNull(tratado.baseqv_email_source),
      candidateOrigin: blankToNull(tratado.email_identificado_origem),
      primary: true,
    });
  }

  for (const item of ensureArray(tratado.emails_descricao_clientes)) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      push({
        clientId: blankToNull(item.client_id || item.baseqv_client_id) ? String(item.client_id || item.baseqv_client_id) : null,
        code: blankToNull(item.codigo || item.baseqv_codigo),
        name: blankToNull(item.nome || item.client_name || item.baseqv_client_name),
        email: blankToNull(item.email || item.baseqv_email_match),
        emailSource: blankToNull(item.email_source) || "descricao",
        candidateOrigin: "descricao",
        primary: false,
      });
      continue;
    }
    const email = blankToNull(item);
    if (!email) continue;
    push({
      clientId: null,
      code: null,
      name: null,
      email: String(email),
      emailSource: "descricao",
      candidateOrigin: "descricao",
      primary: false,
      partial: true,
    });
  }
  return clients;
}

function clientsCount(tratado, clients) {
  if (!tratado) return 0;
  const matches = Number(tratado.baseqv_quantidade_matches);
  if (Number.isFinite(matches) && matches > 0) return matches;
  const withId = clients.filter((c) => blankToNull(c.clientId)).length;
  if (withId > 0) return withId;
  if (toBool(tratado.cliente_encontrado_baseqv) === true || blankToNull(tratado.baseqv_client_id)) return 1;
  return 0;
}

function identificationOriginLabel(tratado, hasClient) {
  if (!hasClient) return "Não identificado";
  const origin = foldToken(tratado?.email_identificado_origem);
  if ((origin.includes("campo") && origin.includes("descricao")) || origin.includes("ambos")) {
    return "Campo e descrição";
  }
  if (origin.includes("descricao")) return "Descrição";
  if (origin.includes("campo")) return "Campo E-mail do Cliente";
  return "Campo E-mail do Cliente";
}

function identificationCategory(tratado, hasClient, count) {
  if (!tratado) return hasClient ? "Cliente identificado pelo campo" : "Sem e-mail utilizável";
  if (toBool(tratado.precisa_reprocessar) === true) return "Pendente de reprocessamento";
  const classif = foldToken(tratado.classificacao_email);
  if (count > 1 || classif.includes("multipl")) return "Múltiplos clientes";
  const origin = foldToken(tratado.email_identificado_origem);
  if (hasClient) {
    if (origin.includes("descricao") || (classif.includes("descricao") && classif.includes("identific"))) {
      return "Cliente identificado pela descrição";
    }
    return "Cliente identificado pelo campo";
  }
  if (classif.includes("sem match")) return "E-mail externo sem match";
  if (toBool(tratado.email_campo_corporativo) === true || classif.includes("corporativo")) {
    return "Somente e-mail corporativo";
  }
  return "Sem e-mail utilizável";
}

function distFromCounter(counter, total, preferredOrder = null) {
  let entries = [...counter.entries()].map(([label, count]) => ({
    label,
    count,
    percent: pct(count, total || 1),
  }));
  if (preferredOrder?.length) {
    const map = new Map(entries.map((e) => [e.label, e]));
    entries = preferredOrder.map((label) => map.get(label) || { label, count: 0, percent: 0 });
    entries = entries.filter((e) => e.count > 0 || preferredOrder.length <= 5);
  } else {
    entries.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
  }
  return entries;
}

function qualityWarningsFromAggregate(qualidade) {
  if (!qualidade || typeof qualidade !== "object") return [];
  const defs = [
    ["email_quartavia_no_campo_cliente", "E-mail corporativo no campo", "warning"],
    ["email_cliente_sem_match_baseqv", "E-mail externo sem match", "warning"],
    ["com_multiplos_clientes_encontrados", "Múltiplos clientes", "info"],
    ["campo_e_descricao_divergentes", "Campo e descrição divergentes", "warning"],
    ["aguardando_processamento", "Tratamento pendente / precisa reprocessar", "warning"],
    ["sem_email_identificado", "Acionamento sem e-mail utilizável", "warning"],
    ["somente_email_corporativo", "Somente e-mail corporativo", "info"],
  ];
  return defs
    .map(([key, label, severity]) => {
      const count = Number(qualidade[key]) || 0;
      if (!count) return null;
      return {
        code: key,
        label,
        count,
        severity,
        message: `${count} ${label.charAt(0).toLowerCase()}${label.slice(1)}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.count - a.count);
}

/** Projeta campos operacionais a partir da view tratada quando acionamentos não veio separado. */
export function projectAcionamentosFromTratados(tratadosRows) {
  const byId = new Map();
  for (const t of tratadosRows || []) {
    const id = blankToNull(t.id);
    if (!id) continue;
    const key = String(id);
    if (byId.has(key)) continue;
    byId.set(key, {
      id: t.id,
      nome_solicitante: t.nome_solicitante,
      prioridade: t.prioridade,
      tipo_solicitacao: t.tipo_solicitacao,
      area_setor: t.area_setor,
      titulo: t.titulo,
      descricao: t.descricao,
      email_cliente: t.email_cliente_original || t.email_cliente,
      data_abertura: t.data_abertura,
      status: t.status,
      origem: t.origem,
      client_id: t.client_id_original || t.client_id,
      client_name: t.client_name_original || t.client_name,
      client_found: t.client_found_original || t.client_found,
      resolved_at: t.resolved_at,
      link_anexos: t.link_anexos,
      anexos: t.anexos,
      created_at: t.created_at,
      updated_at: t.updated_at,
    });
  }
  return [...byId.values()];
}

/**
 * @param {{ acionamentos?: object[], tratados?: object[], qualidade?: object|null, fetchWarnings?: string[], source?: string }} input
 */
export function buildSupportAnalyticsPayload(input = {}) {
  const fetchWarnings = input.fetchWarnings || [];
  let acionamentos = Array.isArray(input.acionamentos) ? input.acionamentos : [];
  const tratados = Array.isArray(input.tratados) ? input.tratados : [];
  const qualidade = input.qualidade || null;
  let source = input.source || "research.acionamentos";

  if (!acionamentos.length && tratados.length) {
    acionamentos = projectAcionamentosFromTratados(tratados);
    source = `${source}|operational_from_tratados`;
    fetchWarnings.push("Linhas operacionais projetadas a partir de v_acionamentos_tratados (campos denormalizados).");
  }

  const tratadoById = consolidateTratadoById(tratados);
  const now = new Date();
  const tickets = [];
  const seen = new Set();

  for (const row of acionamentos) {
    const id = blankToNull(row.id);
    if (!id) continue;
    const idKey = String(id);
    if (seen.has(idKey)) continue;
    seen.add(idKey);

    const tratado = tratadoById.get(idKey) || null;
    const clients = extractClients(tratado);
    const countClients = clientsCount(tratado, clients);
    const hasClient = countClients > 0 && (
      toBool(tratado?.cliente_encontrado_baseqv) === true
      || Boolean(blankToNull(tratado?.baseqv_client_id))
      || clients.some((c) => c.clientId)
    );

    const areaNorm = normalizeLabel(row.area_setor);
    const typeNorm = normalizeLabel(row.tipo_solicitacao);
    const requesterNorm = normalizeLabel(row.nome_solicitante);
    const originNorm = normalizeLabel(row.origem);
    const status = statusInfo(row.status);
    const priority = normalizePriority(row.prioridade);
    const openedAt = parseDate(row.data_abertura) || parseDate(row.created_at);
    const resolvedAt = parseDate(row.resolved_at);
    const isResolved = Boolean(resolvedAt) || status.isResolved;
    const isOpen = !isResolved && status.isOpen;

    let resolutionHours = null;
    if (openedAt && resolvedAt && resolvedAt >= openedAt && resolvedAt <= now) {
      resolutionHours = round1((resolvedAt.getTime() - openedAt.getTime()) / 3600000);
    }

    const category = identificationCategory(tratado, hasClient, countClients);
    const identOrigin = identificationOriginLabel(tratado, hasClient);
    const clientLabel = (() => {
      if (!hasClient || countClients <= 0) return "Não identificado";
      if (countClients === 1) {
        const c = clients[0];
        if (c?.name && c?.code) return `${c.name} (${c.code})`;
        if (c?.name) return c.name;
        return "Cliente identificado";
      }
      return `${countClients} clientes identificados`;
    })();

    tickets.push({
      ticketId: idKey,
      title: blankToNull(row.titulo) || "Não informado",
      description: blankToNull(row.descricao) || "",
      area: areaNorm.label,
      areaChart: normalizeAreaChart(row.area_setor),
      type: typeNorm.label,
      status: status.label,
      statusRaw: blankToNull(row.status),
      isOpen,
      isResolved,
      priority,
      origin: originNorm.label,
      requester: requesterNorm.label,
      openedAt: openedAt ? openedAt.toISOString() : null,
      createdAt: parseDate(row.created_at)?.toISOString() || null,
      updatedAt: parseDate(row.updated_at)?.toISOString() || null,
      resolvedAt: resolvedAt ? resolvedAt.toISOString() : null,
      resolutionHours,
      hasAttachment: hasAttachments(row.anexos, row.link_anexos),
      attachmentLink: blankToNull(row.link_anexos),

      clientIdentified: hasClient,
      clientsCount: countClients,
      clientLabel,
      clients,
      primaryClientId: blankToNull(tratado?.baseqv_client_id) ? String(tratado.baseqv_client_id) : null,
      primaryClientName: blankToNull(tratado?.baseqv_client_name),
      primaryClientCode: blankToNull(tratado?.baseqv_codigo),
      clientEmailOriginal: blankToNull(tratado?.email_cliente_original) || blankToNull(row.email_cliente),
      clientEmailNormalized: blankToNull(tratado?.email_campo_normalizado),
      clientEmailIdentified: blankToNull(tratado?.email_cliente_identificado),
      corporateEmailInField: toBool(tratado?.email_campo_corporativo) === true,
      emailsInDescription: ensureArray(tratado?.emails_descricao).map(String),
      emailsDescriptionClients: ensureArray(tratado?.emails_descricao_clientes),
      identificationOrigin: identOrigin,
      identificationCategory: category,
      classificationEmail: blankToNull(tratado?.classificacao_email),
      fieldDescriptionDivergent: toBool(tratado?.email_campo_descricao_divergentes) === true,
      needsReprocessing: toBool(tratado?.precisa_reprocessar) === true,
      treatmentDetail: blankToNull(tratado?.tratamento_email_detalhe),
      treatmentStatus: blankToNull(tratado?.tratamento_email_status),
      emailIdentifiedOriginRaw: blankToNull(tratado?.email_identificado_origem),
      baseqvMatches: Number(tratado?.baseqv_quantidade_matches) || 0,

      clientId: blankToNull(tratado?.baseqv_client_id) ? String(tratado.baseqv_client_id) : (blankToNull(row.client_id) ? String(row.client_id) : null),
      clientName: blankToNull(tratado?.baseqv_client_name) || blankToNull(row.client_name) || clientLabel,
      clientEmail: blankToNull(tratado?.email_cliente_identificado) || blankToNull(row.email_cliente),
      clientFound: hasClient,
    });
  }

  const totalTickets = tickets.length;
  const urgentTickets = tickets.filter((t) => t.priority === "Urgente").length;
  const identifiedClientIds = new Set(tickets.map((t) => t.primaryClientId).filter(Boolean));
  const ticketsWithClient = tickets.filter((t) => t.clientIdentified).length;
  const ticketsWithoutClient = totalTickets - ticketsWithClient;
  const identificationCoverage = pct(ticketsWithClient, totalTickets || 1);

  const areaCounter = new Map();
  const typeCounter = new Map();
  const priorityCounter = new Map();
  const statusCounter = new Map();
  const requesterCounter = new Map();
  for (const label of AREA_CHART_ORDER) areaCounter.set(label, 0);
  for (const label of PRIORITY_ORDER) priorityCounter.set(label, 0);

  for (const t of tickets) {
    areaCounter.set(t.areaChart, (areaCounter.get(t.areaChart) || 0) + 1);
    typeCounter.set(t.type, (typeCounter.get(t.type) || 0) + 1);
    priorityCounter.set(t.priority, (priorityCounter.get(t.priority) || 0) + 1);
    statusCounter.set(t.status, (statusCounter.get(t.status) || 0) + 1);
    if (t.requester && t.requester !== "Não informado") {
      requesterCounter.set(t.requester, (requesterCounter.get(t.requester) || 0) + 1);
    }
  }

  const byArea = distFromCounter(areaCounter, totalTickets, AREA_CHART_ORDER);
  const byType = distFromCounter(typeCounter, totalTickets);
  const byPriority = distFromCounter(priorityCounter, totalTickets, PRIORITY_ORDER);
  const byStatus = distFromCounter(statusCounter, totalTickets);
  const byRequester = distFromCounter(requesterCounter, totalTickets).slice(0, 10);

  const topAreaEntry = byArea.find((a) => a.label !== "Não informado" && a.count > 0) || byArea.find((a) => a.count > 0) || null;
  const topTypeEntry = byType.find((a) => a.label !== "Não informado" && a.count > 0) || byType.find((a) => a.count > 0) || null;

  const statusDiversityUseful = byStatus.filter((s) => s.count > 0).length >= 2
    && !(byStatus[0] && byStatus[0].count / Math.max(totalTickets, 1) >= 0.95);

  // evolução
  const dates = tickets
    .map((t) => ({ d: parseDate(t.openedAt), clientId: t.primaryClientId }))
    .filter((x) => x.d && x.d <= now);
  let monthlyEvolution = [];
  if (dates.length) {
    /** Piso visual da série: mai/2026 (base útil de acionamentos). Contagens por mês inalteradas. */
    const seriesFloor = new Date(Date.UTC(2026, 4, 1));
    const rawMin = new Date(Math.min(...dates.map((x) => x.d.getTime())));
    const min = rawMin < seriesFloor ? seriesFloor : rawMin;
    const spanDays = Math.max(1, Math.ceil((now.getTime() - min.getTime()) / 86400000) + 1);
    const byDay = spanDays <= 45;
    const buckets = new Map();
    if (byDay) {
      for (let t = Date.UTC(min.getUTCFullYear(), min.getUTCMonth(), min.getUTCDate()); t <= now.getTime(); t += 86400000) {
        buckets.set(dayKey(new Date(t)), { count: 0, clients: new Set() });
      }
    } else {
      let cursor = new Date(Date.UTC(min.getUTCFullYear(), min.getUTCMonth(), 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      while (cursor <= end) {
        buckets.set(monthKey(cursor), { count: 0, clients: new Set() });
        cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
      }
    }
    for (const { d, clientId } of dates) {
      if (d < seriesFloor) continue;
      const key = byDay ? dayKey(d) : monthKey(d);
      if (!buckets.has(key)) continue;
      buckets.get(key).count += 1;
      if (clientId) buckets.get(key).clients.add(clientId);
    }
    monthlyEvolution = [...buckets.entries()].map(([period, bucket]) => ({
      period,
      label: period,
      count: bucket.count,
      distinctClients: bucket.clients.size,
      grain: byDay ? "day" : "month",
    }));
    const firstData = monthlyEvolution.findIndex((p) => (p.count || 0) > 0);
    if (firstData > 0) monthlyEvolution = monthlyEvolution.slice(firstData);
  }

  const resolvedTickets = tickets.filter((t) => t.isResolved).length;
  const openTickets = tickets.filter((t) => t.isOpen).length;
  const resolutionValues = tickets
    .map((t) => t.resolutionHours)
    .filter((h) => h != null && Number.isFinite(h) && h >= 0)
    .sort((a, b) => a - b);
  const resolutionCoverageUseful = resolvedTickets >= 10 && resolutionValues.length >= 10 && totalTickets >= 30;

  const identifiedFromField = tickets.filter((t) => t.identificationCategory === "Cliente identificado pelo campo").length;
  const identifiedFromDescription = Number(qualidade?.clientes_identificados_pela_descricao)
    || tickets.filter((t) => t.identificationCategory === "Cliente identificado pela descrição" || foldToken(t.emailIdentifiedOriginRaw).includes("descricao")).length;
  const multipleClients = Number(qualidade?.com_multiplos_clientes_encontrados)
    || tickets.filter((t) => t.clientsCount > 1).length;
  const corporateEmailTickets = Number(qualidade?.email_quartavia_no_campo_cliente)
    || tickets.filter((t) => t.corporateEmailInField).length;
  const unmatchedEmail = Number(qualidade?.email_cliente_sem_match_baseqv)
    || tickets.filter((t) => t.identificationCategory === "E-mail externo sem match").length;

  const supportRequests = tickets.filter((t) => /suporte|support/.test(foldToken(t.type))).length;
  const suspectedBugs = tickets.filter((t) => /bug|suspeita/.test(foldToken(t.type))).length;

  const dataCoverage = {
    supportRequests,
    suspectedBugs,
    urgentTickets,
    withoutArea: tickets.filter((t) => t.areaChart === "Não informado").length,
    withoutType: tickets.filter((t) => t.type === "Não informado").length,
    withoutDescription: tickets.filter((t) => !blankToNull(t.description)).length,
    withoutClient: ticketsWithoutClient,
    withCorporateEmail: corporateEmailTickets,
    unmatchedEmail,
    multipleClients,
    identifiedFromField,
    identifiedFromDescription,
  };

  const qualityWarnings = qualityWarningsFromAggregate(qualidade);
  if (!resolutionCoverageUseful) {
    qualityWarnings.push({
      code: "RESOLUTION_COVERAGE",
      label: "Cobertura de resolução insuficiente",
      count: resolvedTickets,
      severity: "info",
      message: "A base atual ainda não possui cobertura suficiente de resolved_at/status para indicadores de resolução.",
    });
  }
  if (!statusDiversityUseful) {
    qualityWarnings.push({
      code: "STATUS_DIVERSITY",
      label: "Diversidade de status insuficiente",
      count: byStatus[0]?.count || 0,
      severity: "info",
      message: "A base atual ainda não possui diversidade suficiente de status para analisar o ciclo de resolução.",
    });
  }

  return {
    generatedAt: now.toISOString(),
    source,
    summary: {
      totalTickets,
      urgentTickets,
      identifiedClients: identifiedClientIds.size,
      ticketsWithClient,
      identificationCoverage,
      ticketsWithoutClient,
      topArea: topAreaEntry?.label || null,
      topAreaCount: topAreaEntry?.count || 0,
      topType: topTypeEntry?.label || null,
      topTypeCount: topTypeEntry?.count || 0,
      withoutArea: dataCoverage.withoutArea,
      withoutType: dataCoverage.withoutType,
      withoutDescription: dataCoverage.withoutDescription,
      openTickets: resolutionCoverageUseful ? openTickets : null,
      resolvedTickets: resolutionCoverageUseful ? resolvedTickets : null,
      resolutionRate: resolutionCoverageUseful ? pct(resolvedTickets, totalTickets || 1) : null,
      medianResolutionHours: resolutionCoverageUseful ? round1(percentile(resolutionValues, 50)) : null,
      // compat chatbot / registry
      identifiedPercent: identificationCoverage,
      unidentifiedClients: ticketsWithoutClient,
      clientsWithTickets: identifiedClientIds.size,
      corporateEmailTickets,
      identifiedFromDescription,
      identifiedFromField,
      ticketsWithMultipleClients: multipleClients,
      unmatchedEmailTickets: unmatchedEmail,
      needsReprocessing: Number(qualidade?.aguardando_processamento)
        || tickets.filter((t) => t.needsReprocessing).length,
      note: "Operacional: research.acionamentos · Identificação: research.v_acionamentos_tratados",
    },
    monthlyEvolution,
    byArea,
    byType,
    byPriority,
    byStatus: statusDiversityUseful ? byStatus : [],
    byRequester,
    dataCoverage,
    identification: {
      identifiedClients: identifiedClientIds.size,
      ticketsWithClient,
      identificationCoverage,
      ticketsWithoutClient,
      corporateEmailTickets,
      unmatchedEmailTickets: unmatchedEmail,
      multipleClientTickets: multipleClients,
      identifiedFromField,
      identifiedFromDescription,
    },
    qualityWarnings,
    meta: {
      statusDiversityUseful,
      resolutionCoverageUseful,
      acionamentosCount: acionamentos.length,
      tratadosCount: tratados.length,
      distinctTickets: totalTickets,
      rawStatus: byStatus,
    },
    tickets,
    rows: tickets,
    distributions: {
      byArea,
      byType,
      byPriority,
      byStatus: statusDiversityUseful ? byStatus : byStatus,
      byPeriod: monthlyEvolution,
      byRequester,
      byMonth: monthlyEvolution.filter((p) => p.grain === "month"),
    },
    warnings: [
      ...fetchWarnings.map((message) => ({ code: "FETCH", message })),
      ...(!resolutionCoverageUseful ? [{
        code: "RESOLUTION_COVERAGE",
        message: "Métricas de resolução omitidas: cobertura insuficiente de resolved_at/status.",
      }] : []),
    ],
    quality: {
      aggregate: qualidade,
      warnings: qualityWarnings,
      usedFields: [
        { schema: "research", table: "acionamentos", column: "id", role: "ticketId" },
        { schema: "research", table: "acionamentos", column: "area_setor", role: "area" },
        { schema: "research", table: "v_acionamentos_tratados", column: "baseqv_client_id", role: "clientId" },
        { schema: "research", table: "v_acionamentos_qualidade_email", column: "total_acionamentos", role: "qualityAggregate" },
      ],
    },
  };
}
