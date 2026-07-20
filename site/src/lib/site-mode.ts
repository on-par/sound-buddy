// Single source of truth for whether the public site shows the waitlist
// placeholder or the live pricing/download homepage (#597). Fails safe to
// "waitlist" on any unset or unrecognized value — never falls through to a
// buy button that isn't ready (e18-02..e18-06 all build behind this flag).
export type SiteMode = 'waitlist' | 'live';

export function resolveSiteMode(env: Record<string, string | undefined>): SiteMode {
  return env.PUBLIC_SITE_MODE?.trim() === 'live' ? 'live' : 'waitlist';
}
