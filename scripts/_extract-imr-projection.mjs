import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(resolve(root, "js/internal-mechanisms-satisfaction.js"), "utf8");
const start = src.indexOf("const fmt1 = new Intl.NumberFormat");
const end = src.indexOf("function fillProjecaoHorizonteTable");
const chunk = src.slice(start, end);
const out = `/** Projeção 31/12 — página Mecanismos × Renovação. */
import { escapeHtml } from "./general-charts.mjs";

const fmt = new Intl.NumberFormat("pt-BR");
${chunk.replace("function renewalProjectionFromPayload", "function _renewalProjectionFromPayloadUnused").replace("function renderRenewalPopulationNote", "function _renderRenewalPopulationNoteUnused")}
export { renderYearEndRenewalProjection, isRenewalProjectionRenderable, renderModelHowToBlock, kpiCard, pctLabel, num1 };
`;
writeFileSync(resolve(root, "js/imr-year-end-projection.mjs"), out);
