/**
 * Diagnóstico read-only/manual do DELETE de relatórios.
 * Uso:
 *   node scripts/diagnose-reports-delete.mjs
 *   node scripts/diagnose-reports-delete.mjs --id=<uuid>
 *
 * Com REPORTS_DELETE_TOKEN=<jwt corporativo> tenta DELETE real (somente se --id informado).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleReportsRequest } from "../lib/analytics/reports-handler.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const reportIdArg = process.argv.find((arg) => arg.startsWith("--id="))?.split("=")[1]?.trim() || "";

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const parsed = {};
  for (const line of readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[trimmed.slice(0, eq).trim()] = value;
  }
  return parsed;
}

for (const [key, value] of Object.entries({
  ...parseEnvFile(join(ROOT, ".env")),
  ...parseEnvFile(join(ROOT, ".env.local")),
})) {
  if (!String(process.env[key] || "").trim()) process.env[key] = value;
}

const sql010 = readFileSync(join(ROOT, "sql/analytics/010_reports_delete_corporate.sql"), "utf8");

console.log(
  JSON.stringify(
    {
      checklist: {
        applySql: "sql/analytics/010_reports_delete_corporate.sql",
        tablePolicy: "FOR DELETE TO authenticated USING (status = 'published')",
        storagePolicy: "bucket analytics-reports + folder reports/",
        anonDelete: "REVOKE DELETE FROM anon",
        handlerOwnershipCheck: "removido — RLS corporativa decide",
      },
      sqlPreview: sql010.split("\n").slice(0, 12).join("\n"),
      liveDelete: reportIdArg
        ? "será tentado abaixo se REPORTS_DELETE_TOKEN estiver definido"
        : "passe --id=<uuid> e REPORTS_DELETE_TOKEN=<jwt> para teste HTTP real",
    },
    null,
    2,
  ),
);

if (!reportIdArg) process.exit(0);

const token = process.env.REPORTS_DELETE_TOKEN || "";
if (!token) {
  console.error("Defina REPORTS_DELETE_TOKEN com JWT corporativo para teste live.");
  process.exit(2);
}

const request = new Request(`http://localhost/api/reports?id=${encodeURIComponent(reportIdArg)}`, {
  method: "DELETE",
  headers: { Authorization: `Bearer ${token}` },
});

const response = await handleReportsRequest(request);
const body = await response.json().catch(() => ({}));
console.log(
  JSON.stringify(
    {
      httpStatus: response.status,
      body,
      ok: response.ok,
    },
    null,
    2,
  ),
);
process.exitCode = response.ok ? 0 : 1;
