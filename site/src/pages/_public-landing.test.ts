import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  resolveDownloadRedirect,
  validateLatestManifest,
  LATEST_MANIFEST_URL,
  GITHUB_RELEASES_PAGE_URL,
} from '../lib/latest-manifest';
import { REFUND_PATH } from '../lib/guarantee';
import { LEGAL_PAGE_PATHS } from '../../scripts/lib/site-mode-invariants.mjs';
import { checkCspOrigins, CF_ANALYTICS_SCRIPT_SRC, CF_ANALYTICS_CONNECT_SRC } from '../../scripts/lib/csp.mjs';

const indexSrc = readFileSync(fileURLToPath(new URL('./index.astro', import.meta.url)), 'utf8');
const privacySrc = readFileSync(fileURLToPath(new URL('./privacy.astro', import.meta.url)), 'utf8');
const headers = readFileSync(fileURLToPath(new URL('../../public/_headers', import.meta.url)), 'utf8');

describe('Live landing page describes Free vs Pro tiers (#1193 AC1)', () => {
  it('names a Free tier at $0', () => {
    expect(indexSrc).toContain("name: 'Free'");
    expect(indexSrc).toContain("price: '$0'");
  });

  it('names both Pro tiers', () => {
    expect(indexSrc).toContain("name: 'Pro Monthly'");
    expect(indexSrc).toContain("name: 'Pro Annual'");
  });

  it('publishes a Pro price alongside the Free tier', () => {
    expect(indexSrc).toContain("price: '$9'");
    expect(indexSrc).toContain("price: '$79'");
  });
});

describe('Download CTA is visible and routes through the request-time resolver (#1193 AC1/AC2)', () => {
  it('defines DOWNLOAD_URL as the /download redirect endpoint', () => {
    expect(indexSrc).toContain("const DOWNLOAD_URL = '/download'");
  });

  it('wires at least one CTA through DOWNLOAD_URL', () => {
    expect(indexSrc).toContain('href={DOWNLOAD_URL}');
  });

  it('never hardcodes a versioned release-zip URL in a CTA', () => {
    expect(indexSrc).not.toMatch(/href="https:\/\/github\.com\/on-par\/sound-buddy-releases\/releases\/download\//);
  });
});

describe('/download resolves to the current release (#1193 AC2)', () => {
  const validManifest = {
    schemaVersion: 1,
    version: '1.4.2',
    artifactUrl: 'https://github.com/on-par/sound-buddy-releases/releases/download/v1.4.2/Sound.Buddy-1.4.2-arm64-mac.zip',
    sha256: 'a'.repeat(64),
    artifactSizeBytes: 123456789,
    publishedAt: '2026-07-01T12:00:00Z',
  };

  it('accepts a contract-valid fixture manifest', () => {
    expect(validateLatestManifest(validManifest)).toEqual([]);
  });

  it('resolves a valid manifest to its artifactUrl as healthy', () => {
    expect(resolveDownloadRedirect(validManifest)).toEqual({
      location: validManifest.artifactUrl,
      healthy: true,
    });
  });

  it('degrades an invalid manifest to the releases page as unhealthy', () => {
    expect(resolveDownloadRedirect({})).toEqual({ location: GITHUB_RELEASES_PAGE_URL, healthy: false });
  });

  it('reads the stable "latest" manifest, i.e. the current release', () => {
    expect(LATEST_MANIFEST_URL).toContain('/releases/latest/download/latest.json');
  });
});

describe('Legal pages are linked in the footer (#1193 AC3)', () => {
  it('pins the refund path and the full set of legal page paths', () => {
    expect(REFUND_PATH).toBe('/refund');
    expect(LEGAL_PAGE_PATHS).toEqual(['/terms', '/privacy', '/refund']);
  });

  it('links all three legal pages from the footer', () => {
    expect(indexSrc).toContain('href={REFUND_PATH}');
    expect(indexSrc).toContain('href="/terms"');
    expect(indexSrc).toContain('href="/privacy"');
  });
});

describe('Host analytics (conversion tracking) is provisioned and disclosed (#1193 in-scope)', () => {
  const cspMatch = headers.match(/Content-Security-Policy:\s*([^\n]+)/);
  const cspValue = cspMatch?.[1] ?? '';

  it('finds the CSP line in public/_headers', () => {
    expect(cspValue).not.toBe('');
  });

  it('allows the Cloudflare Web Analytics beacon origins in the CSP', () => {
    expect(checkCspOrigins(cspValue)).toEqual([]);
    expect(cspValue).toContain(CF_ANALYTICS_SCRIPT_SRC);
    expect(cspValue).toContain(CF_ANALYTICS_CONNECT_SRC);
  });

  it('discloses Cloudflare Web Analytics on the privacy page', () => {
    expect(privacySrc).toContain('Cloudflare Web Analytics');
  });
});
