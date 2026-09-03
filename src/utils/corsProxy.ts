/**
 * Optional CORS proxy for fetching pages that do not send CORS headers.
 *
 * The proxy is configured at build time through VITE_CORS_PROXY_URL, a URL
 * template containing the literal token {url}, for example
 * "https://proxy.example.org/?{url}". The token is replaced with the
 * URL-encoded target. When the variable is unset there is no proxy, and
 * callers should fall back to whatever they can do without one.
 */

const URL_TOKEN = "{url}";

/**
 * Build the proxied form of a URL, or return null when no proxy is configured.
 */
export function getProxiedUrl(url: string): string | null {
  const template = import.meta.env.VITE_CORS_PROXY_URL?.trim();
  if (!template) {
    return null;
  }
  if (!template.includes(URL_TOKEN)) {
    console.warn(
      `VITE_CORS_PROXY_URL must contain the token ${URL_TOKEN}; ignoring proxy configuration.`
    );
    return null;
  }
  return template.replace(URL_TOKEN, encodeURIComponent(url));
}
