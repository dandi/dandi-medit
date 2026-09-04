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

/**
 * Whether the user has supplied their own OpenRouter key, in which case a
 * credit failure is on their own account rather than on the shared one.
 */
export const isUsingOwnOpenRouterKey = (): boolean =>
  !!getStoredOpenRouterApiKey();

/**
 * True when the request failed because the OpenRouter account behind it has no
 * remaining credit. OpenRouter answers with HTTP 402, but the status is not
 * always available by the time we build the message, so we also look at the
 * error text.
 */
const isCreditError = (status: number, details: string): boolean =>
  status === 402 || /payment required|insufficient credits|credit/i.test(details);

/**
 * Turn a failed completion response into a message for the user. Most failures
 * keep the generic wording, but a missing-credit failure gets an explanation of
 * what happened and what can be done about it, since the raw status text
 * ("Payment Required") gives no indication that adding a key or waiting is the
 * way out.
 */
export const describeCompletionError = (
  status: number,
  details: string,
  usingOwnKey: boolean,
): string => {
  if (isCreditError(status, details)) {
    if (usingOwnKey) {
      return (
        "Your OpenRouter account has no remaining credit, so this request was refused. " +
        "Add credit at https://openrouter.ai/credits, or remove your key in Settings to use the shared key with a free model."
      );
    }
    return (
      "The shared OpenRouter key that powers the free models has run out of credit, so this request was refused. " +
      "You can add your own OpenRouter API key in Settings (any model works with your own key) or try again later; " +
      "switching between free models will not help."
    );
  }
  return `OpenRouter API error: ${details}`;
};
