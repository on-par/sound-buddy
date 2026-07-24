// Single source of truth for the waitlist demo-video slot (#600). The video
// isn't recorded yet (#377), so an unset/empty PUBLIC_DEMO_VIDEO_URL is a
// first-class "placeholder" state — same pattern as founding-urgency.ts's
// isCheckoutLive(). Setting the env var at build time swaps in the embed.

/** Embed bases — named so the URL shapes aren't magic strings. */
export const YOUTUBE_EMBED_BASE = 'https://www.youtube-nocookie.com/embed/';
export const VIMEO_EMBED_BASE = 'https://player.vimeo.com/video/';

/** Copy for both states, exported so the component and tests share one source. */
export const DEMO_VIDEO_EYEBROW = 'See it in action';
export const PLACEHOLDER_HEADING = 'Demo video coming soon';
export const PLACEHOLDER_BODY =
  "We're recording a walkthrough of Sound Buddy grading a real Sunday service. Join the waitlist and we'll send it to you first.";
export const EMBED_HEADING = 'Watch Sound Buddy grade a real Sunday service';
export const EMBED_BODY = 'This is the actual report card workflow, on an unedited recording.';

export type DemoVideoState =
  | { mode: 'placeholder' } // URL unset/empty → coming-soon card
  | { mode: 'iframe'; embedUrl: string } // YouTube/Vimeo → iframe embed
  | { mode: 'file'; src: string }; // anything else → <video src>

const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com']);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com']);

/** Resolve the trimmed URL, or undefined when unset/empty/whitespace. */
export function demoVideoUrl(env: Record<string, string | undefined>): string | undefined {
  const url = env.PUBLIC_DEMO_VIDEO_URL?.trim();
  return url ? url : undefined;
}

/** Extract a YouTube video id from watch?v=, youtu.be/, /embed/, or /shorts/
 *  URL shapes; null when the URL isn't YouTube. */
export function youtubeVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.hostname === 'youtu.be') {
    const id = parsed.pathname.split('/').filter(Boolean)[0];
    return id ? id : null;
  }

  if (!YOUTUBE_HOSTS.has(parsed.hostname)) return null;

  const fromQuery = parsed.searchParams.get('v');
  if (fromQuery) return fromQuery;

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments[0] === 'embed' || segments[0] === 'shorts') {
    const id = segments[1];
    return id ? id : null;
  }

  return null;
}

/** Extract a numeric Vimeo video id from vimeo.com/<id>; null otherwise. */
export function vimeoVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (!VIMEO_HOSTS.has(parsed.hostname)) return null;

  const id = parsed.pathname.split('/').filter(Boolean)[0];
  return id && /^\d+$/.test(id) ? id : null;
}

export function demoVideoState(env: Record<string, string | undefined>): DemoVideoState {
  const url = demoVideoUrl(env);
  if (!url) return { mode: 'placeholder' };
  const yt = youtubeVideoId(url);
  if (yt) return { mode: 'iframe', embedUrl: `${YOUTUBE_EMBED_BASE}${yt}` };
  const vimeo = vimeoVideoId(url);
  if (vimeo) return { mode: 'iframe', embedUrl: `${VIMEO_EMBED_BASE}${vimeo}` };
  return { mode: 'file', src: url };
}
