// Cloudflare Pages static deploy — no adapter needed. CF Pages serves dist/.
// Set `site` to the production domain once the Pages project is live.
/** @type {import('astro').AstroUserConfig} */
export default {
  site: 'https://soundbuddy.app',
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
};