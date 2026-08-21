import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
for (const name of [".env"]) {
  const path = join(ROOT, name);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    const k = t.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
delete process.env.PHARUS_SUPABASE_SERVICE_ROLE_KEY;

const v1 = await import(pathToFileURL(resolve(ROOT, "../analytics_jornada_cliente/analytics_jornada_cliente/netlify/functions/_shared/env.mjs")).href);

for (const schema of ["core", "public", "metrics"]) {
  const c = v1.getPharusSupabaseClient({ schema });
  for (const table of ["mechanisms", "user_mechanisms", "events"]) {
    try {
      const p = await c.rest(table, { select: "id", limit: 1, countExact: true });
      console.log(`${schema}.${table} HTTP=${p.status} ok=${p.ok} total=${p.total} rows=${p.data.length}${p.ok ? "" : " err=" + (p.raw || "").slice(0, 100)}`);
    } catch (e) {
      console.log(`${schema}.${table} ERR ${e.message}`);
    }
  }
}
