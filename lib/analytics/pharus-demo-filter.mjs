import { pharusRestFetchAll } from "../data/pharus-rest.mjs";

const DEMO_EMAIL = /@demo\.com(?:$|\b)/i;
let identitiesPromise = null;

export function isPharusDemoEmail(value) {
  return DEMO_EMAIL.test(String(value || "").trim());
}

export function pharusRowEmail(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return row?.email || row?.alternative_email || row?.user_email || metadata.email || metadata.user_email || "";
}

export function filterPharusDemoRows(rows, identities, userIdFields = ["user_id", "userId", "client_id"]) {
  const demoIds = identities?.userIds || new Set();
  const demoEmails = identities?.emails || new Set();
  return (rows || []).filter((row) => {
    const email = String(pharusRowEmail(row) || "").trim().toLowerCase();
    if (email && (isPharusDemoEmail(email) || demoEmails.has(email))) return false;
    return !userIdFields.some((field) => {
      const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const id = row?.[field] ?? metadata?.[field];
      return id != null && demoIds.has(String(id));
    });
  });
}

async function loadDemoIdentitiesFromCoreTables(warnings = []) {
  const userIds = new Set();
  const emails = new Set();
  const sources = [];

  for (const [table, select] of [
    ["personal_info", "user_id,alternative_email"],
    ["pre_registrations", "user_id,email"],
  ]) {
    try {
      const rows = await pharusRestFetchAll(table, select, { schema: "core", maxRows: 200_000 });
      sources.push(`core.${table}`);
      for (const row of rows) {
        const email = String(row.email || row.alternative_email || "").trim().toLowerCase();
        if (isPharusDemoEmail(email)) {
          if (row.user_id) userIds.add(String(row.user_id));
          if (email) emails.add(email);
        }
      }
    } catch (error) {
      warnings.push({
        code: "PHARUS_DEMO_FILTER_PARTIAL",
        severity: "warning",
        message: `Filtro @demo.com parcial: core.${table} indisponível (${error instanceof Error ? error.message : String(error)}).`,
      });
    }
  }

  return { userIds, emails, available: sources.length > 0, sources };
}

/** Identidades demo via tabelas core expostas — nunca auth.users. */
export async function fetchPharusDemoIdentities(warnings = []) {
  if (identitiesPromise) return identitiesPromise;
  identitiesPromise = loadDemoIdentitiesFromCoreTables(warnings).catch((error) => {
    identitiesPromise = null;
    warnings.push({
      code: "PHARUS_DEMO_FILTER_PARTIAL",
      severity: "warning",
      message: `Filtro @demo.com parcial: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { userIds: new Set(), emails: new Set(), available: false, sources: [] };
  });
  return identitiesPromise;
}

function isCorporateEmail(value) {
  return String(value || "").trim().toLowerCase().endsWith("@quartavia.com.br");
}

/** Exclui corporativo/demo somente quando e-mail está disponível no diretório. */
export function shouldExcludePharusUser(userId, directoryEntry) {
  const email = String(directoryEntry?.email || "").trim().toLowerCase();
  if (!email) return { exclude: false, reason: null };
  if (isCorporateEmail(email)) return { exclude: true, reason: "corporate_email" };
  if (isPharusDemoEmail(email)) return { exclude: true, reason: "demo_email" };
  return { exclude: false, reason: null };
}
