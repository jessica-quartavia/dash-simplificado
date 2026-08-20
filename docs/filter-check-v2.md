# Filter Check V2 — Dash Kids / Analytics QuartaVia

Infraestrutura global de filtros, busca e exportação. **Nenhuma tela nova está pronta sem Filter Check = PASS.**

## Comando

```text
npm run analytics:filter-check
```

Equivalente: `node scripts/filter-check.mjs`

## Definition of Done (mínima)

- Dados reais
- Regra validada
- Filtros funcionais (interseção AND)
- Período funcional com semântica documentada
- Busca nome/código/ID nas tabelas aplicáveis
- CSV e Excel dos registros **filtrados**
- Loading/error
- Responsividade
- **Filter Check PASS**

## Infraestrutura global

| Caminho | Papel |
|---------|-------|
| `js/components/filters/filter-bar.js` | FilterBar, PeriodFilter, SearchInput, ExportActions |
| `lib/analytics/filters/period.mjs` | Presets + personalizado + validação |
| `lib/analytics/filters/search.mjs` | Busca nome/código/ID (accent insensitive) |
| `lib/analytics/filters/page-contracts.mjs` | Filter Contract por página/componente |
| `lib/analytics/filters/filter-check.mjs` | Validação automática (contrato + comportamento) |
| `js/utils/table-export.js` | CSV UTF-8 BOM + XLSX real (allowlist) |
| `js/utils/page-table-export.js` | Export com resumo de filtros aplicados |

Estado único por página (`state.filters`), combinável por interseção.

## Matriz por página (após correção)

| Página | Período | Status | EP | Segmento | Busca | CSV | Excel | Filter Check |
|--------|---------|--------|-----|----------|-------|-----|-------|--------------|
| Dados Gerais | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |
| Jornada | ✅ | ✅ | ✅ | N/A | ✅ | ✅ | ✅ | PASS |
| Reuniões | ✅ | ✅ | ✅ | N/A | ✅ | ✅ | ✅ | PASS |
| Plano Patrimonial | ✅ | N/A | ✅ | N/A | ✅ | ✅ | ✅ | PASS |
| Mecanismos | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |

## Semântica temporal do período

| Página | Data canônica | O que o período afeta |
|--------|---------------|------------------------|
| **Dados Gerais** | `contractDate` | Somente gráfico de **aquisição mensal**. Cards de estoque, distribuições cadastrais e tabela permanecem current-state. |
| **Jornada** | `contractDate` | Coorte inteira: KPIs, gráficos e tabela. |
| **Reuniões** | `start_time` | Reuniões do cliente; métricas re-enriquecidas. Calendly por tipo: **só período**. |
| **Plano Patrimonial** | `approvedAt` (reunião Central) | KPI médio + tabela. Carteira completa (não active-first). |
| **Mecanismos** | `implemented_at` | Somente gráfico **implementações por mês**. Estoque/vínculos atuais ignoram período. |

Componentes com `periodSensitive: false` estão listados em `page-contracts.mjs`.

## Busca (nome / código / ID)

| Página | Campos | Código |
|--------|--------|--------|
| Dados Gerais | `clientName`, `clientCode`, `clientId` | `clients.codigo` |
| Jornada | idem | idem |
| Reuniões | idem | idem |
| Plano Patrimonial | idem | idem |
| Mecanismos | idem | idem |

Placeholder: **Nome, código ou ID**. Debounce ~300ms nas páginas com FilterBar compartilhado.

## Exportação

- **CSV**: UTF-8 com BOM, cabeçalhos amigáveis, allowlist por página (`exportColumns` no contract).
- **Excel**: `.xlsx` real via `xlsx-minimal.mjs` (sem dependência npm). Sheet 1 = dados filtrados; Sheet 2 = filtros aplicados.
- Nome: `analytics-quartavia_<pagina>_<YYYY-MM-DD>.csv|xlsx`
- Nunca exporta objeto bruto da API nem campos internos.

## Matriz detalhada — Dados Gerais

| Componente | periodSensitive | status | engineer | segment | search |
|------------|-----------------|--------|----------|---------|--------|
| KPIs estoque | false | ✅ | ✅ | ✅ | ✅ |
| Gráficos cadastrais | false | ✅ | ✅ | ✅ | ✅ |
| Aquisição mensal | true | ❌* | ✅ | ✅ | ✅ |
| Tabela clientes | false | ✅ | ✅ | ✅ | ✅ |

\*Status não filtra aquisição (evento histórico).

## Limitações conhecidas

1. **Reuniões por tipo (Calendly)**: respeita período; não recebe Status, EP nem busca (fonte externa).
2. **Mecanismos — filtro Recente**: últimos 30 dias relativos a hoje, independente do período global.
3. **Filtragem no frontend**: payload completo após um fetch; Reuniões não ganhou filtros no backend (evitar impacto no compute ~78s).
4. **Plano Patrimonial**: sem filtro de Status de propósito (métrica histórica da carteira completa).

## Template para novas telas

1. Adicionar entrada em `page-contracts.mjs` (period, search, export, components).
2. Usar `renderFilterBar` + `renderTableToolbar` + `exportFilteredTable`.
3. Declarar `periodSensitive` por KPI/gráfico/tabela.
4. Rodar `npm run analytics:filter-check` até PASS.

## Auditoria antes → depois (resumo)

| Gap anterior | Correção |
|--------------|----------|
| Jornada sem período/export na UI | FilterBar + export |
| Plano só KPI, sem filtros/tabela | Filtros + tabela + export + KPI recalculado |
| Mecanismos sem período/export | Período no gráfico mensal + export |
| Dados Gerais export quebrado (`content` indefinido) | Corrigido |
| Filter Check inexistente como comando | `npm run analytics:filter-check` |
