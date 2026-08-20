import { handleGeneralDataRequest } from "../lib/analytics/general-data-handler.mjs";
import { nodeToWebRequest, sendWebResponse } from "../lib/http/node-fetch-bridge.mjs";

export default async function handler(req, res) {
  const request = await nodeToWebRequest(req);
  const hasAuth = Boolean(request.headers.get("authorization"));
  console.info(`[general-data] incoming ${req.method || "GET"} authorization=${hasAuth ? "sim" : "não"}`);
  const response = await handleGeneralDataRequest(request);
  await sendWebResponse(res, response, { logPrefix: "general-data" });
}
