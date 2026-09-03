# Deployment

The application is deployed to GitHub Pages by the workflow in `.github/workflows/deploy.yml`. Every push to `main` triggers it, and it can also be started by hand from the Actions tab. The build job checks out the repository, sets up Node 20 with npm caching, runs `npm ci` and `npm run build`, and uploads the `dist` directory as a Pages artifact. A second job deploys that artifact to the `github-pages` environment. Deployments are serialized through a `pages` concurrency group, and in-progress runs are allowed to finish rather than being cancelled.

The `CNAME` file in the repository root sets the custom domain to medit.dandiarchive.org, which is where the deployed application is served.

Nothing about the build is environment-specific. There are no secrets or environment variables to configure, because the DANDI API key and the optional OpenRouter API key are entered by the user in the browser at runtime and are never part of the build. To check a change before pushing, run `npm run build` locally and then `npm run preview`.
