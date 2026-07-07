// Static build, deployed to Cloudflare Workers (Workers Builds serves dist/).
// `site` is the canonical origin, used for canonical/OG URLs.
/** @type {import('astro').AstroUserConfig} */
export default {
  site: 'https://soundbuddy.online',
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
};