/**
 * Porta compute modules V1 → lib/analytics (EP, Temporal, Estatística).
 * Somente leitura da V1. Não altera BASE QV.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const V1 = resolve(ROOT, "..", "analytics_jornada_cliente", "analytics_jornada_cliente");
const ANALYTICS = join(ROOT, "lib", "analytics");
const V1_FN = join(V1, "netlify", "functions");
const V1_SHARED = join(V1_FN, "_shared");

const SHARED_FILES = [
  "stats-tests.mjs",
  "correlation-matrix.mjs",
  "cohort-retention.mjs",
  "statistical-discoveries.mjs",
  "sc-axis-matrices.mjs",
  "sc-exploratory-ext.mjs",
  "sc-client-insights.mjs",
  "pharus-demo-filter.mjs",
];

const MAIN_FILES = [
  "ep-performance.mjs",
  "temporal-indicators.mjs",
  "statistical-crosses.mjs",
];

function patchImports(text, { envDepth = "../env.mjs" } = {}) {
  let out = text;
  out = out.replace(/from "\.\/_shared\//g, 'from "./');
  out = out.replace(/from '\.\/_shared\//g, "from './");
  out = out.replace(/from "\.\/general-data\.mjs"/g, 'from "./general-data.mjs"');
  out = out.replace(/from "\.\/meetings\.mjs"/g, 'from "./meetings.mjs"');
  out = out.replace(/from "\.\/mechanisms\.mjs"/g, 'from "./mechanisms.mjs"');
  out = out.replace(/from "\.\/_shared\/env\.mjs"/g, `from "${envDepth}"`);
  out = out.replace(/from "\.\/env\.mjs"/g, `from "${envDepth}"`);
  out = out.replace(/^import \{ requireCorporateAuth \}[^\n]+\n/m, "");
  out = out.replace(/^import \{ dataConfigurationError \} from "\.\/_shared\/env\.mjs";\n/m, "");
  if (!out.includes("dataConfigurationError")) {
    out = out.replace(/^import/m, `import { dataConfigurationError } from "${envDepth}";\nimport`);
  }
  out = out.replace(/\nexport default async[\s\S]*$/m, "\n");
  return out.trimEnd() + "\n";
}

function renameMain(destName, text) {
  const map = {
    "ep-performance.mjs": "ep-performance.mjs",
    "temporal-indicators.mjs": "temporal-indicators.mjs",
    "statistical-crosses.mjs": "statistical-crosses.mjs",
  };
  return text;
}

function portFile(src, dest, opts = {}) {
  if (!existsSync(src)) {
    console.error("missing", src);
    process.exitCode = 1;
    return;
  }
  let text = readFileSync(src, "utf8");
  text = patchImports(text, opts);
  text = renameMain(dest, text);
  writeFileSync(dest, text, "utf8");
  console.log("ported", dest.replace(ROOT + "\\", "").replace(ROOT + "/", ""));
}

mkdirSync(ANALYTICS, { recursive: true });

for (const file of SHARED_FILES) {
  portFile(join(V1_SHARED, file), join(ANALYTICS, file), { envDepth: "../env.mjs" });
}

portFile(join(V1_FN, "ep-performance.mjs"), join(ANALYTICS, "ep-performance.mjs"));
portFile(join(V1_FN, "temporal-indicators.mjs"), join(ANALYTICS, "temporal-indicators.mjs"));
portFile(join(V1_FN, "statistical-crosses.mjs"), join(ANALYTICS, "statistical-crosses.mjs"));

// Public payload helpers
for (const [file, fn] of [
  ["ep-performance.mjs", "EpPerformance"],
  ["temporal-indicators.mjs", "TemporalIndicators"],
  ["statistical-crosses.mjs", "StatisticalCrosses"],
]) {
  const path = join(ANALYTICS, file);
  let text = readFileSync(path, "utf8");
  const computeName = `compute${fn}Payload`;
  if (!text.includes(`export function toPublic${fn}Payload`)) {
    text += `
export function toPublic${fn}Payload(payload) {
  return payload;
}
`;
    writeFileSync(path, text, "utf8");
  }
}

console.log("port complete");
