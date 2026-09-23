import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { matchesAnalyticalStatusFilter } from "../lib/analytics/analytical-cancellation.mjs";
import { loadMechanismsSatisfactionDataset, mechanismSlugFromName } from "../lib/analytics/mechanisms-satisfaction-dataset.mjs";
import { filterWideClients } from "../lib/analytics/internal-mechanisms-satisfaction-filters.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function parseEnvFile(p) {
  if (!existsSync(p)) return {};
  const t = readFileSync(p, "utf8");
  const o = {};
  for (const line of t.split(/\r?\n/)) {
    let x = line.trim();
    if (!x || x.startsWith("#")) continue;
    const eq = x.indexOf("=");
    if (eq < 1) continue;
    o[x.slice(0, eq).trim()] = x.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return o;
}
for (const [k, v] of Object.entries({ ...parseEnvFile(join(ROOT, ".env")), ...parseEnvFile(join(ROOT, ".env.local")) })) {
  process.env[k] = v;
}

const ds = await loadMechanismsSatisfactionDataset();
const activeWide = filterWideClients(ds.wideClients, { status: "active" });
for (const name of ["Autoconstrução", "QVRA11", "Trava de Inflação", "ALABAMA"]) {
  const slug = mechanismSlugFromName(name);
  const field = `implemented_${slug}`;
  const a = activeWide.filter((c) => c[field]).length;
  const all = ds.wideClients.filter((c) => c[field]).length;
  const nps = activeWide.filter((c) => c[field] && c.latestNps != null).length;
  console.log(name, { activeWideWithMech: a, allWideWithMech: all, activeWideWithMechAndNps: nps });
}
