/** Estado local da conversa (sessão do navegador, sem persistência). */

export const MAX_API_HISTORY = 8;

export const STARTER_CHIPS = [
  "Quantos clientes ativos temos?",
  "Qual a taxa de comparecimento?",
  "Como é calculada a permanência?",
  "Qual o mecanismo mais utilizado?",
  "De onde vêm os tipos de reunião?",
];

export const WELCOME_TEXT =
  "Olá! Posso ajudar você a entender os indicadores da jornada do cliente.";

export function createAssistantState() {
  return {
    open: false,
    messages: [],
    sending: false,
    requestStartedAt: 0,
    stickToBottom: true,
  };
}

export function addUserMessage(state, content) {
  const text = String(content || "").trim();
  if (!text) return false;
  state.messages.push({ role: "user", content: text, createdAt: Date.now() });
  state.stickToBottom = true;
  return true;
}

export function addAssistantMessage(state, payload) {
  state.messages.push({
    role: "assistant",
    content: String(payload?.answer || "").trim(),
    createdAt: Date.now(),
    page: payload?.page || null,
    matchedMetrics: payload?.matched_metrics || [],
    intent: payload?.intent || null,
    meta: payload?.meta || null,
    validated: payload?.page?.validated_for_v2 !== false,
  });
  state.stickToBottom = true;
}

export function addAssistantError(state, message) {
  state.messages.push({
    role: "assistant",
    content: String(message || "").trim(),
    createdAt: Date.now(),
    isError: true,
  });
  state.stickToBottom = true;
}

export function clearConversation(state) {
  state.messages = [];
  state.sending = false;
  state.requestStartedAt = 0;
  state.stickToBottom = true;
}

export function historyForApi(messages, limit = MAX_API_HISTORY) {
  return (messages || [])
    .filter((item) => item?.content && (item.role === "user" || item.role === "assistant"))
    .slice(-limit)
    .map((item) => ({ role: item.role, content: item.content }));
}

export function hasConversation(state) {
  return (state?.messages || []).length > 0;
}
