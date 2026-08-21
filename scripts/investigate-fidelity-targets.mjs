#!/usr/bin/env node
/**
 * Investigação targeted das divergências — sem auditoria global completa.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAuditEnv, computePagePair } from "../lib/analytics/fidelity-audit.mjs";
import { compareSets } from "../lib/analytics/fidelity-populations.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function mechanismClientIds(payload) {
  return new Set(
    (payload?.clients || [])
      .filter((c) => (c.available || c.mechanismCount || c.totalMechanisms || 0) > 0)
      .map((c) => String(c.clientId || c.id))
      .filter(Boolean),
  );
}

async function investigateMechanismsDelta(v1, v2) {
  const v1Ids = mechanismClientIds(v1);
  const v2BaseIds = new Set(
    (v2?.metadata?.consolidationQuality?.clients?.baseQvClientIds || [])
      .map(String),
  );
  if (!v2BaseIds.size) {
    for (const c of v2?.clients || []) {
      if (c.sources?.includes?.("BASE QV") || !c.sources?.includes?.("App Pharus")) {
        if ((c.available || c.implemented || 0) > 0) v2BaseIds.add(String(c.clientId));
      }
    }
  }
  if (!v2BaseIds.size) {
    const qvOnly = v2?.metadata?.consolidationQuality?.clients?.qvClientsWithMechanisms;
    if (qvOnly != null) {
      for (const c of v2?.clients || []) {
        if (String(c.clientId).match(/^[0-9a-f-]{36}$/i)) v2BaseIds.add(String(c.clientId));
      }
    }
  }

  const v1Base = v1.crossSourceCoverage?.baseQvClients ?? v1.summary?.clientsWithMechanisms;
  const v2Base = v2.metadata?.consolidationQuality?.clients?.qvClientsWithMechanisms
    ?? v2.metadata?.consolidationQuality?.clients?.baseQvOnly;

  const fromV1Payload = new Set(
    (v1?.clients || [])
      .filter((c) => (c.available || 0) > 0)
      .map((c) => String(c.clientId)),
  );

  const baseCompare = compareSets(fromV1Payload.size ? fromV1Payload : v1Ids, fromV1Payload.size ? fromV1Payload : v1Ids);
  if (v2BaseIds.size) {
    Object.assign(baseCompare, compareSets(fromV1Payload.size ? fromV1Payload : v1Ids, v2BaseIds));
  }

  return {
    v1_baseQvCount: v1Base,
    v2_baseQvCount: v2Base,
    v1_crossSource: v1.crossSourceCoverage,
    v2_consolidation: v2.metadata?.consolidationQuality?.clients,
    implemented: v2.metadata?.consolidationQuality?.totals?.implemented,
    baseQvClientSetDiff: baseCompare,
  };
}

async function investigateCrosswalk(v1, v2) {
  const methods = ["shared_id", "linked_user_id", "cpf", "email", "phone", "name"];
  const report = methods.map((match_method) => ({
    match_method,
    v1_source: match_method === "linked_user_id" ? "clients.linked_user_id (V2 only)" : "BASE QV clients + App Pharus personal_info/pre_registrations",
    v2_source: match_method === "linked_user_id"
      ? "clients.linked_user_id + identity-match.mjs"
      : "BASE QV clients + core.personal_info/pre_registrations (anon blocked)",
    available_v1_anon: match_method === "email" ? "partial (App userEmail from mechanisms rows)" : match_method === "shared_id" ? "yes" : "no without personal_info",
    available_v2_anon: match_method === "shared_id" || match_method === "linked_user_id" ? "yes" : "no without personal_info",
    v1_matches: null,
    v2_matches: null,
  }));

  const v1Rows = v1?.crossSourceRows || [];
  const v2Match = v2?.metadata?.consolidationQuality?.clients?.matchMethodCounts || null;
  for (const row of report) {
    row.v1_matches = v1Rows.filter((r) => r.matchMethod === row.match_method && r.matchStatus?.startsWith("matched")).length;
    row.v2_matches = v2Match?.[row.match_method] ?? null;
  }

  return {
    v1_matchedInBoth: v1.crossSourceCoverage?.matchedInBoth,
    v2_matchedInBoth: v2.metadata?.consolidationQuality?.clients?.matchedInBoth,
    historical_note: "34 matches históricos exigiam core.personal_info (CPF/email/phone) acessível via service role",
    methods: report,
    missing_for_34_matches: [
      "core.personal_info (CPF, email alternativo, telefone) — RLS bloqueia anon",
      "core.pre_registrations — idem",
      "auth.users admin API — exige PHARUS_SUPABASE_SERVICE_ROLE_KEY (removida do runner)",
    ],
  };
}

async function investigatePlatform(v2) {
  const rec = v2?.summary?.eventReconciliation || {};
  return {
    eventsLoaded: v2.summary?.eventsLoaded,
    totalLogins: v2.summary?.totalLogins,
    excludedMissingUserId: rec.excludedMissingUserId,
    excludedInvalidTimestamp: rec.excludedInvalidTimestamp,
    excludedNonLoginEvent: rec.excludedNonLoginEvent,
    breakdown: rec,
    explanation: rec.excludedMissingUserId === (v2.summary?.eventsLoaded - v2.summary?.totalLogins)
      ? "100% dos eventos excluídos de totalLogins = sem user_id na view"
      : "ver eventReconciliation",
  };
}

async function main() {
  loadAuditEnv();
  const out = { generatedAt: new Date().toISOString(), sections: {} };

  console.log("Investigando mechanisms...");
  const mech = await computePagePair("mechanisms");
  if (!mech.v1Error && !mech.v2Error) {
    out.sections.mechanisms = {
      ...(await investigateMechanismsDelta(mech.v1, mech.v2)),
      crosswalk: await investigateCrosswalk(mech.v1, mech.v2),
      timing: mech.timing,
    };
  }

  console.log("Investigando journey...");
  const journey = await computePagePair("journey");
  if (!journey.v1Error && !journey.v2Error) {
    const v1c = journey.v1.summary?.completedOnboarding ?? journey.v1.clients?.filter((r) => r.completedOnboarding).length;
    const v2c = journey.v2.summary?.completedOnboarding ?? journey.v2.clients?.filter((r) => r.completedOnboarding).length;
    out.sections.journey = { v1_completed: v1c, v2_completed: v2c, delta: v2c - v1c, timing: journey.timing };
  }

  console.log("Investigando platform_usage...");
  const pu = await computePagePair("platform_usage");
  if (!pu.v2Error) {
    out.sections.platform_usage = {
      v1: pu.v1 ? { summary: pu.v1.summary, auditSources: pu.v1._auditSources, warnings: pu.v1.sources?.warnings } : null,
      v2: { summary: pu.v2.summary },
      investigation: await investigatePlatform(pu.v2),
      timing: pu.timing,
    };
  }

  console.log("Investigando renewal...");
  const rn = await computePagePair("renewal");
  if (!rn.v1Error && !rn.v2Error) {
    out.sections.renewal = {
      v1_source: "V1 _shared/client-cycle-renewal.mjs + clients.ciclo (sem renewal.mjs)",
      v1: rn.v1.summary,
      v2: rn.v2.summary,
      delta_renewed: (rn.v2.summary?.renewedClients ?? 0) - (rn.v1.summary?.renewedClients ?? 0),
      timing: rn.timing,
    };
  }

  const outPath = join(ROOT, "docs/v1-v2-fidelity-investigation.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("Written:", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
