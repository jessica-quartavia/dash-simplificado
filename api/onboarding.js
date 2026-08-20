import { handleOnboardingRequest } from "../lib/analytics/onboarding-handler.mjs";
import { nodeToWebRequest, sendWebResponse } from "../lib/http/node-fetch-bridge.mjs";

export default async function handler(req, res) {
  const request = await nodeToWebRequest(req);
  const hasAuth = Boolean(request.headers.get("authorization"));
  console.info(`[onboarding] incoming ${req.method || "GET"} authorization=${hasAuth ? "sim" : "não"}`);
  const response = await handleOnboardingRequest(request);
  await sendWebResponse(res, response, { logPrefix: "onboarding" });
}
