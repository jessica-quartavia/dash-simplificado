/**
 * UI do Assistente da Jornada V2 — botão flutuante + drawer lateral.
 */
import { authenticatedFetch } from "../auth.mjs";
import { navigateTo } from "../page-navigation.js";
import { getPageById, isPageImplemented } from "../pages.js";
import {
  createAssistantState,
  addUserMessage,
  addAssistantMessage,
  addAssistantError,
  clearConversation,
  historyForApi,
  hasConversation,
  STARTER_CHIPS,
  WELCOME_TEXT,
} from "./assistant-state.js";
import { postAssistantMessage, mapAssistantError } from "./assistant-api.js";
import {
  renderMarkdown,
  buildContextTag,
  buildValidatedNotice,
  followUpChips,
  buildDebugPanel,
  loadingLabel,
  isDebugEnabled,
  escapeHtml,
} from "./assistant-renderer.js";

const ICON_NEW = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const ICON_CLOSE = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

const state = createAssistantState();
let root = null;
let fab = null;
let drawer = null;
let backdrop = null;
let messagesEl = null;
let inputEl = null;
let sendBtn = null;
let loadingTimer = null;
let loadingTick = null;
let debugMode = false;
let lastChipSentAt = 0;
let lastChipText = "";

function qs(sel, parent = root) {
  return parent?.querySelector(sel) || null;
}

function openDrawer() {
  state.open = true;
  root?.classList.add("is-open");
  drawer?.setAttribute("aria-hidden", "false");
  fab?.setAttribute("aria-expanded", "true");
  backdrop?.removeAttribute("hidden");
  document.body.classList.add("assistant-open");
  requestAnimationFrame(() => inputEl?.focus());
  renderMessages();
}

function closeDrawer() {
  state.open = false;
  root?.classList.remove("is-open");
  drawer?.setAttribute("aria-hidden", "true");
  fab?.setAttribute("aria-expanded", "false");
  backdrop?.setAttribute("hidden", "");
  document.body.classList.remove("assistant-open");
  stopLoadingUi();
  fab?.focus();
}

function toggleDrawer() {
  if (state.open) closeDrawer();
  else openDrawer();
}

function navigateToPage(pageId) {
  const page = getPageById(pageId);
  if (!page) return;
  navigateTo(page.id);
  closeDrawer();
}

function chipMessage(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  return trimmed.endsWith("?") ? trimmed : `${trimmed}?`;
}

async function onChipClick(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed || state.sending) return;
  if (trimmed.startsWith("Ver em ")) {
    const page = state.messages
      .slice()
      .reverse()
      .find((m) => m.role === "assistant" && m.page?.page_label)?.page;
    if (page?.page_id) {
      navigateToPage(page.page_id);
    }
    return;
  }
  const now = Date.now();
  if (trimmed === lastChipText && now - lastChipSentAt < 800) return;
  lastChipText = trimmed;
  lastChipSentAt = now;
  await sendMessage(chipMessage(trimmed));
}

function renderStarter() {
  const disabled = state.sending ? " disabled" : "";
  return `
    <div class="assistant-welcome">
      <p>${escapeHtml(WELCOME_TEXT)}</p>
      <div class="assistant-chips" role="list">
        ${STARTER_CHIPS.map(
          (chip) =>
            `<button type="button" class="assistant-chip" data-chip="${escapeHtml(chip)}"${disabled} aria-label="Enviar sugestão: ${escapeHtml(chip)}">${escapeHtml(chip)}</button>`,
        ).join("")}
      </div>
    </div>`;
}

function renderMessageItem(message) {
  if (message.role === "user") {
    return `
      <article class="assistant-msg assistant-msg-user">
        <div class="assistant-msg-body">${escapeHtml(message.content)}</div>
      </article>`;
  }

  const tag = message.page?.page_label ? buildContextTag(message.page.page_label) : "";
  const validated = buildValidatedNotice(message.page);
  const pageLink =
    message.page?.page_id && isPageImplemented(message.page.page_id)
      ? `<button type="button" class="assistant-page-link" data-page-id="${escapeHtml(message.page.page_id)}">Ver em ${escapeHtml(message.page.page_label || "página")} →</button>`
      : "";
  const debug =
    debugMode && message.meta
      ? buildDebugPanel(
          { matched_metrics: message.matchedMetrics, intent: message.intent },
          message.meta,
        )
      : "";

  return `
    <article class="assistant-msg assistant-msg-bot${message.isError ? " is-error" : ""}">
      <div class="assistant-msg-body assistant-md">${renderMarkdown(message.content)}</div>
      ${tag ? `<div class="assistant-msg-meta">${tag}${pageLink}</div>` : pageLink ? `<div class="assistant-msg-meta">${pageLink}</div>` : ""}
      ${validated}
      ${debug}
    </article>`;
}

function renderFollowUps(lastPayload) {
  if (!lastPayload) return "";
  const chips = followUpChips(lastPayload);
  if (!chips.length) return "";
  const disabled = state.sending ? " disabled" : "";
  return `
    <div class="assistant-chips assistant-chips-followup" role="list">
      ${chips
        .map(
          (chip) =>
            `<button type="button" class="assistant-chip assistant-chip-subtle" data-chip="${escapeHtml(chip)}"${disabled} aria-label="Enviar sugestão: ${escapeHtml(chip)}">${escapeHtml(chip)}</button>`,
        )
        .join("")}
    </div>`;
}

function renderLoading() {
  const elapsed = state.requestStartedAt ? Date.now() - state.requestStartedAt : 0;
  return `
    <div class="assistant-loading" aria-live="polite">
      <span class="assistant-loading-text">${escapeHtml(loadingLabel(elapsed))}</span>
      <span class="assistant-dots" aria-hidden="true"><span></span><span></span><span></span></span>
    </div>`;
}

function lastAssistantPayload() {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const msg = state.messages[i];
    if (msg.role === "assistant" && !msg.isError) {
      return {
        answer: msg.content,
        page: msg.page,
        matched_metrics: msg.matchedMetrics,
        intent: msg.intent,
        meta: msg.meta,
      };
    }
  }
  return null;
}

function renderMessages() {
  if (!messagesEl) return;
  const shouldStick = state.stickToBottom;
  const parts = [];
  if (!hasConversation(state)) parts.push(renderStarter());
  for (const message of state.messages) parts.push(renderMessageItem(message));
  if (state.sending) parts.push(renderLoading());
  else if (hasConversation(state)) parts.push(renderFollowUps(lastAssistantPayload()));
  messagesEl.innerHTML = parts.join("");
  bindMessageActions();
  if (shouldStick) scrollToBottom();
}

function bindMessageActions() {
  messagesEl?.querySelectorAll("[data-chip]").forEach((button) => {
    button.addEventListener("click", () => void onChipClick(button.dataset.chip));
  });
  messagesEl?.querySelectorAll("[data-page-id]").forEach((button) => {
    button.addEventListener("click", () => navigateToPage(button.dataset.pageId));
  });
}

function scrollToBottom() {
  if (!messagesEl) return;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function onMessagesScroll() {
  if (!messagesEl) return;
  const distance = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  state.stickToBottom = distance < 80;
}

function setSending(active) {
  state.sending = active;
  if (sendBtn) {
    sendBtn.disabled = active;
    sendBtn.classList.toggle("is-loading", active);
    sendBtn.setAttribute("aria-busy", active ? "true" : "false");
  }
  if (inputEl) inputEl.disabled = active;
}

function startLoadingUi() {
  state.requestStartedAt = Date.now();
  stopLoadingUi();
  loadingTick = window.setInterval(() => {
    if (!state.sending) return;
    const loadingNode = messagesEl?.querySelector(".assistant-loading-text");
    if (loadingNode) {
      loadingNode.textContent = loadingLabel(Date.now() - state.requestStartedAt);
    }
  }, 400);
}

function stopLoadingUi() {
  if (loadingTick) window.clearInterval(loadingTick);
  loadingTick = null;
  state.requestStartedAt = 0;
}

async function sendMessage(text) {
  const normalized = String(text || "").trim();
  if (!normalized || state.sending) return;
  addUserMessage(state, normalized);
  if (inputEl) {
    inputEl.value = "";
    inputEl.style.height = "auto";
  }
  renderMessages();
  setSending(true);
  startLoadingUi();

  try {
    const payload = await postAssistantMessage({
      message: normalized,
      history: historyForApi(state.messages.slice(0, -1)),
      fetchImpl: authenticatedFetch,
    });
    addAssistantMessage(state, payload);
  } catch (error) {
    addAssistantError(state, mapAssistantError(error, error.response, { debug: debugMode }));
  } finally {
    setSending(false);
    stopLoadingUi();
    renderMessages();
    inputEl?.focus();
  }
}

async function sendCurrentMessage() {
  await sendMessage(inputEl?.value || "");
}

function onInputKeydown(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendCurrentMessage();
  }
}

function autoResizeInput() {
  if (!inputEl) return;
  inputEl.style.height = "auto";
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 120)}px`;
}

function onNewConversation() {
  clearConversation(state);
  lastChipSentAt = 0;
  lastChipText = "";
  renderMessages();
  inputEl?.focus();
}

function trapFocus(event) {
  if (!state.open || event.key !== "Tab" || !drawer) return;
  const focusables = drawer.querySelectorAll(
    'button:not([disabled]), textarea:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function buildShell() {
  root = document.getElementById("assistant-slot");
  if (!root) return;

  root.className = "assistant-root";
  root.removeAttribute("aria-hidden");
  root.innerHTML = `
    <button type="button" class="assistant-fab" id="assistant-fab" aria-expanded="false" aria-controls="assistant-drawer" aria-label="Abrir Assistente da Jornada">
      <span class="assistant-fab-label">Assistente da Jornada</span>
    </button>
    <div class="assistant-backdrop" id="assistant-backdrop" hidden></div>
    <aside class="assistant-drawer" id="assistant-drawer" aria-hidden="true" aria-label="Assistente da Jornada" role="dialog" aria-modal="true">
      <header class="assistant-header">
        <div>
          <h2 class="assistant-title">Assistente da Jornada</h2>
        </div>
        <div class="assistant-header-actions">
          <button type="button" class="assistant-icon-btn" id="assistant-new" aria-label="Nova conversa" title="Nova conversa">${ICON_NEW}</button>
          <button type="button" class="assistant-icon-btn assistant-close" id="assistant-close" aria-label="Fechar assistente" title="Fechar">${ICON_CLOSE}</button>
        </div>
      </header>
      <div class="assistant-messages" id="assistant-messages" tabindex="0" role="log" aria-live="polite" aria-relevant="additions"></div>
      <footer class="assistant-footer">
        <label class="assistant-input-wrap">
          <span class="sr-only">Pergunta</span>
          <textarea id="assistant-input" class="assistant-input" rows="1" placeholder="Pergunte sobre os indicadores..." aria-label="Pergunte sobre os indicadores"></textarea>
        </label>
        <button type="button" class="assistant-send" id="assistant-send" aria-label="Enviar pergunta">
          <span class="assistant-send-label">Enviar</span>
        </button>
      </footer>
    </aside>`;

  fab = qs("#assistant-fab");
  drawer = qs("#assistant-drawer");
  backdrop = qs("#assistant-backdrop");
  messagesEl = qs("#assistant-messages");
  inputEl = qs("#assistant-input");
  sendBtn = qs("#assistant-send");

  fab?.addEventListener("click", toggleDrawer);
  qs("#assistant-close")?.addEventListener("click", closeDrawer);
  qs("#assistant-new")?.addEventListener("click", onNewConversation);
  backdrop?.addEventListener("click", closeDrawer);
  sendBtn?.addEventListener("click", () => void sendCurrentMessage());
  inputEl?.addEventListener("keydown", onInputKeydown);
  inputEl?.addEventListener("input", autoResizeInput);
  messagesEl?.addEventListener("scroll", onMessagesScroll);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.open) {
      event.preventDefault();
      closeDrawer();
    }
    trapFocus(event);
  });

  renderMessages();
}

export function bootAssistant() {
  try {
    debugMode = isDebugEnabled(window.location.search);
    buildShell();
    if (!root) {
      console.warn("[Assistant] #assistant-slot not found; skipping mount");
    }
  } catch (error) {
    console.error("[Assistant] boot failed", error);
  }
}

export { sendMessage, onChipClick, chipMessage };
