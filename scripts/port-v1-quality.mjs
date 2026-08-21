/**
 * Porta Qualidade dos Dados V1 → lib/analytics (somente leitura da V1).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const V1 = resolve(ROOT, "..", "analytics_jornada_cliente", "analytics_jornada_cliente");
const V1_FN = join(V1, "netlify", "functions");
const ANALYTICS = join(ROOT, "lib", "analytics");

function patchImports(text) {
  let out = text;
  out = out.replace(/from "\.\/_shared\//g, 'from "./');
  out = out.replace(/from '\.\/_shared\//g, "from './");
  out = out.replace(/from "\.\/support\.mjs"/g, 'from "./support.mjs"');
  out = out.replace(/from "\.\/pharus-mechanisms\.mjs"/g, 'from "./pharus-mechanisms.mjs"');
  out = out.replace(/^import \{ requireCorporateAuth \}[^\n]+\n/m, "");
  out = out.replace(/^import \{ dataConfigurationError \} from "\.\/_shared\/env\.mjs";\n/m, "");
  if (!out.includes('from "../env.mjs"')) {
    out = out.replace(/^import/m, 'import { dataConfigurationError } from "../env.mjs";\nimport');
  }
  out = out.replace(/function configurationError\(\) \{\s*return dataConfigurationError\(\);\s*\}/, "");
  out = out.replace(/configurationError\(\)/g, "dataConfigurationError()");
  return out;
}

function extractComputeFromQuality(text) {
  const start = text.indexOf("export default async (request) => {");
  if (start < 0) throw new Error("quality handler body not found");
  let body = text.slice(start + "export default async (request) => {".length);
  body = body.replace(/^\s*const denied = await requireCorporateAuth\(request\);\s*if \(denied\) return denied;\s*/m, "");
  body = body.replace(/^\s*const configError = dataConfigurationError\(\);\s*if \(configError\) return Response\.json\(\{ error: configError \}, \{ status: 503, headers: \{ "Cache-Control": "no-store" \} \}\);\s*/m, "");
  body = body.replace(/return Response\.json\(\s*\{/m, "return {");
  body = body.replace(/,\s*\{ headers: \{ "Cache-Control": "no-store" \} \}\s*\);\s*};\s*$/m, "};");
  return `export async function computeQualityPayload() {\n${body}\n}\n`;
}

function portFile(src, dest) {
  if (!existsSync(src)) {
    console.error("missing", src);
    process.exitCode = 1;
    return null;
  }
  let text = readFileSync(src, "utf8");
  text = patchImports(text);
  writeFileSync(dest, text, "utf8");
  console.log("ported", dest.replace(ROOT + "\\", "").replace(ROOT + "/", ""));
  return text;
}

mkdirSync(ANALYTICS, { recursive: true });

portFile(join(V1_FN, "support.mjs"), join(ANALYTICS, "support.mjs"));
portFile(join(V1_FN, "pharus-mechanisms.mjs"), join(ANALYTICS, "pharus-mechanisms.mjs"));
const qualityRaw = portFile(join(V1_FN, "quality.mjs"), join(ANALYTICS, "quality.mjs.raw"));

if (qualityRaw) {
  const head = qualityRaw.slice(0, qualityRaw.indexOf("export default async"));
  const compute = extractComputeFromQuality(qualityRaw);
  writeFileSync(join(ANALYTICS, "quality.mjs"), `${patchImports(head)}\n${compute}`, "utf8");
  console.log("built lib/analytics/quality.mjs");
}
