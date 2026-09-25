/**
 * Documentação das regras oficiais de renovação (portal / BASE QV).
 */
export const RENEWAL_OFFICIAL_RULES = Object.freeze({
  renewedDefinition: "hasRenewed = currentCycle > 1 (campo clients.ciclo).",
  renewalCount: "renewalCount = max(currentCycle − 1, 0).",
  currentCycle: "currentCycle parseado de clients.ciclo; null, ≤0 ou inválido ⇒ cycleValid=false.",
  eligibleForHistoricalRenewalAnalysis:
    "Clientes com cycleValid=true (ciclo ≥ 1). renewed=true se já renovou; false se ainda no 1º ciclo.",
  excluded:
    "Ciclo ausente, zero ou negativo — não entram como elegíveis; não contam como renovados.",
  mechanismRule:
    "Mecanismo implementado conforme status BASE QV (normalizeBaseQvMechanismStatus = Implementado); binários implemented_<slug> no wide.",
  sourceModule: "lib/analytics/client-cycle-renewal.mjs · renewalFromClient",
});
