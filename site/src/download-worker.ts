// Cloudflare Worker entry for the site (#502). Resolves /download to the
// latest.json manifest's artifactUrl at request time — the zip asset name is
// versioned, so no static link can stay fresh across releases.
import { LATEST_MANIFEST_URL, GITHUB_RELEASES_PAGE_URL, resolveDownloadRedirect } from './lib/latest-manifest';

interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetsBinding;
}

export const DOWNLOAD_PATH = '/download';

const MANIFEST_FETCH_TIMEOUT_MS = 10_000;

function redirectTo(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      // A cached redirect would pin a stale artifactUrl past the next release.
      'Cache-Control': 'no-store',
    },
  });
}

/** Resolves /download by fetching the stable manifest and redirecting to its artifact. Degrades to the releases page on any failure. */
export async function handleDownload(fetchImpl: typeof fetch): Promise<Response> {
  try {
    const response = await fetchImpl(LATEST_MANIFEST_URL, {
      redirect: 'follow',
      signal: AbortSignal.timeout(MANIFEST_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return redirectTo(GITHUB_RELEASES_PAGE_URL);
    }
    const data = await response.json();
    const { location } = resolveDownloadRedirect(data);
    return redirectTo(location);
  } catch {
    return redirectTo(GITHUB_RELEASES_PAGE_URL);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === DOWNLOAD_PATH) return handleDownload(fetch);
    return env.ASSETS.fetch(request); // preserve static site + SPA fallback
  },
};
