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

const v1Mod = await import(pathToFileURL(resolve(ROOT, "../analytics_jornada_cliente/analytics_jornada_cliente/netlify/functions/pharus-mechanisms.mjs")).href);
const v2Mod = await import(pathToFileURL(join(ROOT, "lib/analytics/pharus-mechanisms.mjs")).href);
const v1Platform = await import(pathToFileURL(resolve(ROOT, "../analytics_jornada_cliente/analytics_jornada_cliente/netlify/functions/platform-usage.mjs")).href);
const v2Platform = await import(pathToFileURL(join(ROOT, "lib/analytics/platform-usage.mjs")).href);

const v1Mech = await v1Mod.computePharusMechanismsPayload();
const v2Mech = await v2Mod.computePharusMechanismsPayload();
const v2Plat = await v2Platform.computePlatformUsagePayload();

console.log(JSON.stringify({
  mechanisms: {
    v1: { success: v1Mech.success, available: v1Mech.available, users: v1Mech.summary?.usersWithMechanisms, code: v1Mech.code, status: v1Mech.source?.status },
    v2: { success: v2Mech.success, available: v2Mech.available, users: v2Mech.summary?.usersWithMechanisms, code: v2Mech.code, status: v2Mech.source?.status },
  },
  platform: {
    v2: {
      status: v2Plat.status,
      available: v2Plat.available,
      metricsSourceUnavailable: v2Plat.metricsSourceUnavailable,
      eventsLoaded: v2Plat.summary?.eventsLoaded,
      totalUsers: v2Plat.summary?.totalUsers,
      totalLogins: v2Plat.summary?.totalLogins,
      typicalDaysSinceLastAccess: v2Plat.summary?.typicalDaysSinceLastAccess,
      message: v2Plat.message,
      fetchMs: v2Plat.sources?.timing?.fetchMs,
      restRequests: v2Plat.sources?.timing?.restRequests,
      warning: v2Plat.sources?.warnings?.[0]?.message || null,
    },
  },
}, null, 2));
