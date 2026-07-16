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
    pages/browser.astro      # Browser Lite: in-browser stereo analyzer + live decibel meter
    components/ReportCard.astro  # faithful mockup of the app's #report-card (the aha moment)
    components/BrowserAnalyzer.astro  # Browser Lite UI + local-only analysis wiring
    lib/spl-meter.ts         # pure DSP for the live meter (weighting, ballistics, target ranges)
    styles/tokens.css        # design-system tokens (framework-agnostic — ports to Next.js verbatim)
  public/favicon.svg
  scripts/verify-links.mjs   # post-build smoke + internal-link check (npm run verify)
  astro.config.mjs
```

No client JS is shipped on the landing page — the report card is static HTML/CSS. Browser
Lite (`/browser`) is the exception: its analyzer and live meter run client-side, entirely
in the visitor's own browser.

## Develop

```bash
cd site
npm install
npm run dev      # http://localhost:4321
npm run test     # vitest — unit tests for src/lib
npm run build    # → dist/
npm run verify   # astro check + test + build + link smoke
```

## Browser Lite live meter

The live decibel meter on `/browser` reads **dBFS** — level relative to the selected
input's digital full scale — not calibrated SPL. Browser microphone/line inputs have no
fixed gain reference, so there's no way to derive an absolute sound-pressure-level number
from a Web Audio stream without a calibrated mic and a user-supplied offset; that
calibration flow is out of scope here.

What the number does reflect, accurately:

- **A/C/Z frequency weighting** (`src/lib/spl-meter.ts`), computed with the standard IEC
  61672 analytic curves and applied as a differential correction against the FFT
  spectrum, on top of the existing time-domain RMS reading. Z (unweighted) exactly
  matches the existing "Body" dBFS card.
- **Slow (1 s) / fast (125 ms) ballistics**, matching handheld SPL meter response times —
  smoothing runs in the power domain, not the dB domain, so it integrates energy the way
  a real meter does.
- **Per-preset target windows** (dBFS, A-weighted slow) so a worship team can see at a
  glance whether live playback sits in the usual operating range for that preset.

Because it's dBFS rather than SPL, treat it as a **relative loudness window** for your own
room and system — not a legal or venue sound-limit reading.

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