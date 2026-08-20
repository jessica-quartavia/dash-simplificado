/** Renderização segura de mensagens e chips do Assistente. */

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderMarkdown(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";

  const blocks = raw.split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block.split("\n");
      const listLines = lines.filter((line) => /^[-*]\s+/.test(line.trim()));
      if (listLines.length === lines.length && listLines.length > 0) {
        const items = listLines
          .map((line) => `<li>${inlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>`)
          .join("");
        return `<ul class="assistant-md-list">${items}</ul>`;
      }
      return `<p>${lines.map((line) => inlineMarkdown(line)).join("<br>")}</p>`;
    })
    .join("");
}

function inlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  return html;
}

export function buildContextTag(pageLabel) {
  const label = String(pageLabel || "").trim();
  if (!label) return "";
  return `<span class="assistant-tag">${escapeHtml(label)}</span>`;
}

export function buildValidatedNotice(page) {
  if (!page || page.validated_for_v2 !== false) return "";
  return `<p class="assistant-note">Indicador ainda não validado no Dash Kids.</p>`;
}

export function buildAttentionBlock(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  return `<aside class="assistant-attention"><strong>Atenção</strong><span>${escapeHtml(value)}</span></aside>`;
}

export function followUpChips(payload) {
  const intent = payload?.intent;
  const page = payload?.page;
  const label = payload?.matched_metrics?.[0]?.label;
  const chips = [];

  if (label) {
    if (intent !== "rule") chips.push(`Como é calculado ${label}?`);
    if (intent !== "source") chips.push("De onde vem?");
    if (page?.page_label && intent !== "location") {
      chips.push(`Ver em ${page.page_label}`);
    }
  } else {
    chips.push("Quantos clientes ativos temos?");
    chips.push("Qual a taxa de comparecimento?");
  }

  return chips.slice(0, 3);
}

export function buildDebugPanel(payload, meta) {
  const metric = payload?.matched_metrics?.[0]?.metric_id || "—";
  const lines = [
    `metric: ${metric}`,
    `intent: ${payload?.intent || "—"}`,
    `value source: ${meta?.value_source || "—"}`,
    `compute page: ${meta?.compute_page || "—"}`,
    `request_ms: ${meta?.request_ms ?? "—"}`,
    `total_ms: ${meta?.total_ms ?? "—"}`,
  ];
  return `<pre class="assistant-debug" aria-hidden="true">${escapeHtml(lines.join("\n"))}</pre>`;
}

export function loadingLabel(elapsedMs) {
  if (elapsedMs >= 5000) return "Essa análise pode levar alguns segundos.";
  if (elapsedMs >= 2000) return "Consultando os dados...";
  return "Analisando os indicadores...";
}

export function isDebugEnabled(search = "") {
  try {
    const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
    return params.get("assistantDebug") === "1";
  } catch {
    return false;
  }
}
