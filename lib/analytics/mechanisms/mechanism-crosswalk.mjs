/**
 * Crosswalk versionável de nomes de mecanismos BASE QV ↔ App Pharus.
 * Somente EXACT, NORMALIZED_EXACT e MANUAL_ALIAS validados entram na consolidação automática.
 */
import { foldToken } from "../mechanism-metrics.mjs";
import {
  mechanismNamesExact,
  mechanismNamesNormalizedExact,
  mechanismNamesProbablyRelated,
  normalizeMechanismName,
} from "./mechanism-name.mjs";

/** Aliases validados manualmente — expandir conforme revisão de Inteligência. */
export const MECHANISM_MANUAL_CROSSWALK = [
  {
    canonical: "Leilão Serial",
    baseQvAliases: ["Leilão Serial (Flipping de Leilão)"],
    pharusAliases: ["Leilão Serial"],
    pharusIds: ["serial-auction"],
  },
];

export const MECHANISM_MATCH_DECISION = Object.freeze({
  EXACT: "EXACT",
  NORMALIZED_EXACT: "NORMALIZED_EXACT",
  MANUAL_ALIAS: "MANUAL_ALIAS",
  PROBABLE: "PROBABLE",
  DISTINCT: "DISTINCT",
});

function slugify(name) {
  const token = normalizeMechanismName(name) || foldToken(name) || "nao-informado";
  return token.replace(/\s+/g, "-").slice(0, 80);
}

function buildManualMaps(entries = MECHANISM_MANUAL_CROSSWALK) {
  const qvToCanonical = new Map();
  const pharusToCanonical = new Map();
  const pharusIdToCanonical = new Map();
  const canonicalEntries = [];

  for (const entry of entries) {
    const canonicalId = `canon:${slugify(entry.canonical)}`;
    const canonicalName = entry.canonical;
    canonicalEntries.push({
      canonicalId,
      canonicalName,
      baseQvAliases: entry.baseQvAliases || [],
      pharusAliases: entry.pharusAliases || [],
      pharusIds: entry.pharusIds || [],
      decision: MECHANISM_MATCH_DECISION.MANUAL_ALIAS,
    });
    for (const alias of entry.baseQvAliases || []) {
      qvToCanonical.set(foldToken(alias), { canonicalId, canonicalName, decision: MECHANISM_MATCH_DECISION.MANUAL_ALIAS });
    }
    for (const alias of entry.pharusAliases || []) {
      pharusToCanonical.set(foldToken(alias), { canonicalId, canonicalName, decision: MECHANISM_MATCH_DECISION.MANUAL_ALIAS });
    }
    for (const pharusId of entry.pharusIds || []) {
      pharusIdToCanonical.set(foldToken(pharusId), { canonicalId, canonicalName, decision: MECHANISM_MATCH_DECISION.MANUAL_ALIAS });
    }
    qvToCanonical.set(foldToken(canonicalName), { canonicalId, canonicalName, decision: MECHANISM_MATCH_DECISION.MANUAL_ALIAS });
    pharusToCanonical.set(foldToken(canonicalName), { canonicalId, canonicalName, decision: MECHANISM_MATCH_DECISION.MANUAL_ALIAS });
  }

  return { qvToCanonical, pharusToCanonical, pharusIdToCanonical, canonicalEntries };
}

function assignAutoCanonical(sourceMap, name, sourceId, autoCanonicals) {
  const key = foldToken(name);
  if (sourceMap.has(key)) return sourceMap.get(key);

  const normalized = normalizeMechanismName(name);
  const autoKey = `${sourceId}:${normalized || key}`;
  if (!autoCanonicals.has(autoKey)) {
    autoCanonicals.set(autoKey, {
      canonicalId: `canon:${sourceId}:${slugify(name)}`,
      canonicalName: String(name || "Não informado").trim(),
      decision: MECHANISM_MATCH_DECISION.DISTINCT,
    });
  }
  const entry = autoCanonicals.get(autoKey);
  sourceMap.set(key, entry);
  return entry;
}

/**
 * @param {{ id: string, name: string }[]} baseQvCatalog
 * @param {{ id: string, name: string }[]} pharusCatalog
 */
export function buildMechanismCrosswalk(baseQvCatalog = [], pharusCatalog = []) {
  const { qvToCanonical, pharusToCanonical, pharusIdToCanonical, canonicalEntries } = buildManualMaps();
  const autoCanonicals = new Map();
  const diagnosticRows = [];
  const usedQv = new Set();
  const usedPharus = new Set();

  for (const manual of canonicalEntries) {
    for (const qvName of manual.baseQvAliases) usedQv.add(foldToken(qvName));
    for (const phName of manual.pharusAliases) usedPharus.add(foldToken(phName));
    if (manual.pharusAliases.length && manual.baseQvAliases.length) {
      diagnosticRows.push({
        baseQv: manual.baseQvAliases[0],
        appPharus: manual.pharusAliases[0],
        score: "manual",
        decision: MECHANISM_MATCH_DECISION.MANUAL_ALIAS,
        canonicalName: manual.canonicalName,
      });
    }
  }

  for (const qv of baseQvCatalog) {
    const qvName = qv.name || qv.id;
    const qvKey = foldToken(qvName);
    if (qvToCanonical.has(qvKey)) continue;

    let matched = null;
    for (const ph of pharusCatalog) {
      const phName = ph.name || ph.id;
      const phKey = foldToken(phName);
      if (usedPharus.has(phKey)) continue;

      if (mechanismNamesExact(qvName, phName)) {
        matched = { ph, decision: MECHANISM_MATCH_DECISION.EXACT, score: "100%" };
      } else if (mechanismNamesNormalizedExact(qvName, phName)) {
        matched = { ph, decision: MECHANISM_MATCH_DECISION.NORMALIZED_EXACT, score: "normalizado" };
      }

      if (matched && matched.decision !== MECHANISM_MATCH_DECISION.DISTINCT) {
        const canonicalId = `canon:${slugify(qvName.length <= phName.length ? qvName : phName)}`;
        const canonicalName = qvName.length <= phName.length ? qvName : phName;
        const entry = { canonicalId, canonicalName, decision: matched.decision };
        qvToCanonical.set(qvKey, entry);
        pharusToCanonical.set(phKey, entry);
        usedQv.add(qvKey);
        usedPharus.add(phKey);
        diagnosticRows.push({
          baseQv: qvName,
          appPharus: phName,
          score: matched.score,
          decision: matched.decision,
          canonicalName,
        });
        break;
      }
    }
  }

  for (const qv of baseQvCatalog) {
    assignAutoCanonical(qvToCanonical, qv.name || qv.id, `qv-${qv.id}`, autoCanonicals);
  }
  for (const ph of pharusCatalog) {
    assignAutoCanonical(pharusToCanonical, ph.name || ph.id, `ph-${ph.id}`, autoCanonicals);
  }

  const exclusiveBaseQv = [];
  const exclusivePharus = [];
  const probablePairs = [];

  for (const qv of baseQvCatalog) {
    const qvName = qv.name || qv.id;
    const qvKey = foldToken(qvName);
    if (usedQv.has(qvKey)) continue;

    let probable = null;
    for (const ph of pharusCatalog) {
      const phName = ph.name || ph.id;
      if (usedPharus.has(foldToken(phName))) continue;
      if (mechanismNamesProbablyRelated(qvName, phName)) {
        probable = { baseQv: qvName, appPharus: phName, score: "revisar", decision: MECHANISM_MATCH_DECISION.PROBABLE };
        break;
      }
    }
    if (probable) probablePairs.push(probable);
    else exclusiveBaseQv.push(qvName);
  }

  for (const ph of pharusCatalog) {
    const phKey = foldToken(ph.name || ph.id);
    if (usedPharus.has(phKey)) continue;
    if (probablePairs.some((p) => foldToken(p.appPharus) === phKey)) continue;
    exclusivePharus.push(ph.name || ph.id);
  }

  const canonicalCatalogMap = new Map();
  for (const entry of [...qvToCanonical.values(), ...pharusToCanonical.values()]) {
    if (!canonicalCatalogMap.has(entry.canonicalId)) {
      canonicalCatalogMap.set(entry.canonicalId, {
        id: entry.canonicalId,
        name: entry.canonicalName,
        decision: entry.decision,
      });
    }
  }

  return {
    resolveBaseQv(name) {
      return qvToCanonical.get(foldToken(name)) || assignAutoCanonical(qvToCanonical, name, "qv-auto", autoCanonicals);
    },
    resolvePharus(name, mechanismId = null) {
      const idKey = foldToken(mechanismId);
      if (idKey && pharusIdToCanonical.has(idKey)) return pharusIdToCanonical.get(idKey);
      return pharusToCanonical.get(foldToken(name)) || assignAutoCanonical(pharusToCanonical, name, "ph-auto", autoCanonicals);
    },
    canonicalCatalog: [...canonicalCatalogMap.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    diagnostic: {
      confirmed: diagnosticRows.filter((r) => r.decision !== MECHANISM_MATCH_DECISION.PROBABLE),
      probable: probablePairs,
      exclusiveBaseQv: exclusiveBaseQv.sort((a, b) => a.localeCompare(b, "pt-BR")),
      exclusivePharus: exclusivePharus.sort((a, b) => a.localeCompare(b, "pt-BR")),
      rows: [...diagnosticRows, ...probablePairs],
    },
    manualEntries: canonicalEntries,
  };
}
