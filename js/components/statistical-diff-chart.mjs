/**
 * Gráfico V1 — Diferença entre ativos e cancelados (duas barras por variável).
 */
import { escapeHtml } from "../general-charts.mjs";

export const SC_DIFF_UNIT_OPTIONS = [
  { value: "time", label: "Tempo / dias" },
  { value: "meetings", label: "Reuniões" },
  { value: "money", label: "Financeiro" },
  { value: "nps", label: "NPS" },
  { value: "mech", label: "Mecanismos" },
];

const UNIT_REGEX = {
  time: /dia|perman|intervalo|tenure|stay|since|until/i,
  meetings: /reuni|meeting|no-?show|remarc/i,
  money: /renda|reserva|aporte|patrim|líquid|liquid|valor|income/i,
  nps: /nps|nota/i,
  mech: /mecan|implement/i,
};

export function formatScValue(id, label, value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const v = Number(value);
  const key = `${id || ""} ${label || ""}`.toLowerCase();
  if (/renda|reserva|aporte|patrim|líquid|liquid|valor|income|liquidity|contribution|properties/.test(key)) {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  }
  if (/taxa|percent|presença|presenca|implementationpercent|attendance/.test(key)) {
    const pctVal = Math.abs(v) <= 1.0001 ? v * 100 : v;
    return `${pctVal.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  }
  if (/nps|nota/.test(key)) return v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  if (/dia|perman|intervalo|tenure|stay|since|until/.test(key)) {
    return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} dias`;
  }
  if (/reuni|meeting/.test(key)) {
    return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} reuniões`;
  }
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

function filterDiffRows(rows, unit = "time") {
  const re = UNIT_REGEX[unit] || UNIT_REGEX.time;
  return (rows || [])
    .filter((d) => {
      const medA = d.medianActive ?? d.activeMedian ?? d.median0;
      const medC = d.medianCancelled ?? d.cancelledMedian ?? d.median1;
      return medA != null && medC != null && re.test(`${d.id || ""} ${d.label || ""}`);
    })
    .slice(0, 10);
}

function pctLabel(value, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: digits })}%`;
}

/**
 * @param {object[]} rows activeVsCancelled
 * @param {string} unit
 * @param {object} meta { summary, population }
 */
export function renderActiveCancelledDiffChart(rows, unit = "time", meta = {}) {
  const list = filterDiffRows(rows, unit);
  if (!list.length) {
    return `<p class="placeholder-note">Sem variáveis neste grupo de unidade para o gráfico.</p>`;
  }

  const nA = Math.max(...list.map((d) => Number(d.nActive ?? d.activeN ?? 0)));
  const nC = Math.max(...list.map((d) => Number(d.nCancelled ?? d.cancelledN ?? 0)));
  const covs = list.map((d) => Number(d.coveragePercent ?? d.coverage)).filter(Number.isFinite);
  const covMed = covs.length ? covs.reduce((a, b) => a + b, 0) / covs.length : null;
  const vals = list.flatMap((d) => [
    Number(d.medianActive ?? d.activeMedian),
    Number(d.medianCancelled ?? d.cancelledMedian),
  ]);
  const maxV = Math.max(...vals.map((v) => Math.abs(v)), 1);

  const sampleNote = `<p class="note-muted sc-diff-meta" id="scDiffSampleNote">
    Base válida: ${(nA || 0) + (nC || 0)} comparações · Ativos n=${(nA || meta.summary?.activeClients || 0).toLocaleString("pt-BR")}
    · Cancelados n=${(nC || meta.summary?.confirmedCancellations || 0).toLocaleString("pt-BR")}
    ${covMed != null ? ` · Cobertura média do indicador: ${pctLabel(covMed)}` : ""}
  </p>`;

  const legend = `<div class="sc-diff-legend" aria-label="Legenda do gráfico">
    <span><i class="sc-diff-swatch sc-diff-swatch--active"></i> Ativos — mediana do grupo</span>
    <span><i class="sc-diff-swatch sc-diff-swatch--cancelled"></i> Cancelados — mediana do grupo</span>
    <span class="note-muted">Barra maior = valor típico maior na variável · unidade: ${escapeHtml(SC_DIFF_UNIT_OPTIONS.find((o) => o.value === unit)?.label || unit)}</span>
  </div>`;

  const barRows = list.map((d) => {
    const a = Number(d.medianActive ?? d.activeMedian);
    const c = Number(d.medianCancelled ?? d.cancelledMedian);
    const aLab = formatScValue(d.id, d.label, a);
    const cLab = formatScValue(d.id, d.label, c);
    const aPct = Math.max(4, (Math.abs(a) / maxV) * 100);
    const cPct = Math.max(4, (Math.abs(c) / maxV) * 100);
    return `<div class="sc-diff-row">
      <div class="sc-diff-label" title="${escapeHtml(d.label || d.id || "")}">${escapeHtml(d.label || d.id || "—")}</div>
      <div class="sc-diff-bars">
        <div class="sc-diff-bar-line">
          <span class="sc-diff-bar sc-diff-bar--active" style="width:${aPct}%"></span>
          <span class="sc-diff-bar-value">${escapeHtml(String(aLab))}</span>
        </div>
        <div class="sc-diff-bar-line">
          <span class="sc-diff-bar sc-diff-bar--cancelled" style="width:${cPct}%"></span>
          <span class="sc-diff-bar-value">${escapeHtml(String(cLab))}</span>
        </div>
      </div>
    </div>`;
  }).join("");

  return `${sampleNote}${legend}<div class="sc-diff-chart" id="scDiffChart">${barRows}</div>
    <p class="note-muted" id="scDiffNarration">Compare as barras verdes e vermelhas. Quando a barra vermelha é maior, o valor típico entre cancelados foi maior neste recorte.</p>`;
}
