import { describe, it, expect, afterEach, vi } from 'vitest';
import { handleDownload, DOWNLOAD_PATH } from './download-worker';
import { GITHUB_RELEASES_PAGE_URL } from './lib/latest-manifest';
import downloadWorker from './download-worker';

const validManifest = {
  schemaVersion: 1,
  version: '1.4.2',
  channel: 'stable',
  notesSummary: 'Bug fixes and performance improvements.',
  releaseUrl: 'https://github.com/on-par/sound-buddy-releases/releases/tag/v1.4.2',
  artifactUrl: 'https://github.com/on-par/sound-buddy-releases/releases/download/v1.4.2/Sound.Buddy-1.4.2-arm64-mac.zip',
  artifactSizeBytes: 123456789,
  sha256: 'a'.repeat(64),
  publishedAt: '2026-07-01T12:00:00Z',
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('handleDownload', () => {
  it('redirects to the artifactUrl for a valid manifest', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(validManifest));

    const response = await handleDownload(fetchImpl);

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(validManifest.artifactUrl);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('falls back to the releases page when the manifest fetch is non-ok', async () => {
    const fetchImpl = vi.fn(async () => new Response('not found', { status: 404 }));

    const response = await handleDownload(fetchImpl);

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(GITHUB_RELEASES_PAGE_URL);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('falls back to the releases page when the fetch rejects (network error)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });

    const response = await handleDownload(fetchImpl);

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(GITHUB_RELEASES_PAGE_URL);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('falls back to the releases page when the response body is invalid JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('not json', { status: 200 }));

    const response = await handleDownload(fetchImpl);

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(GITHUB_RELEASES_PAGE_URL);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('falls back to the releases page when the manifest JSON fails validation', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ...validManifest, sha256: 'bad' }));

    const response = await handleDownload(fetchImpl);

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(GITHUB_RELEASES_PAGE_URL);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('DOWNLOAD_PATH', () => {
  it('is /download', () => {
    expect(DOWNLOAD_PATH).toBe('/download');
  });
});

describe('default export fetch handler', () => {
  it('routes /download through handleDownload using the global fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(validManifest)),
    );
    const env = { ASSETS: { fetch: vi.fn() } };

    const response = await downloadWorker.fetch(new Request('https://soundbuddy.online/download'), env);

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(validManifest.artifactUrl);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it('delegates every other path to env.ASSETS.fetch untouched', async () => {
    const assetsResponse = new Response('asset body', { status: 200 });
    const assetsFetch = vi.fn(async () => assetsResponse);
    const env = { ASSETS: { fetch: assetsFetch } };
    const request = new Request('https://soundbuddy.online/anything-else');

    const response = await downloadWorker.fetch(request, env);

    expect(assetsFetch).toHaveBeenCalledWith(request);
    expect(response).toBe(assetsResponse);
  });
});
