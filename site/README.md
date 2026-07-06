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

Cloudflare Pages, driven by `.github/workflows/deploy-site.yml` (build + verify on
PRs; deploy on push to `main`). Required repo secrets:

- `CLOUDFLARE_API_TOKEN` — Pages-scoped API token
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID

Create the `sound-buddy` Pages project in the Cloudflare dashboard before the first
run, or let `cloudflare/pages-action` create it on first deploy.

### Switching to the Cloudflare Git integration instead

If you'd rather not use the action, connect the repo in the Cloudflare dashboard
directly and set:

- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Root directory:** `site`

Then delete `.github/workflows/deploy-site.yml`.

## Porting to a future SaaS-lite

The tokens (`src/styles/tokens.css`) and the report-card markup
(`src/components/ReportCard.astro`) are framework-agnostic. If a SaaS-lite lands in
Next.js later, both port over with minimal change — the design system stays stable.