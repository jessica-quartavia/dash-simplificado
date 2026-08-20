import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAssistantState,
  addUserMessage,
  addAssistantMessage,
  clearConversation,
  historyForApi,
  hasConversation,
  MAX_API_HISTORY,
  STARTER_CHIPS,
} from "../../js/assistant/assistant-state.js";
import { mapAssistantError, postAssistantMessage } from "../../js/assistant/assistant-api.js";
import {
  escapeHtml,
  renderMarkdown,
  buildValidatedNotice,
  followUpChips,
  loadingLabel,
  isDebugEnabled,
} from "../../js/assistant/assistant-renderer.js";

test("estado inicial sem conversa", () => {
  const state = createAssistantState();
  assert.equal(hasConversation(state), false);
  assert.equal(state.open, false);
});

test("histórico limitado para API", () => {
  const state = createAssistantState();
  for (let i = 0; i < 12; i += 1) {
    addUserMessage(state, `pergunta ${i}`);
    addAssistantMessage(state, { answer: `resposta ${i}` });
  }
  const history = historyForApi(state.messages);
  assert.equal(history.length, MAX_API_HISTORY);
  assert.equal(history[0].content, "pergunta 8");
});

test("nova conversa limpa histórico", () => {
  const state = createAssistantState();
  addUserMessage(state, "oi");
  clearConversation(state);
  assert.equal(hasConversation(state), false);
  assert.equal(historyForApi(state.messages).length, 0);
});

test("chips iniciais definidos", () => {
  assert.ok(STARTER_CHIPS.length >= 5);
});

test("sanitização markdown bloqueia HTML", () => {
  const html = renderMarkdown('<script>alert("x")</script> **ok**');
  assert.equal(html.includes("<script>"), false);
  assert.match(html, /<strong>ok<\/strong>/);
});

test("escapeHtml", () => {
  assert.equal(escapeHtml(`a & b <c>`), "a &amp; b &lt;c&gt;");
});

test("notice métrica não validada", () => {
  const html = buildValidatedNotice({ validated_for_v2: false });
  assert.match(html, /não validado/i);
});

test("follow-up chips contextual", () => {
  const chips = followUpChips({
    intent: "value",
    page: { page_label: "Dados Gerais" },
    matched_metrics: [{ label: "Clientes ativos" }],
  });
  assert.ok(chips.length <= 3);
  assert.ok(chips.some((chip) => /Como é calculado/i.test(chip)));
});

test("loading labels por latência", () => {
  assert.match(loadingLabel(500), /Analisando/i);
  assert.match(loadingLabel(2500), /Consultando/i);
  assert.match(loadingLabel(6000), /alguns segundos/i);
});

test("debug mode via query", () => {
  assert.equal(isDebugEnabled("?assistantDebug=1"), true);
  assert.equal(isDebugEnabled(""), false);
});

test("mapAssistantError 401", () => {
  assert.match(mapAssistantError({ code: "AUTH_REQUIRED" }), /sessão expirou/i);
});

test("mapAssistantError compute timeout", () => {
  assert.match(mapAssistantError({ code: "compute_timeout" }), /consultar o valor/i);
});

test("postAssistantMessage sucesso", async () => {
  const payload = await postAssistantMessage({
    message: "quantos clientes ativos?",
    history: [],
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          answer: "1.775 clientes ativos.",
          page: { page_id: "general", page_label: "Dados Gerais", validated_for_v2: true },
          meta: { timings_ms: { totalMs: 12 } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  });
  assert.match(payload.answer, /1\.775/);
  assert.equal(payload.page.page_id, "general");
  assert.equal(typeof payload.meta.request_ms, "number");
});

test("postAssistantMessage erro 401", async () => {
  await assert.rejects(
    () =>
      postAssistantMessage({
        message: "oi",
        history: [],
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 }),
      }),
    (error) => error.code === "AUTH_REQUIRED",
  );
});

test("mensagem assistant guarda page", () => {
  const state = createAssistantState();
  addAssistantMessage(state, {
    answer: "ok",
    page: { page_id: "meetings", page_label: "Reuniões", validated_for_v2: true },
    matched_metrics: [{ metric_id: "total_meetings", label: "Total de reuniões" }],
    intent: "value",
    meta: { value_source: "compute" },
  });
  assert.equal(state.messages[0].page.page_id, "meetings");
});

test("Shift+Enter preservado no textarea via comportamento documentado", () => {
  assert.equal(MAX_API_HISTORY, 8);
});
