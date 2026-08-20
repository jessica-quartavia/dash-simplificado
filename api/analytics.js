import { handleAnalyticsApi } from "../lib/api/analytics-router.mjs";

export default async function handler(req, res) {
  await handleAnalyticsApi(req, res);
}
