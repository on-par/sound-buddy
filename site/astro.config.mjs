// Static build, deployed to Cloudflare Workers (Workers Builds serves dist/).
// `site` is the canonical origin, used for canonical/OG URLs.
/** @type {import('astro').AstroUserConfig} */
export default {
  site: 'https://soundbuddy.online',
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  // CSP is script-src 'self' (site/public/_headers): never inline the page
  // script into HTML — emit it as an external /_astro/*.js file instead.
  vite: { build: { assetsInlineLimit: 0 } },
};