---
name: quartavia-analytics-design
description: >-
  Design system and UI patterns for Analytics QuartaVia (dash-simplificado):
  tokens, layout, KPI cards, filters, tables, charts, SPA pages, pt-BR copy,
  and responsive rules. Use when creating or editing dashboard UI, CSS,
  page layouts, components, visual consistency, accessibility, or mobile
  behavior in this project.
---

# Analytics QuartaVia — Design System

Skill de **UI/conteúdo visual** do projeto `dash-simplificado`. Não redefine regras de negócio nem cálculos.

## Quando aplicar

- Nova página ou seção do dashboard
- Ajustes visuais (cards, filtros, tabelas, gráficos)
- Revisão de consistência com o restante do produto
- Responsividade e estados vazios/erro
- Copy de interface em português

## Princípios

1. **Reutilizar antes de inventar** — classes e helpers existentes em `css/` e `js/components/`.
2. **Tokens CSS** — nunca hardcodar cores/fontes fora de `:root` em `css/styles.css`.
3. **Tom analítico, não marketing** — claro, cauteloso com dados; notas metodológicas onde couber.
4. **Sem frameworks UI** — HTML semântico + CSS vanilla; páginas renderizam strings via JS.
5. **Segurança de markup** — sempre `escapeHtml()` em conteúdo dinâmico.
6. **Sem containers vazios** — ao remover bloco visual, remover título/legenda/espaço reservado junto.
7. **Mobile sem scroll horizontal** — grids empilham; botões `width: 100%` só quando o padrão da página já faz isso.

## Identidade visual

| Elemento | Valor |
|---|---|
| Fundo | `--background` (#faf8f5 off-white) |
| Superfície | `--surface` (#fff) |
| Texto | `--foreground` (#0a0a0a) |
| Primária | `--primary` coral #e85d3a |
| Muted | `--muted` #737373 |
| Borda | `--border` #e5e5e5 |
| Sucesso / alerta | `--color-success`, `--color-warning`, `--color-destructive` |
| Títulos | **Ubuntu** (`--font-heading`) |
| Corpo | **Carme** (`--font-body`) |
| Ouro | `--color-gold` — **somente** assistente (`assistant.css`) |

Detalhes completos: [reference.md](reference.md)

## Anatomia de página (SPA)

Padrão das páginas em `js/*.js`:

```
page-filters (mountPageFilters + renderFilterBar)
page-content
  └─ [optional] nota metodológica (.sc-methodology-banner)
  └─ section.section-block#secId
       h2 — título numerado ("1. Resumo…")
       p.note-muted — lead curto
       .kpi-row — cards
       .chart-grid — gráficos
       .table-wrap > table.gd-table
       details.sc-data-details — dados brutos opcionais
page-actions (refresh/export quando aplicável)
```

Boot: `bootX()` em `js/app.js` → `onPageChange` → `mountX()` → `loadX()` → `renderSuccess()`.

## Componentes obrigatórios

### KPI card

Copiar padrão de `kpiCard()` (ex.: `js/general-data.js`, `js/temporal-indicators.js`):

```javascript
function kpiCard(label, value, note, options = {}) {
  const classes = ["kpi-card"];
  if (options.highlight) classes.push("kpi-card-highlight");
  if (options.compact) classes.push("kpi-card-compact");
  if (options.featured) classes.push("kpi-card-featured");
  return `<article class="${classes.join(" ")}">
    <div class="kpi-label">${escapeHtml(label)}</div>
    <div class="kpi-value">${value}</div>
    ${note ? `<div class="kpi-note">${escapeHtml(note)}</div>` : ""}
  </article>`;
}
```

- **Primários**: `.kpi-row-primary` + `featured: true` (barra lateral preta)
- **Secundários**: `.kpi-row-secondary` + `compact: true`
- **Destaque métrica**: `highlight: true` (valor coral)
- Números: `Intl.NumberFormat("pt-BR")`

### Filtros

- Definir `FILTER_FIELDS` + `defaultXFilters()` em `lib/analytics/*-filters.mjs`
- UI: `mountPageFilters({ pageId, innerHtml: renderFilterBar({ fields, filters }) })`
- Labels de filtro: uppercase 0.75rem (`filter-bar label`)
- Busca placeholder: `"Nome, código ou ID"`
- Período: `kind: "period"` → date-range-picker
- Sticky opcional via `.page-filters.is-sticky-pinned`

### Tabelas

```html
<div class="table-wrap">
  <table class="gd-table">
    <thead><tr><th>…</th><th class="num">…</th></tr></thead>
    <tbody>…</tbody>
  </table>
</div>
```

- Colunas numéricas: `class="num"`
- Status: `.badge.badge-active | .badge-frozen | .badge-cancelled`
- Toolbar: `renderTableToolbar` + export CSV/Excel quando a página já usa

### Gráficos / blocos

- Container: `article.chart-card` ou `.chart-card-featured`
- Grid: `.chart-grid` (2 col) / `.chart-grid-three`
- Sem dado: `<p class="placeholder-note">…</p>` ou `.note-muted`
- Barras horizontais: reutilizar `hBars` / padrões de `general-charts.mjs`

### Botões

| Classe | Uso |
|---|---|
| `.btn.btn-primary` | ação principal (coral) |
| `.btn.btn-secondary` | secundária, toggle, "Ver todas" |
| `.btn.btn-ghost` | ações discretas na toolbar |

Compacto em painéis: `padding: 8px 14px; font-size: 0.8125rem`.

### Seções e copy

- **Eyebrow**: `.eyebrow` — rótulo superior (login, blocos editoriais)
- **Lead**: `.note-muted` ou `.section-lead`
- **Erro inline**: `.page-inline-error`
- **Estado vazio global**: `.gd-status` + botão retry
- **Metodologia estatística**: `renderMethodologyNotice()` / `.sc-methodology-banner`
- **Insights expandíveis**: `renderStatisticalInsightBlock()` — padrão "Ver análise"

Textos de interface: **pt-BR**, frases completas, sem telegráfico.

## Layout global

- `#portal-root`: grid sidebar 260px + main (`css/layout.css`)
- Sidebar sticky, scroll interno em `.sidebar-nav`
- `.portal-main` > `.topbar` + `#page-filters` + `#page-content`
- Breakpoints comuns: **640**, **720**, **768**, **1100** px
- Collapse sidebar: `body.sidebar-collapsed`

## Checklist antes de entregar UI

- [ ] Usou tokens `--*` (sem hex solto novo)
- [ ] `escapeHtml` em todo texto/attr dinâmico
- [ ] KPIs seguem hierarquia primary/secondary/compact
- [ ] Filtros via `renderFilterBar` + contrato em `page-contracts.mjs`
- [ ] Tabela com `.table-wrap` e colunas `.num`
- [ ] Mobile: KPI row vira 1 col; filter-bar empilha
- [ ] Remoção de bloco não deixa card/branco vazio
- [ ] Listeners de conteúdo com `AbortController` (re-render SPA)
- [ ] Estado de página reseta ao sair (`unmount` / `showAllDiscoveries = false`)
- [ ] Acessibilidade: `focus-visible`, `aria-expanded`, `aria-label` em toggles

## Anti-padrões

- ❌ Bootstrap, Tailwind, Material, shadcn
- ❌ Novo esquema de cores por página
- ❌ Inline `style=` excepto larguras de barra de gráfico já existentes
- ❌ Títulos em inglês na UI (código pode ser EN)
- ❌ Cards com sombra pesada custom — usar `--shadow-soft` / `--shadow-card`
- ❌ Ouro/coral no assistente misturado com KPIs sem motivo
- ❌ Duplicar `addEventListener` a cada render sem abort

## Fluxo para nova página

1. Ler página irmã mais próxima (`js/general-data.js`, `js/temporal-indicators.js`, `js/statistical-crosses.js`)
2. Registrar em `js/pages.js` + `js/app.js` lazy boot
3. CSS: preferir classes em `components.css`; escopo de página `.foo-page` só se necessário
4. Filtros: `lib/analytics/*-filters.mjs` + `filters/page-contracts.mjs`
5. Validar visualmente em **375px** e **1280px**

## Recursos

- Tokens e catálogo de classes: [reference.md](reference.md)
- CSS: `css/styles.css`, `css/layout.css`, `css/components.css`
- Filtros: `js/components/filters/filter-bar.js`, `filter-shell.js`
- Gráficos utilitários: `js/general-charts.mjs`
- Insights editoriais: `lib/analytics/statistical-insights.mjs`, `js/components/statistical-insight.mjs`
