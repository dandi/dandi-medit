/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import type { ChecklistAssessment } from "../core/checklist";
import { assessmentInputKey, fetchChecklistAssessment, getAssessmentEndpoint } from "../core/assessment";

export type AssessmentStatus = "idle" | "loading" | "ready" | "error" | "unavailable";

export interface ChecklistAssessmentState {
  /** The verdicts for the current title and description, when known. */
  assessment: ChecklistAssessment | undefined;
  status: AssessmentStatus;
  error: string | null;
  /** Ask again after an error. */
  retry: () => void;
}

/** Wait this long after the title or description changes before asking. */
const DEBOUNCE_MS = 1500;

/**
 * Keep a model assessment of the metadata's title and description up to date.
 *
 * The assessment is requested once per distinct title and description, after
 * a short debounce so that typing in the description editor does not fire a
 * request per keystroke. Results are memoized for the session, so undoing an
 * edit shows the earlier verdict again without a request, and the worker
 * caches them across users. When no worker is configured the status is
 * "unavailable" and the checklist reports the items as pending.
 */
export function useChecklistAssessment(metadata: any): ChecklistAssessmentState {
  const title = typeof metadata?.name === "string" ? metadata.name : "";
  const description = typeof metadata?.description === "string" ? metadata.description : "";
  const key = metadata && (title || description) ? assessmentInputKey(title, description) : null;
  const endpointConfigured = getAssessmentEndpoint() !== null;

  // Verdicts already obtained this session, by input key, so a known verdict
  // never goes through a loading state again.
  const [memo, setMemo] = useState<ReadonlyMap<string, ChecklistAssessment>>(() => new Map());
  const known = key ? memo.get(key) : undefined;

  const [request, setRequest] = useState<{ key: string; status: "loading" | "ready" | "error"; error: string | null }>({
    key: "",
    status: "ready",
    error: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!key || !endpointConfigured || memo.has(key)) return;

    const controller = new AbortController();
    let cancelled = false;
    const timer = setTimeout(async () => {
      setRequest({ key, status: "loading", error: null });
      try {
        const { assessment } = await fetchChecklistAssessment(title, description, controller.signal);
        if (cancelled) return;
        setMemo((prev) => new Map(prev).set(key, assessment));
        setRequest({ key, status: "ready", error: null });
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setRequest({ key, status: "error", error: err instanceof Error ? err.message : "Assessment failed" });
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, title, description, attempt, endpointConfigured, memo]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  let status: AssessmentStatus = "idle";
  if (key) {
    if (known) status = "ready";
    else if (!endpointConfigured) status = "unavailable";
    else if (request.key === key) status = request.status;
  }

  return {
    assessment: known,
    status,
    error: status === "error" ? request.error : null,
    retry,
  };
}
