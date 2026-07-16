// Shared CSP check: the site's script-src is 'self' (site/public/_headers),
// so any <script> tag without a src= attribute would be silently blocked at
// runtime. Both check-headers.mjs (whole dist/ tree) and check-browser-page.mjs
// (dist/browser/index.html specifically) need this same test.
const INLINE_SCRIPT_RE = /<script\b(?![^>]*\bsrc=)[^>]*>/i;

export function hasInlineScript(html) {
  return INLINE_SCRIPT_RE.test(html);
}
