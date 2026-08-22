/**
 * Handler HTTP de Jornada e Onboarding.
 */
import { requireCorporateAuth } from "../auth.mjs";
import { dataConfigurationError } from "../env.mjs";
import { computeOnboardingPayload, toPublicOnboardingPayload } from "./onboarding.mjs";
import { computeWithPageCache, parseForceRefresh } from "./handler-cache.mjs";

function json(status, body) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleOnboardingRequest(request, deps = {}) {
  const startedAt = Date.now();
  const method = request?.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    return json(405, { error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" });
  }
  const requireAuth = deps.requireCorporateAuth || requireCorporateAuth;
  const denied = await requireAuth(request);
  const authMs = Date.now() - startedAt;
  if (denied) {
    console.info(`[onboarding] status=${denied.status} auth=${authMs}ms total=${Date.now() - startedAt}ms`);
    return denied;
  }
  const configError = (deps.dataConfigurationError || dataConfigurationError)();
  if (configError) {
    return json(503, { error: configError, code: "config" });
  }
  try {
    const force = parseForceRefresh(request);
    const compute = deps.computeOnboardingPayload || computeOnboardingPayload;
    const { payload, cache } = await computeWithPageCache("journey", () => compute(), { request, force });
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    const timing = payload?.timing || {};
    console.info(
      `[onboarding] status=200 auth=${authMs}ms compute=${timing.totalMs ?? "—"}ms cache=${cache.status} total=${Date.now() - startedAt}ms`,
    );
    return json(200, toPublicOnboardingPayload(payload));
  } catch (error) {
    if (error?.code === "config") return json(503, { error: error.message, code: "config" });
    console.error("[Data] onboarding failed:", error instanceof Error ? error.message : error);
    return json(500, {
      error: "Não foi possível consultar jornada/onboarding.",
      code: "data_query_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
