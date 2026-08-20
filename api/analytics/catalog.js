import { handleMetricCatalogRequest } from "../../lib/analytics/metric-catalog-handler.mjs";
import { nodeToWebRequest, sendWebResponse } from "../../lib/http/node-fetch-bridge.mjs";

export default async function handler(req, res) {
  const request = await nodeToWebRequest(req);
  const hasAuth = Boolean(request.headers.get("authorization"));
  console.info(`[catalog] incoming ${req.method || "GET"} authorization=${hasAuth ? "sim" : "não"}`);
  const response = await handleMetricCatalogRequest(request);
  await sendWebResponse(res, response, { logPrefix: "catalog" });
}
