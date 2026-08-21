/**
 * Curva de sobrevivência Kaplan-Meier (visual V1, dados do payload oficial).
 */
import { escapeHtml } from "../general-charts.mjs";

const COMPARE_OPTIONS = [
  { value: "overall", label: "Geral (todos)" },
  { value: "segment", label: "Segmento" },
  { value: "npsClass", label: "Classe NPS" },
  { value: "renewed", label: "Renovado" },
  { value: "hasMeeting", label: "Com reunião" },
  { value: "hasMechanism", label: "Com mecanismo" },
  { value: "hasFinancialData", label: "Com dados financeiros" },
  { value: "engineer", label: "EP" },
];

const PALETTE = ["#f47920", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#ef4444"];

function survivalAt(curve, day) {
  if (!curve?.length) return null;
  let last = curve[0];
  for (const pt of curve) {
    if (Number(pt.time) > day) break;
    last = pt;
  }
  return last;
}

function buildSeries(survival, compare = "overall") {
  const overall = survival?.overall || {};
  const curve = overall.curve || [];
  if (!curve.length) return { series: [], marks: [0, 90, 180, 365, 730], empty: true };

  const marks = [0, 90, 180, 365, 730];
  if (compare === "overall") {
    return {
      series: [{ key: "overall", label: "Geral", color: PALETTE[0], curve }],
      marks,
      overall,
      empty: false,
    };
  }

  const groups = (survival?.groups || []).filter((g) => g.field === compare);
  const picked = groups
    .filter((g) => (g.n || 0) >= 20 && g.curve?.length)
    .sort((a, b) => (b.n || 0) - (a.n || 0))
    .slice(0, 5);

  if (!picked.length) {
    return {
      series: [{ key: "overall", label: "Geral", color: PALETTE[0], curve }],
      marks,
      overall,
      empty: false,
      fallback: true,
    };
  }

  return {
    series: picked.map((g, i) => ({
      key: String(g.level),
      label: String(g.level),
      color: PALETTE[i % PALETTE.length],
      curve: g.curve,
      n: g.n,
    })),
    marks,
    overall,
    empty: false,
  };
}

function renderSvg(series, marks) {
  const allTimes = series.flatMap((s) => s.curve.map((c) => Number(c.time) || 0));
  const maxT = Math.max(...allTimes, 730, 1);
  const w = 920;
  const h = 380;
  const padL = 58;
  const padR = 28;
  const padT = 44;
  const padB = 52;
  const xOf = (t) => padL + (Math.min(t, maxT) / maxT) * (w - padL - padR);
  const yOf = (s) => padT + (1 - s) * (h - padT - padB);

  let paths = "";
  let censorMarks = "";
  let legend = "";

  series.forEach((s) => {
    let d = "";
    s.curve.forEach((pt, i) => {
      const x = xOf(Number(pt.time) || 0);
      const y = yOf(Number(pt.survival) || 0);
      if (i === 0) d += `M ${xOf(0)} ${yOf(1)} L ${x} ${yOf(1)}`;
      const prev = s.curve[i - 1];
      if (prev) d += ` L ${x} ${yOf(Number(prev.survival) || 0)} L ${x} ${y}`;
      else d += ` L ${x} ${y}`;
      if ((pt.censored || 0) > 0) {
        censorMarks += `<line x1="${x}" y1="${y - 5}" x2="${x}" y2="${y + 5}" stroke="${s.color}" stroke-width="1.2" opacity="0.7"/>`;
      }
    });
    paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5" data-series="${escapeHtml(s.key)}"/>`;
    legend += `<span class="sc-survival-legend-item"><i style="background:${s.color}"></i>${escapeHtml(s.label)}${s.n != null ? ` (n=${s.n})` : ""}</span>`;
  });

  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const yGrid = yTicks
    .map(
      (t) =>
        `<line x1="${padL}" y1="${yOf(t)}" x2="${w - padR}" y2="${yOf(t)}" stroke="#e5e5e5" stroke-width="1"/>`
        + `<text x="${padL - 8}" y="${yOf(t) + 4}" text-anchor="end" font-size="11" fill="#666">${Math.round(t * 100)}%</text>`,
    )
    .join("");

  const xTicks = [0, Math.round(maxT / 4), Math.round(maxT / 2), Math.round((3 * maxT) / 4), maxT];
  const xGrid = xTicks
    .map(
      (t) =>
        `<line x1="${xOf(t)}" y1="${padT}" x2="${xOf(t)}" y2="${h - padB}" stroke="#f0f0f0" stroke-width="1"/>`
        + `<text x="${xOf(t)}" y="${h - padB + 18}" text-anchor="middle" font-size="11" fill="#666">${t}</text>`,
    )
    .join("");

  return {
    svg: `<svg class="sc-survival-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Curva de sobrevivência Kaplan-Meier">
      ${yGrid}${xGrid}${censorMarks}${paths}
      <text x="${w / 2}" y="${h - 6}" text-anchor="middle" font-size="12" fill="#444">Dias desde a contratação</text>
      <text x="14" y="${h / 2}" transform="rotate(-90 14 ${h / 2})" text-anchor="middle" font-size="12" fill="#444">Prob. de permanência</text>
    </svg>`,
    legend,
  };
}

function renderAtRiskTable(series, marks) {
  const primary = series[0];
  if (!primary?.curve?.length) return "";
  const cells = marks
    .map((d) => {
      const pt = survivalAt(primary.curve, d);
      return `<td class="num">${pt?.atRisk ?? "—"}</td>`;
    })
    .join("");
  return `<div class="table-wrap sc-at-risk"><table class="gd-table"><thead><tr><th>Tempo (dias)</th>${marks.map((d) => `<th class="num">${d}</th>`).join("")}</tr></thead><tbody><tr><th>Em risco</th>${cells}</tr></tbody></table></div>`;
}

export function renderSurvivalSection(survival, { compare = "overall" } = {}) {
  const built = buildSeries(survival, compare);
  if (built.empty) {
    return `<p class="placeholder-note">Curva indisponível (sem eventos/censuras elegíveis). Cancelados sem data confirmada são excluídos.</p>`;
  }

  const { svg, legend } = renderSvg(built.series, built.marks);
  const overall = built.overall;
  const def = overall.definition || {};
  const lr = survival?.logRank;
  const groupsTable = (survival?.groups || [])
    .slice(0, 30)
    .map(
      (g) => `<tr><td>${escapeHtml(g.field || "—")}</td><td>${escapeHtml(String(g.level ?? "—"))}</td><td class="num">${g.n ?? "—"}</td><td class="num">${g.events ?? "—"}</td><td>${escapeHtml(g.medianSurvival ?? "—")}</td></tr>`,
    )
    .join("");

  const compareOptions = COMPARE_OPTIONS.map(
    (o) => `<option value="${escapeHtml(o.value)}"${o.value === compare ? " selected" : ""}>${escapeHtml(o.label)}</option>`,
  ).join("");

  return `
    <div class="sc-survival-panel" data-survival-panel>
      <p class="sc-matrix-desc">Estimativa Kaplan-Meier de permanência na carteira. Início: ${escapeHtml(def.start || "contratação")}. Evento: ${escapeHtml(def.event || "cancelamento com data")}. Censura: ${escapeHtml(def.censor || "sem cancelamento até hoje")}.</p>
      <p class="note-muted">n início=${overall.nStart ?? "—"} · eventos=${overall.events ?? "—"} · censurados=${overall.censored ?? "—"} · mediana=${escapeHtml(String(overall.medianSurvival ?? "não atingida"))}${built.fallback ? " · comparação indisponível — exibindo curva geral" : ""}</p>
      <div class="sc-survival-controls">
        <label>Comparar por<select id="scSurvivalCompare">${compareOptions}</select></label>
        <button type="button" class="btn btn-secondary btn-sm" data-survival-expand>Expandir curva</button>
      </div>
      <div class="sc-survival-chart-wrap" id="scSurvivalChart">${svg}</div>
      <div class="sc-survival-legend">${legend}</div>
      <h4 class="sc-subheading">Clientes em risco por marco</h4>
      ${renderAtRiskTable(built.series, built.marks)}
      ${lr ? `<p class="note-muted">Log-rank (${escapeHtml(lr.groupA || "")} vs ${escapeHtml(lr.groupB || "")}): χ²=${lr.chi2 ?? "—"} · p=${lr.pValue ?? "—"} · ${escapeHtml(lr.note || "Comparação exploratória.")}</p>` : ""}
      <details class="sc-data-details">
        <summary>Pontos da curva e grupos estratificados</summary>
        <div class="table-wrap"><table class="gd-table"><thead><tr><th>Campo</th><th>Grupo</th><th class="num">n</th><th class="num">Eventos</th><th>Mediana</th></tr></thead><tbody>${groupsTable || `<tr><td colspan="5">Sem grupos adicionais.</td></tr>`}</tbody></table></div>
      </details>
    </div>`;
}

export function bindSurvivalChart(root = document, onCompareChange) {
  const host = root.querySelector?.("#page-content") || root;
  const select = host.querySelector("#scSurvivalCompare");
  if (select && !select.dataset.bound) {
    select.dataset.bound = "1";
    select.addEventListener("change", () => onCompareChange?.(select.value));
  }
  host.querySelectorAll("[data-survival-expand]").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const panel = btn.closest("[data-survival-panel]");
      const chart = panel?.querySelector(".sc-survival-chart-wrap");
      if (!chart) return;
      const overlay = document.createElement("div");
      overlay.className = "matrix-expand-overlay sc-survival-expand-overlay";
      overlay.innerHTML = `
        <div class="matrix-expand-shell sc-survival-expand-shell" role="dialog" aria-modal="true">
          <header class="matrix-expand-head"><strong>Curva de sobrevivência</strong><button type="button" class="btn btn-secondary btn-sm" data-survival-expand-close>Fechar</button></header>
          <div class="matrix-expand-body sc-survival-expand-body"></div>
        </div>`;
      overlay.querySelector(".sc-survival-expand-body")?.appendChild(chart.cloneNode(true));
      document.body.appendChild(overlay);
      const close = () => overlay.remove();
      overlay.querySelector("[data-survival-expand-close]")?.addEventListener("click", close);
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close();
      });
    });
  });
}
