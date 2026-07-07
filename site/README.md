# Sound Buddy — landing page

Single-page marketing site for Sound Buddy, built with [Astro](https://astro.build)
and deployed to Cloudflare Pages. Dark-first, King Midas gold — matches the app's
design tokens (copied from `app/renderer/index.html` so the page feels like the
product).

## Structure

```
site/
  src/
    layouts/Layout.astro     # <html> shell, fonts, tokens, global base styles
    pages/index.astro        # the single landing page (hero → trust → how → report card → pricing → privacy → sysreq → footer)
    components/ReportCard.astro  # faithful mockup of the app's #report-card (the aha moment)
    styles/tokens.css        # design-system tokens (framework-agnostic — ports to Next.js verbatim)
  public/favicon.svg
  scripts/verify-links.mjs   # post-build smoke + internal-link check (npm run verify)
  astro.config.mjs
```

No client JS is shipped — the report card is static HTML/CSS.

## Develop

```bash
cd site
npm install
npm run dev      # http://localhost:4321
npm run build    # → dist/
npm run verify   # astro check + build + link smoke
```

## Deploy

Cloudflare Workers Builds (the Cloudflare Git integration) builds and deploys
this site on every push. It's configured in the Cloudflare dashboard — Workers
Builds does **not** read build settings from `wrangler.jsonc`, so the dashboard
config is authoritative:

- **Root directory:** `site`
- **Build command:** `npm ci && npm run build`
- **Deploy command:** `npx wrangler deploy` (reads `site/wrangler.jsonc`)
- **Node version:** 22

`site/wrangler.jsonc` drives only the deploy step (Worker name `sound-buddy`,
static assets from `./dist`, SPA fallback). No GitHub Actions workflow or repo
secrets are involved.

## Porting to a future SaaS-lite

The tokens (`src/styles/tokens.css`) and the report-card markup
(`src/components/ReportCard.astro`) are framework-agnostic. If a SaaS-lite lands in
Next.js later, both port over with minimal change — the design system stays stable.