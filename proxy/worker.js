/**
 * CORS proxy for the Dandiset Metadata Assistant.
 *
 * The app runs entirely in the browser, and most publisher and reference
 * sites do not send CORS headers, so fetch_url cannot read them directly.
 * This worker fetches a page on the app's behalf and returns it with the
 * CORS headers the browser needs.
 *
 * It is deliberately narrow. Only requests whose Origin header matches
 * ALLOWED_ORIGINS are served, only GET and HEAD are forwarded, and only
 * targets on the same domain allowlist that fetch_url uses are fetched.
 *
 * Request form, matching the VITE_CORS_PROXY_URL template
 * "https://<worker>/?{url}": the target is the URL-encoded query string,
 * or a "url" query parameter.
 */

import allowedDomains from "../src/chat/tools/allowedDomains.json";

const FETCH_TIMEOUT_MS = 20000;
const USER_AGENT =
  "dandi-medit-cors-proxy/1.0 (+https://github.com/dandi/dandi-medit)";

/** Parse the comma separated ALLOWED_ORIGINS variable. */
export function parseAllowedOrigins(value) {
  return (value || "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/**
 * True when the request Origin is one the proxy serves. An entry may carry a
 * single leading wildcard for the first host label, such as
 * "https://*.dandi-medit.pages.dev", which matches every pull request
 * preview deployment.
 */
export function isAllowedOrigin(origin, allowedOrigins) {
  if (!origin) return false;
  const normalized = origin.replace(/\/+$/, "");
  return allowedOrigins.some((allowed) => {
    if (!allowed.includes("*")) return normalized === allowed;
    const [scheme, host] = allowed.split("://");
    if (!host || !host.startsWith("*.")) return false;
    const suffix = host.slice(1); // ".dandi-medit.pages.dev"
    const originHost = normalized.startsWith(`${scheme}://`) ? normalized.slice(scheme.length + 3) : null;
    return !!originHost && originHost.endsWith(suffix) && !originHost.slice(0, -suffix.length).includes(".") && originHost.length > suffix.length;
  });
}

/** True when the target URL is https and on the shared domain allowlist. */
export function isAllowedTarget(target) {
  if (target.protocol !== "https:" && target.protocol !== "http:") return false;
  const hostname = target.hostname.toLowerCase();
  return allowedDomains.some(
    (domain) => hostname === domain || hostname.endsWith("." + domain),
  );
}

/** Extract the target URL from "?url=..." or from the bare query string. */
export function parseTargetUrl(requestUrl) {
  const url = new URL(requestUrl);
  const fromParam = url.searchParams.get("url");
  const raw = fromParam ?? decodeURIComponent(url.search.replace(/^\?/, ""));
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function reject(status, message, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(origin ? corsHeaders(origin) : {}),
    },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);

    if (!isAllowedOrigin(origin, allowedOrigins)) {
      return reject(403, "Origin not allowed", null);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return reject(405, "Only GET and HEAD are supported", origin);
    }

    const target = parseTargetUrl(request.url);
    if (!target) {
      return reject(400, "Missing or invalid target URL", origin);
    }
    if (!isAllowedTarget(target)) {
      return reject(403, `Target domain not allowed: ${target.hostname}`, origin);
    }

    let upstream;
    try {
      upstream = await fetch(target.toString(), {
        method: request.method,
        headers: {
          Accept: request.headers.get("Accept") || "*/*",
          "User-Agent": USER_AGENT,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "fetch failed";
      return reject(502, `Upstream fetch failed: ${message}`, origin);
    }

    // Pass the body through, keep the content type and final status, and
    // drop upstream cookies and framing headers that do not belong here.
    const headers = new Headers(corsHeaders(origin));
    const contentType = upstream.headers.get("Content-Type");
    if (contentType) headers.set("Content-Type", contentType);
    headers.set("X-Proxied-Url", upstream.url);

    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  },
};
