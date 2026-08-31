# Referência — Analytics QuartaVia Design

## Tokens (`css/styles.css :root`)

### Cores

```css
--color-black: #0a0a0a;
--color-white: #ffffff;
--color-off-white: #faf8f5;
--color-coral: #e85d3a;        /* primary */
--color-hero: #0f0f0f;
--color-muted: #737373;
--color-border: #e5e5e5;
--color-success: #22a45a;
--color-warning: #d18426;
--color-destructive: #ea6c4c;
--color-gold: #c9a227;          /* assistant only */
```

### Espaçamento

`--space-1` (8px) … `--space-8` (64px) — escala 8pt.

### Raio e sombra

- `--radius-sm: 8px`, `--radius: 12px`, `--radius-pill: 9999px`
- `--shadow-soft`, `--shadow-card`, `--shadow-hover`

### Z-index

`--z-filter-sticky: 40`, `--z-scroll-top: 38`, `--z-assistant-fab: 42`, `--z-modal: 1000`

### Containers

- `--container-max: 1280px`
- `--container-max-wide: 1400px`

## Tipografia

| Uso | Fonte | Peso |
|---|---|---|
| h1–h3, labels, botões | Ubuntu | 500–700 |
| parágrafos, células | Carme | 400 |
| código/mono | SFMono / Menlo | — |

Escala responsiva com `clamp()` nos headings globais.

Classes utilitárias: `.eyebrow`, `.label`, `.text-muted`, `.font-mono`.

## Catálogo de classes

### Layout

| Classe | Função |
|---|---|
| `#portal-root` | Grid app (sidebar + main) |
| `.sidebar`, `.sidebar-nav` | Navegação lateral sticky |
| `.portal-main` | Área de conteúdo |
| `.topbar` | Header com user + menu mobile |
| `.page-filters` | Barra de filtros (sticky opcional) |
| `#page-content` | Conteúdo da página ativa |
| `.section-block` | Seção com margin-bottom padrão |

### KPI

| Classe | Função |
|---|---|
| `.kpi-row` | Grid auto-fit minmax(200px, 1fr) |
| `.kpi-row-primary` | KPIs principais (featured) |
| `.kpi-row-secondary` | KPIs secundários compactos |
| `.kpi-row-compact` | Grid mais denso |
| `.kpi-card` | Card base |
| `.kpi-card-featured` | Barra lateral + shadow-card |
| `.kpi-card-compact` | Menor altura |
| `.kpi-card-highlight` | Valor coral |
| `.kpi-label` | Label uppercase |
| `.kpi-value` | Número grande |
| `.kpi-note` | Subtexto muted |

### Filtros

| Classe | Função |
|---|---|
| `.filter-bar` | Grid de controles |
| `.filter-search` | span 2 colunas |
| `.filter-actions` | Limpar / ações |
| `.filter-semantics` | Nota explicativa |
| `.filter-error` | Erro de período |
| `.filter-shell` | Wrapper com sticky toggle |
| `.date-range-picker` | Período (`.drp-*`) |

### Dados

| Classe | Função |
|---|---|
| `.gd-table` | Tabela padrão |
| `.table-wrap` | Scroll horizontal contido |
| `.table-panel-head` | Título + ação à direita |
| `.pagination` | Paginação de tabela |
| `.badge`, `.badge-active`, `.badge-frozen`, `.badge-cancelled` | Status cliente |

### Gráficos

| Classe | Função |
|---|---|
| `.chart-grid` | 2 colunas responsivas |
| `.chart-grid-three` | 3 colunas |
| `.chart-card` | Card de gráfico |
| `.chart-card-featured` | Destaque |
| `.chart-card-quiet` | Variante sutil |
| `.placeholder-note` | Empty state |

### Estatísticas (`statistical-crosses.js`)

| Classe | Função |
|---|---|
| `.statistical-page` | Escopo da página |
| `.sc-discoveries` | Grid descobertas |
| `.sc-discovery-card` | Card de insight |
| `.sc-insight` | Bloco editorial expandível |
| `.sc-methodology-banner` | Aviso metodológico topo |
| `.sc-matrix-card` | Heatmap / matriz |
| `.sc-data-details` | `<details>` tabelas auxiliares |

### Auth

| Classe | Função |
|---|---|
| `.auth-card` | Card central login |
| `.btn-google` | OAuth Google |

### Drawer

| Classe | Função |
|---|---|
| `.drawer-backdrop` | Overlay |
| `.drawer` | Painel lateral 420px |

## Padrões JS

### escapeHtml

Import de `js/general-charts.mjs` — obrigatório em templates.

### Formatação

```javascript
const fmt = new Intl.NumberFormat("pt-BR");
const pct = (v) => v == null ? "—" : `${Number(v).toLocaleString("pt-BR")}%`;
```

Datas: `toLocaleDateString("pt-BR", { timeZone: "UTC" })` quando métrica é UTC.

### SPA listeners

```javascript
let contentEventsAbort = null;
function bindContentEvents() {
  contentEventsAbort?.abort();
  contentEventsAbort = new AbortController();
  el.addEventListener("click", handler, { signal: contentEventsAbort.signal });
}
```

### Filtros dinâmicos

```javascript
fillDynamicSelect($("id"), options, "Todos", currentValue);
createFilterChangeHandler({ onChange: () => loadPage({ force: true }) });
```

## Breakpoints (referência)

| Max-width | Efeito típico |
|---|---|
| 640px | Filtros 1 col; padding reduzido |
| 720px | Sidebar overlay; KPI 1 col |
| 768px | Container padding |
| 1100px | KPI/chart grid 1–2 col |
| 1400px+ | container-max-wide |

## Hierarquia visual de KPIs (Dados Gerais)

1. **Primary row**: métricas de carteira (featured + barra lateral)
2. **Secondary row**: compact, sem sombra forte
3. **Highlight**: só para métrica que merece atenção (ex.: ativos)

## Copy guidelines

- Labels de card: substantivos curtos ("Clientes ativos", "Reuniões")
- Notas: fonte ou regra resumida ("BASE QV deduplicada", "updated_at ou created_at")
- Metodologia: "Associação observada, não causalidade"
- Botões expansão: "Ver todas as descobertas" / "Ver menos" / "Ver análise"
- Erro: frase + ação ("Tentar novamente")

## Arquivos fonte

| Arquivo | Conteúdo |
|---|---|
| `css/styles.css` | Reset, tokens, tipografia, botões base |
| `css/layout.css` | Portal, sidebar, topbar, auth |
| `css/components.css` | KPI, filtros, tabelas, páginas específicas |
| `css/assistant.css` | Chat assistente (ouro) |
| `index.html` | Fonts Google, ordem CSS |
| `js/components/filters/*` | Filter bar, date picker, shell |
| `js/general-charts.mjs` | escapeHtml, hBars, donuts |
| `lib/analytics/filters/page-contracts.mjs` | Contratos de filtro por página |
