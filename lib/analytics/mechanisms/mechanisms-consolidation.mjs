/**
 * Consolidação read-only BASE QV + App Pharus para Implementação de Mecanismos.
 */
import { blankToNull, parseDate } from "../meeting-metrics.mjs";
import {
  computePharusMechanismAudit,
  pctBand,
  recommendationsPerClientBand,
} from "../mechanism-metrics.mjs";
import {
  PHARUS_CREATED_AT_VALID_FOR_IMPLEMENTATION,
  normalizePharusMechanismStatus,
} from "./mechanism-status.mjs";
import {
  auditPharusClientCrosswalk,
  buildPharusClientCrosswalk,
  canonicalClientIdForPharusUser,
} from "../pharus-client-crosswalk.mjs";
import { buildMechanismCrosswalk } from "./mechanism-crosswalk.mjs";

const STATUS_PRIORITY = {
  Implementado: 4,
  "Em andamento": 3,
  Apto: 2,
  "Não informado": 1,
};

const PHARUS_STATUS_MAP = {
  suggested: "Implementado",
  apto: "Apto",
  eligible: "Apto",
  iniciado: "Em andamento",
  andamento: "Em andamento",
  started: "Em andamento",
  "em andamento": "Em andamento",
  concluido: "Implementado",
  concluida: "Implementado",
  implementado: "Implementado",
  completed: "Implementado",
  implemented: "Implementado",
};

function mapPharusStatus(rawStatus) {
  return normalizePharusMechanismStatus(rawStatus);
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function pharusImplementedAt(row, status) {
  if (status !== "Implementado") return null;
  if (PHARUS_CREATED_AT_VALID_FOR_IMPLEMENTATION) {
    return row.implementedAt || row.implemented_at || row.createdAt || row.created_at || null;
  }
  return null;
}

function mergeSources(a = [], b = []) {
  return [...new Set([...(a || []), ...(b || [])])].sort();
}

function pickConsolidatedStatus(a, b) {
  const pa = STATUS_PRIORITY[a] || 0;
  const pb = STATUS_PRIORITY[b] || 0;
  return pa >= pb ? a : b;
}

function buildNormalizedLink({
  canonicalClientId,
  canonicalMechanismId,
  canonicalMechanismName,
  status,
  dimension,
  implementedAt,
  sources,
  baseQvLinkId = null,
  pharusLinkId = null,
}) {
  const implDate = implementedAt ? parseDate(implementedAt) : null;
  const validImpl = status === "Implementado" && implDate;
  return {
    linkKey: `${canonicalClientId}|${canonicalMechanismId}`,
    mechanismId: canonicalMechanismId,
    name: canonicalMechanismName,
    status,
    dimension: dimension || "Não informado",
    implementedAt: validImpl ? implDate.toISOString() : null,
    implementedMonth: validImpl ? monthKey(implDate) : null,
    sources: sources || [],
    baseQvLinkId,
    pharusLinkId,
  };
}

function mergeLink(existing, incoming) {
  const status = pickConsolidatedStatus(existing.status, incoming.status);
  const dates = [existing.implementedAt, incoming.implementedAt].map(parseDate).filter(Boolean);
  const earliest = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
  const latest = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
  const implDate = status === "Implementado" ? (earliest || latest) : null;
  return {
    ...existing,
    status,
    sources: mergeSources(existing.sources, incoming.sources),
    implementedAt: implDate ? implDate.toISOString() : null,
    implementedMonth: implDate ? monthKey(implDate) : null,
    firstImplementedAt: earliest ? earliest.toISOString() : existing.firstImplementedAt || null,
    lastImplementedAt: latest ? latest.toISOString() : existing.lastImplementedAt || null,
    baseQvLinkId: existing.baseQvLinkId || incoming.baseQvLinkId || null,
    pharusLinkId: existing.pharusLinkId || incoming.pharusLinkId || null,
    dimension: existing.dimension !== "Não informado" ? existing.dimension : incoming.dimension,
  };
}

function rollupClientRow(clientId, links, baseRow = null) {
  let eligible = 0;
  let inProgress = 0;
  let implemented = 0;
  let recentImpls = 0;
  const recentCutoff = Date.now() - 30 * 86400000;
  for (const link of links) {
    if (link.status === "Apto") eligible += 1;
    if (link.status === "Em andamento") inProgress += 1;
    if (link.status === "Implementado") implemented += 1;
    const impl = parseDate(link.implementedAt);
    if (link.status === "Implementado" && impl && impl.getTime() >= recentCutoff) recentImpls += 1;
  }
  const available = links.length;
  const implementationPercent = available > 0
    ? Math.min(100, Math.round((implemented / available) * 1000) / 10)
    : null;

  const sources = mergeSources(...links.map((l) => l.sources));
  return {
    clientId: baseRow?.clientId || clientId,
    canonicalClientId: clientId,
    clientCode: baseRow?.clientCode || null,
    clientName: baseRow?.clientName || "Usuário App Pharus",
    engineer: baseRow?.engineer || "Não informado",
    program: baseRow?.program || null,
    segment: baseRow?.segment || "Dados insuficientes",
    analyticalStatus: baseRow?.analyticalStatus || "Não informado",
    available,
    eligible,
    inProgress,
    implemented,
    implementationPercent,
    hasImplementationLast30Days: recentImpls > 0,
    mechanismsCountBand: recommendationsPerClientBand(available),
    percentRange: pctBand(implementationPercent, available),
    clientSources: sources,
    hasQvProfile: Boolean(baseRow),
    mechanisms: links.map((link) => ({
      mechanismId: link.mechanismId,
      name: link.name,
      status: link.status,
      dimension: link.dimension,
      implementedMonth: link.implementedMonth,
      implementedAt: link.implementedAt,
      sources: link.sources,
    })),
  };
}

function buildPharusProfiles(pharusPayload) {
  const profiles = new Map();
  for (const row of pharusPayload?.rows || []) {
    const uid = String(row.userId || row.user_id || "");
    if (!uid) continue;
    profiles.set(uid, {
      name: row.userName || row.name || null,
      email: row.userEmail || row.email || null,
      cpf: row.userCpf || row.cpf || null,
      phone: row.userPhone || row.phone || null,
    });
  }
  for (const [userId, account] of Object.entries(pharusPayload?.accountsById || {})) {
    const uid = String(userId);
    const cur = profiles.get(uid) || {};
    profiles.set(uid, {
      name: account.name || cur.name || null,
      email: account.email || cur.email || null,
      cpf: cur.cpf || null,
      phone: cur.phone || null,
    });
  }
  return profiles;
}

function extractPharusLinks(pharusPayload, mechanismCrosswalk) {
  const linksByUser = new Map();
  for (const row of pharusPayload?.rows || []) {
    const userId = String(row.userId || row.user_id || "");
    const mechanismName = row.mechanismName || row.name || row.label || "Não informado";
    const mechanismId = row.mechanismId || row.mechanism_id || null;
    const canonical = mechanismCrosswalk.resolvePharus(mechanismName, mechanismId);
    const status = mapPharusStatus(row.status);
    const implementedAt = pharusImplementedAt(row, status);
    const link = buildNormalizedLink({
      canonicalClientId: userId,
      canonicalMechanismId: canonical.canonicalId,
      canonicalMechanismName: canonical.canonicalName,
      status,
      dimension: row.category || row.market || "Não informado",
      implementedAt,
      sources: ["app_pharus"],
      pharusLinkId: row.linkId || row.id || null,
    });
    if (!linksByUser.has(userId)) linksByUser.set(userId, []);
    linksByUser.get(userId).push(link);
  }
  return linksByUser;
}

export function consolidateMechanismsPayload({
  baseQvPayload,
  pharusPayload = null,
  clientsRaw = [],
  now = new Date(),
} = {}) {
  const baseClients = baseQvPayload?.clients || [];
  const baseCatalog = baseQvPayload?.catalog || [];
  const pharusCatalog = (pharusPayload?.catalogRows || pharusPayload?.catalog || []).map((item) => ({
    id: String(item.id),
    name: item.name || item.label || item.id,
  }));

  const mechanismCrosswalk = buildMechanismCrosswalk(baseCatalog, pharusCatalog);
  const qvClientIdsWithMechanisms = new Set(baseClients.map((c) => String(c.clientId)));

  const pharusProfiles = pharusPayload ? buildPharusProfiles(pharusPayload) : new Map();
  const crosswalk = buildPharusClientCrosswalk(clientsRaw, pharusProfiles);
  const pharusUserIds = pharusPayload
    ? new Set([...(pharusPayload.rows || []).map((r) => String(r.userId || r.user_id || "")).filter(Boolean)])
    : new Set();

  const clientAudit = pharusPayload
    ? auditPharusClientCrosswalk(crosswalk, {
        qvClientIdsWithMechanisms,
        pharusUserIdsWithMechanisms: pharusUserIds,
      })
    : {
        ...auditPharusClientCrosswalk(crosswalk, {
          qvClientIdsWithMechanisms,
          pharusUserIdsWithMechanisms: new Set(),
        }),
        consolidationMode: "partial",
        pharusUsersWithMechanisms: null,
      };

  const consolidatedLinks = new Map();
  let baseQvLinkCount = 0;
  for (const client of baseClients) {
    const canonicalClientId = String(client.clientId);
    for (const mech of client.mechanisms || []) {
      baseQvLinkCount += 1;
      const canonical = mechanismCrosswalk.resolveBaseQv(mech.name);
      const link = buildNormalizedLink({
        canonicalClientId,
        canonicalMechanismId: canonical.canonicalId,
        canonicalMechanismName: canonical.canonicalName,
        status: mech.status,
        dimension: mech.dimension,
        implementedAt: mech.implementedAt,
        sources: ["base_qv"],
        baseQvLinkId: mech.mechanismId,
      });
      const key = `${canonicalClientId}|${canonical.canonicalId}`;
      if (consolidatedLinks.has(key)) consolidatedLinks.set(key, mergeLink(consolidatedLinks.get(key), link));
      else consolidatedLinks.set(key, link);
    }
  }

  let pharusLinkCount = 0;
  const pharusLinksByUser = pharusPayload ? extractPharusLinks(pharusPayload, mechanismCrosswalk) : new Map();
  for (const [userId, userLinks] of pharusLinksByUser.entries()) {
    pharusLinkCount += userLinks.length;
    const { canonicalClientId } = canonicalClientIdForPharusUser(userId, crosswalk);

    for (const link of userLinks) {
      const key = `${canonicalClientId}|${link.mechanismId}`;
      const normalized = { ...link, canonicalClientId };
      if (consolidatedLinks.has(key)) consolidatedLinks.set(key, mergeLink(consolidatedLinks.get(key), normalized));
      else consolidatedLinks.set(key, normalized);
    }
  }

  const baseClientMap = new Map(baseClients.map((c) => [String(c.clientId), c]));
  const clientsByCanonical = new Map();
  for (const link of consolidatedLinks.values()) {
    const id = link.canonicalClientId || link.linkKey.split("|")[0];
    if (!clientsByCanonical.has(id)) clientsByCanonical.set(id, []);
    clientsByCanonical.get(id).push(link);
  }

  const consolidatedClients = [];
  for (const [canonicalClientId, links] of clientsByCanonical.entries()) {
    const baseRow = baseClientMap.get(canonicalClientId) || null;
    if (!baseRow && canonicalClientId.startsWith("pharus:")) {
      const userId = canonicalClientId.replace(/^pharus:/, "");
      const profile = pharusProfiles.get(userId) || {};
      consolidatedClients.push(
        rollupClientRow(
          canonicalClientId,
          links,
          {
            clientId: canonicalClientId,
            clientCode: null,
            clientName: profile.name || "Usuário App Pharus",
            engineer: "Não informado",
            segment: "Dados insuficientes",
            analyticalStatus: "Não informado",
            program: "Pharus",
          },
        ),
      );
      continue;
    }
    consolidatedClients.push(rollupClientRow(canonicalClientId, links, baseRow));
  }

  const duplicateCrossSource = Math.max(0, baseQvLinkCount + pharusLinkCount - consolidatedLinks.size);
  const consolidatedLinkCount = consolidatedLinks.size;
  const consolidatedClientCount = consolidatedClients.length;

  const linkAudit = {
    baseQvLinks: baseQvLinkCount,
    pharusLinks: pharusLinkCount,
    rawSum: baseQvLinkCount + pharusLinkCount,
    overlapRemoved: duplicateCrossSource,
    consolidatedLinks: consolidatedLinkCount,
  };

  const clientTotals = {
    baseQv: clientAudit.qvClientsWithMechanisms,
    appPharus: clientAudit.pharusUsersWithMechanisms,
    rawSum: clientAudit.rawSum,
    overlapRemoved: Math.max(0, clientAudit.rawSum - clientAudit.consolidatedUniquePeople),
    consolidated: clientAudit.consolidatedUniquePeople,
    matchedInBoth: clientAudit.matchedInBoth,
    baseQvOnly: clientAudit.baseQvOnly,
    unmatchedAppPharus: clientAudit.unmatchedAppPharus,
    ambiguous: clientAudit.ambiguous,
    consolidatedUniquePeople: clientAudit.consolidatedUniquePeople,
    consolidationMode: clientAudit.consolidationMode,
    formulaValidated: clientAudit.formulaValidated,
  };

  const implementedLinks = [...consolidatedLinks.values()].filter((l) => l.status === "Implementado").length;
  const inProgressLinks = [...consolidatedLinks.values()].filter((l) => l.status === "Em andamento").length;

  const implementationAudit = {
    baseQvImplemented: baseClients.reduce((sum, c) => sum + (c.implemented || 0), 0),
    pharusImplemented: [...(pharusPayload?.rows || [])].filter((r) => mapPharusStatus(r.status) === "Implementado").length,
    consolidatedImplemented: implementedLinks,
    consolidatedInProgress: inProgressLinks,
  };

  const typeAudit = {
    baseQvCatalog: baseCatalog.length,
    pharusCatalog: pharusCatalog.length,
    rawSum: baseCatalog.length + pharusCatalog.length,
    consolidatedCatalog: mechanismCrosswalk.canonicalCatalog.length,
    overlapRemoved: baseCatalog.length + pharusCatalog.length - mechanismCrosswalk.canonicalCatalog.length,
  };

  const pharusAudit = pharusPayload ? computePharusMechanismAudit(pharusPayload.rows || []) : null;
  const baseQvAudit = baseQvPayload?.metadata?.baseQvAudit || null;

  const clientsWithImplementedMechanism = consolidatedClients.filter((c) =>
    (c.mechanisms || []).some((m) => m.status === "Implementado"),
  ).length;

  const pharusHasEligibleDenominator = pharusPayload?.summary?.totalSuggestions > 0;
  const temporalScope = {
    baseQvUsesImplementedAt: true,
    pharusCreatedAtValidForImplementation: PHARUS_CREATED_AT_VALID_FOR_IMPLEMENTATION,
    note: PHARUS_CREATED_AT_VALID_FOR_IMPLEMENTATION
      ? "Histórico temporal consolidado inclui BASE QV (implemented_at) e App Pharus (created_at validado)."
      : "Histórico temporal e implementações recentes usam somente BASE QV (implemented_at). App Pharus não entra em métricas temporais até validação semântica de created_at.",
  };
  const implementationPercentScope = {
    chosen: "clients_with_implemented_over_clients_with_mechanisms",
    primaryLabel: "Clientes com mecanismo implementado ÷ clientes com mecanismos",
    primaryNumerator: clientsWithImplementedMechanism,
    primaryDenominator: clientAudit.consolidatedUniquePeople ?? consolidatedClientCount,
    alternativeLabel: "Vínculos implementados ÷ vínculos disponíveis",
    alternativeNumerator: implementedLinks,
    alternativeDenominator: consolidatedLinkCount,
    note:
      "Percentual principal (métrica A): clientes com ≥1 implementado ÷ clientes com mecanismo. Métrica B (vínculos) disponível em implementationPercentLinks.",
    pharusEligibleEquivalent: pharusHasEligibleDenominator,
  };

  return {
    generatedAt: baseQvPayload?.generatedAt || new Date().toISOString(),
    defaultStatusFilter: baseQvPayload?.defaultStatusFilter || "active",
    catalog: mechanismCrosswalk.canonicalCatalog.map((item) => ({
      id: item.id,
      name: item.name,
      dimension: "Consolidado",
    })),
    portfolio: baseQvPayload?.portfolio || [],
    clients: consolidatedClients,
    metadata: {
      dimension: baseQvPayload?.metadata?.dimension || "categoria",
      hiddenMetrics: baseQvPayload?.metadata?.hiddenMetrics || [],
      retroactiveNote: baseQvPayload?.metadata?.retroactiveNote || "",
      sources: pharusPayload ? ["BASE QV", "App Pharus"] : ["BASE QV"],
      pharusConsulted: Boolean(pharusPayload),
      pharusNote: pharusPayload
        ? "Clientes e mecanismos deduplicados entre BASE QV e App Pharus quando há correspondência segura."
        : baseQvPayload?.metadata?.pharusNote,
      consolidated: true,
      consolidationQuality: {
        clients: clientAudit,
        links: linkAudit,
        mechanisms: typeAudit,
        baseQv: baseQvAudit,
        appPharus: pharusAudit,
        temporalScope,
        totals: {
          clients: {
            ...clientTotals,
            clientsWithImplementedMechanism,
          },
          links: {
            ...linkAudit,
            implementedLinks,
          },
          types: typeAudit,
          implemented: implementationAudit,
        },
        mechanismCrosswalk: mechanismCrosswalk.diagnostic,
        ambiguousClientMatches: clientAudit.ambiguousMatches,
        implementationPercentScope,
      },
    },
    timing: baseQvPayload?.timing || null,
  };
}

export { STATUS_PRIORITY, mapPharusStatus, mergeLink };
