/**
 * Liga botões "Ver mais" / "Ver menos" em gráficos expandíveis.
 */
export function bindChartExpand(root, state, rerender) {
  if (!root) return () => {};
  const handler = (event) => {
    const btn = event.target.closest("[data-chart-expand]");
    if (!btn || !root.contains(btn)) return;
    const id = btn.dataset.chartExpand;
    if (!id) return;
    state[id] = !state[id];
    rerender(id);
  };
  root.addEventListener("click", handler);
  return () => root.removeEventListener("click", handler);
}

export function renderExpandableChartHost({ chartId, title, subtitle = "", bodyHtml, buttonHtml = "" }) {
  return `<article class="chart-card chart-card--expandable">
    <div class="chart-card-head">
      <div>
        <h3>${title}</h3>
        ${subtitle ? `<p class="chart-card-subtitle">${subtitle}</p>` : ""}
      </div>
      ${buttonHtml}
    </div>
    <div class="chart-card-body" id="${chartId}">${bodyHtml}</div>
  </article>`;
}
