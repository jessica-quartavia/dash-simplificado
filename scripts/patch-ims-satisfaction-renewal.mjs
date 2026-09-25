import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const path = resolve(root, "js/internal-mechanisms-satisfaction.js");
let s = readFileSync(path, "utf8");

const a = s.indexOf("function renewalProjectionFromPayload");
const b = s.indexOf("function corrColor");
if (a >= 0 && b > a) {
  s = s.slice(0, a) + s.slice(b);
}

const htmlOld = `<section class="section-block">
      <h2>8. Renovação × Mecanismos</h2>
      <div id="imsRenewal"></div>
    </section>
    <section class="section-block">
      <h2>9. Projeção de renovação até o final do ano</h2>
      <div id="imsRenewalProjection"></div>
    </section>
    <section class="section-block">
      <h2>10. Temporalidade — mecanismo antes do NPS</h2>`;

const htmlNew = `<section class="section-block">
      <h2>8. Temporalidade — mecanismo antes do NPS</h2>`;

if (s.includes(htmlOld)) s = s.replace(htmlOld, htmlNew);
s = s.replace(/<h2>11\. Clientes com mecanismo \+ NPS<\/h2>/, "<h2>9. Clientes com mecanismo + NPS</h2>");
s = s.replace(/<h2>12\. Clientes com NPS e sem mecanismo<\/h2>/, "<h2>10. Clientes com NPS e sem mecanismo</h2>");
s = s.replace(/<h2>13\. Clientes por nota de NPS \(todos\)<\/h2>/, "<h2>11. Clientes por nota de NPS (todos)</h2>");

const renderBlock = `$("imsRenewal").innerHTML = \`
    \${renderSectionLead(diag.renewal)}
    \${renderRenewalPopulationNote(p)}
    <div class="ims-subsection"><h3>Com vs sem mecanismo</h3>\${diag.renewal?.hasData ? renderComparisonTable({ table: ren?.table || [] }, "renewal-com-sem") : \`<p class="placeholder-note">Sem tabela — ver motivo acima.</p>\`}</div>
    <div class="ims-subsection"><h3>Renovação por mecanismo</h3><div id="imsRenewalRanking"></div></div>\`;

  $("imsRenewalProjection").innerHTML = renderYearEndRenewalProjection(renewalProjectionFromPayload(p));
  fillProjecaoHorizonteTable(p);
`;

if (s.includes(renderBlock)) s = s.replace(renderBlock, "");

writeFileSync(path, s);
console.log("patched", path);
