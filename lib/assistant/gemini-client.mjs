/**
 * Cliente server-side do Gemini. GEMINI_API_KEY nunca sai deste módulo.
 */
import { geminiConfigurationError, getGeminiEnv } from "../env.mjs";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

function extractText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((part) => String(part?.text || "")).join("").trim();
}

export async function generateAssistantReply({
  systemPrompt,
  contents,
  deps = {},
} = {}) {
  const configError = deps.geminiConfigurationError || geminiConfigurationError;
  const err = configError();
  if (err) {
    const error = new Error(err);
    error.code = "gemini_config_missing";
    throw error;
  }

  const { apiKey, model, timeoutMs } = deps.getGeminiEnv ? deps.getGeminiEnv() : getGeminiEnv();
  const generate = deps.generateContent || defaultGenerateContent;

  const started = Date.now();
  const response = await generate({
    apiKey,
    model,
    timeoutMs,
    body: {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024,
      },
    },
  });
  const text = extractText(response.data);
  if (!text) {
    const error = new Error("Gemini retornou resposta vazia.");
    error.code = "gemini_empty";
    throw error;
  }

  return {
    text,
    model,
    latencyMs: Date.now() - started,
  };
}

async function defaultGenerateContent({ apiKey, model, timeoutMs, body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const endpoint = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`Gemini HTTP ${response.status}`);
      error.code = response.status === 429 ? "gemini_rate_limit" : "gemini_unavailable";
      error.status = response.status;
      throw error;
    }
    return { data };
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("Tempo esgotado na chamada ao Gemini.");
      timeoutError.code = "gemini_timeout";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
