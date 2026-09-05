# CORS Proxy Worker

The Dandiset Metadata Assistant runs entirely in the browser, and most publisher and reference sites do not send the CORS headers a browser needs before it will let a page read a cross-origin response. Publication links are handled without a proxy through OpenAlex and Europe PMC, but the `fetch_url` tool cannot read an arbitrary allowed page unless something fetches it on the app's behalf. This directory contains a small Cloudflare Worker that does that.

The worker is intentionally narrow. It only answers requests whose `Origin` header is in `ALLOWED_ORIGINS`, it only forwards `GET` and `HEAD`, and it only fetches targets whose hostname is on the same domain allowlist that `fetch_url` uses in the app (`src/chat/tools/allowedDomains.json`, imported by both). Upstream cookies are not passed through, and the upstream request times out after twenty seconds. The free Cloudflare plan allows one hundred thousand requests per day, which is far more than the app needs.

## Deploying

Deployment needs a Cloudflare account and the `wrangler` CLI, which is fetched by `npx`. From this directory:

```bash
npx wrangler login
npx wrangler deploy
```

The first command opens a browser window to authorize the CLI. The second prints the worker URL, which looks like `https://dandi-medit-cors-proxy.<account>.workers.dev`. If you deploy under a different name or a custom domain, adjust accordingly.

`ALLOWED_ORIGINS` also accepts a leading `*.` for one host label, which is how pull request previews on Cloudflare Pages (`https://<branch>.dandi-medit.pages.dev`) are covered. If the app is ever served from another origin, add it there and deploy again.

## Pointing the App at It

The app reads the proxy from `VITE_CORS_PROXY_URL` at build time. The value is a template in which `{url}` is replaced with the URL-encoded target:

```
VITE_CORS_PROXY_URL=https://dandi-medit-cors-proxy.<account>.workers.dev/?{url}
```

For local development, put that line in `.env.local` and restart `npm run dev`. For the deployed site, set it as a repository secret of the same name; the deploy workflow passes it into the build:

```bash
gh secret set VITE_CORS_PROXY_URL --repo dandi/dandi-medit
```

## Testing Locally

`npx wrangler dev` runs the worker on `http://localhost:8787` without deploying. A request with an allowed origin and an allowed target should return the page with an `Access-Control-Allow-Origin` header:

```bash
curl -s -D - -o /dev/null -H "Origin: http://localhost:5173" \
  "http://localhost:8787/?https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FHippocampus"
```

A request with no `Origin`, or with a target off the allowlist, returns a 403 with a JSON error body.
