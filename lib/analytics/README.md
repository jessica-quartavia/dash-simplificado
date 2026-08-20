/**
 * Kernel analítico da V2 — regras oficiais extraídas da V1.
 *
 * Módulos puros: sem HTTP, sem Netlify, sem consultas a banco.
 * BASE QV, quando conectada, será somente leitura.
 *
 * Active-first não é active-only. Ver `client-status.mjs`.
 *
 * Permanência: `stayDays` inclui +365 de renovação quando aplicável;
 * `stayDaysChronological` / `stayDaysBase` são a duração real
 * (Kaplan–Meier, cohort e survival).
 *
 * Renovação é inferida por `clients.ciclo`, não por evento contratual.
 *
 * Limitação futura (permanência): o CSV de produto registra que um campo
 * `data_primeiro_ciclo` ajudaria a incorporar o ciclo no cálculo. Esse campo
 * não existe na BASE QV atual — não inventar. A regra vigente permanece:
 * data de contratação + ajuste analítico por `ciclo`.
 */
