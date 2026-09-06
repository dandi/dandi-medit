/**
 * Model assessment of the judgment items on the metadata checklist.
 *
 * The rule-based checklist items are computed in the app. Three items are
 * judgment calls (is the title informative, is the description informative,
 * does it summarize the methodology) and are answered by a model. The
 * assessment runs here rather than in the browser so that the result can be
 * cached in KV and shared: the verdict is a pure function of the rubric, the
 * model, the title and the description, so the cache key is a hash of those,
 * and the only writer is this worker after a real model call.
 */

export const RUBRIC_VERSION = "1";
export const DEFAULT_ASSESS_MODEL = "deepseek/deepseek-v4-flash-0731";
export const MAX_TITLE_LENGTH = 1000;
export const MAX_DESCRIPTION_LENGTH = 20000;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL_TIMEOUT_MS = 30000;

export const ASSESSMENT_ITEMS = ["titleInformative", "descriptionInformative", "methodologySummary"];

const RUBRIC = `You assess the title and description of a neurophysiology dataset (a DANDI dandiset) against three criteria. Answer with a single JSON object and nothing else, in this exact shape:

{"titleInformative": {"pass": true, "reason": "..."}, "descriptionInformative": {"pass": true, "reason": "..."}, "methodologySummary": {"pass": true, "reason": "..."}}

Criteria:

titleInformative: The title tells a reader what the data are. It names at least two of: the recording technique or modality, the preparation or species, the brain region or system, and the scientific question or task. A paper title reused verbatim can pass if it does this. A lab name, a project code, a bare technique ("Ephys data"), or a placeholder fails.

descriptionInformative: The description, in a few sentences, says what was recorded, from what subjects or preparation, and why (the question or purpose). A single sentence that only restates the title fails. It does not need to list every data stream or file type; the archive shows those separately.

methodologySummary: The description names the recording modality or technique (for example silicon probe extracellular recording, two-photon calcium imaging, patch clamp, fMRI) and the experimental paradigm or behavioral task, or states that the recordings were at rest or anesthetized. Mentioning analysis methods alone does not satisfy this.

Each "reason" is one short sentence (under 25 words) a curator can act on: for a pass, what satisfies the criterion; for a fail, what is missing. Judge only the text you are given. Do not invent details.`;

/** Build the chat messages for the model. */
export function buildAssessmentMessages(title, description) {
  return [
    { role: "system", content: RUBRIC },
    {
      role: "user",
      content: `Title:\n${title || "(empty)"}\n\nDescription:\n${description || "(empty)"}`,
    },
  ];
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** KV key for a title and description under the current rubric and model. */
export async function buildAssessmentKey(model, title, description) {
  const hash = await sha256Hex(JSON.stringify([RUBRIC_VERSION, model, title, description]));
  return `assess:v${RUBRIC_VERSION}:${hash}`;
}

/**
 * Extract and validate the model's JSON verdict. Returns null when the text
 * does not contain a usable object, so a malformed reply is never cached.
 */
export function parseAssessment(text) {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const result = {};
  for (const item of ASSESSMENT_ITEMS) {
    const verdict = parsed?.[item];
    if (!verdict || typeof verdict.pass !== "boolean" || typeof verdict.reason !== "string") return null;
    result[item] = { pass: verdict.pass, reason: verdict.reason.trim().slice(0, 300) };
  }
  return result;
}

/** Validate the request body. Returns { title, description } or { error }. */
export function validateAssessmentInput(body) {
  if (!body || typeof body !== "object") return { error: "Request body must be a JSON object" };
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (title.length > MAX_TITLE_LENGTH) return { error: `title is longer than ${MAX_TITLE_LENGTH} characters` };
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return { error: `description is longer than ${MAX_DESCRIPTION_LENGTH} characters` };
  }
  return { title, description };
}

async function callModel(env, model, title, description) {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://medit.dandiarchive.org",
      "X-Title": "Dandiset Metadata Assistant",
    },
    body: JSON.stringify({
      model,
      messages: buildAssessmentMessages(title, description),
      temperature: 0,
      max_tokens: 400,
    }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Model request failed with ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  const data = await response.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

/**
 * Handle POST /assess. The caller has already checked the Origin and the
 * method. `headers` are the CORS headers to attach to every response.
 */
export async function handleAssess(request, env, headers) {
  const json = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Request body must be JSON" });
  }
  const input = validateAssessmentInput(body);
  if (input.error) return json(400, { error: input.error });
  const { title, description } = input;
  if (!title && !description) return json(400, { error: "Provide a title or a description to assess" });

  const model = env.ASSESS_MODEL || DEFAULT_ASSESS_MODEL;
  const key = await buildAssessmentKey(model, title, description);

  const cached = env.ASSESSMENTS ? await env.ASSESSMENTS.get(key, "json") : null;
  if (cached?.assessment) {
    return json(200, { assessment: cached.assessment, model: cached.model, cached: true });
  }

  if (!env.OPENROUTER_API_KEY) {
    return json(503, { error: "Assessment is not configured on this deployment" });
  }

  // Cache misses cost a model call, so they are rate limited per client.
  if (env.ASSESS_LIMITER) {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const { success } = await env.ASSESS_LIMITER.limit({ key: ip });
    if (!success) return json(429, { error: "Too many assessment requests; try again in a minute" });
  }

  let text;
  try {
    text = await callModel(env, model, title, description);
  } catch (error) {
    return json(502, { error: error instanceof Error ? error.message : "Model request failed" });
  }
  const assessment = parseAssessment(text);
  if (!assessment) {
    return json(502, { error: "The model did not return a usable assessment" });
  }

  if (env.ASSESSMENTS) {
    await env.ASSESSMENTS.put(key, JSON.stringify({ assessment, model, createdAt: new Date().toISOString() }));
  }
  return json(200, { assessment, model, cached: false });
}
