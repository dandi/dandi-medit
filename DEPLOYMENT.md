# Deployment Guide

This guide covers deploying the client application.

## Prerequisites

- Node.js (v18 or later)
- npm or yarn
- GitHub account (for client deployment via GitHub Pages)

## Deploy the Client Application

### Step 1: Test Locally

```bash
npm install
npm run dev
```

The app should be available at `http://localhost:5173`.

### Step 2: Build for Production

```bash
npm run build
```

This creates an optimized build in the `dist/` directory.

### Step 3: Deploy to GitHub Pages

If you're using GitHub Pages (as indicated by the repo):

```bash
# Build the project
npm run build

# Deploy to GitHub Pages (method depends on your setup)
# If using gh-pages package:
npm install --save-dev gh-pages
npx gh-pages -d dist
```

Or configure GitHub Actions for automatic deployment (see below).

### GitHub Actions Deployment (Recommended)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [ main ]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v2
        with:
          path: ./dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v2
```

## Updating After Deployment

```bash
# In root directory
npm run build

# Then deploy using your method (GitHub Actions will auto-deploy on push)
```

## Troubleshooting

**Problem**: Build fails

**Solution**:
1. Clear node_modules: `rm -rf node_modules package-lock.json && npm install`
2. Check that all dependencies are installed

## Security Considerations

1. **API Keys**: Never commit API keys to the repository
2. **HTTPS**: Always use HTTPS for production deployments

## Cost Considerations

- **GitHub Pages**: Free for public repositories
