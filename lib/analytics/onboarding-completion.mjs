/**
 * Conclusão de onboarding — regra oficial da V1 (onboarding.mjs).
 *
 * Sim quando:
 *   - o estágio atual de client_journeys NÃO está nos estágios abertos; OU
 *   - existe primeira reunião com intervalo não negativo; OU
 *   - existe registro em client_financial_data.
 * Não quando o estágio atual é aberto e não há reunião nem dado financeiro.
 * Não avaliável quando não há jornada, reunião nem financeiro.
 */
export const OPEN_ONBOARDING_STAGE_IDS = new Set([
  "7c43c981-5cc8-4ed3-b6ad-3bad26856b79",
  "ae3a6015-cc67-4e20-8c9b-f7d7b5605b48",
  "33bb253e-6c80-4611-a1dd-abc6515530e7",
]);

export function journeyCompletionFromStageId(stageId) {
  if (!stageId) return null;
  return !OPEN_ONBOARDING_STAGE_IDS.has(String(stageId));
}

export function classifyOnboardingCompletion({
  latestStageId = null,
  hasFirstMeeting = false,
  hasFinancialData = false,
} = {}) {
  const completedByJourney = journeyCompletionFromStageId(latestStageId);
  const completedOnboarding =
    completedByJourney === true || hasFirstMeeting || hasFinancialData
      ? true
      : completedByJourney === false
        ? false
        : null;

  const sources = [];
  if (completedByJourney === true) sources.push("journey");
  if (hasFirstMeeting) sources.push("first_meeting");
  if (hasFinancialData) sources.push("financial_data");

  return {
    completedByJourney,
    completedOnboarding,
    completedOnboardingSource:
      sources.join("_and_") || (completedByJourney === false ? "open_journey" : null),
  };
}
