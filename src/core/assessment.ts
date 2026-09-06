import type { ChecklistAssessment } from "./checklist";
import { getWorkerOrigin } from "../utils/corsProxy";

/**
 * Client for the worker's /assess route, which answers the checklist's
 * judgment items with a model and caches the verdicts in KV so the same
 * title and description are only ever assessed once.
 */

export interface AssessmentResponse {
  assessment: ChecklistAssessment;
  model?: string;
  cached: boolean;
}

/** The URL of the assessment endpoint, or null when no worker is configured. */
export function getAssessmentEndpoint(): string | null {
  const origin = getWorkerOrigin();
  return origin ? `${origin}/assess` : null;
}

/** Key for the in-memory memo of assessments within a session. */
export function assessmentInputKey(title: string, description: string): string {
  return JSON.stringify([title.trim(), description.trim()]);
}

/**
 * Request an assessment of a title and description. Throws when the worker
 * is not configured, refuses, or returns something unusable, so callers can
 * show "unavailable" rather than a guessed verdict.
 */
export async function fetchChecklistAssessment(
  title: string,
  description: string,
  signal?: AbortSignal,
): Promise<AssessmentResponse> {
  const endpoint = getAssessmentEndpoint();
  if (!endpoint) {
    throw new Error("No assessment endpoint is configured (VITE_CORS_PROXY_URL is unset)");
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ title: title.trim(), description: description.trim() }),
    signal,
  });
  let body: { assessment?: ChecklistAssessment; model?: string; cached?: boolean; error?: string } = {};
  try {
    body = await response.json();
  } catch {
    // fall through to the status check
  }
  if (!response.ok) {
    throw new Error(body.error || `Assessment request failed with ${response.status}`);
  }
  const assessment = body.assessment;
  const valid =
    assessment &&
    (["titleInformative", "descriptionInformative", "methodologySummary"] as const).every(
      (k) => typeof assessment[k]?.pass === "boolean" && typeof assessment[k]?.reason === "string",
    );
  if (!valid) {
    throw new Error("The assessment response was incomplete");
  }
  return { assessment, model: body.model, cached: body.cached === true };
}
