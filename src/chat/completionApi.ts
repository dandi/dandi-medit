import { getStoredOpenRouterApiKey } from "./apiKeyStorage";

export const COMPLETION_URL = "https://qp-worker.neurosift.app/api/completion";

/**
 * Build the headers for a request to the completion endpoint, attaching the
 * user's stored OpenRouter key when one is present.
 */
export const buildCompletionHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = getStoredOpenRouterApiKey();
  if (apiKey) {
    headers["x-openrouter-key"] = apiKey;
  }
  return headers;
};
