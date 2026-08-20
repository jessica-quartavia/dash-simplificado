import { handleRenewalRequest } from "../lib/analytics/renewal-handler.mjs";
import { nodeToWebRequest, sendWebResponse } from "../lib/http/node-fetch-bridge.mjs";

export default async function handler(req, res) {
  const request = await nodeToWebRequest(req);
  const response = await handleRenewalRequest(request);
  await sendWebResponse(res, response, { logPrefix: "renewal" });
}
