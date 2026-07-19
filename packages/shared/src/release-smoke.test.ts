import { describe, expect, it } from 'vitest';
import { buildReleaseManifest } from './release-manifest.js';
import {
  checkAppUpdateLayer,
  checkArtifactLayer,
  checkManifestLayer,
  checkSiteRouteLayer,
  formatSmokeReport,
  isNewerVersion,
  runReleaseSmoke,
  SMOKE_LAYERS,
  DEFAULT_BASELINE_APP_VERSION,
  type ReleaseSmokeFetchers,
  type ReleaseSmokeReport,
} from './release-smoke.js';

const TAG = 'v0.4.2';
const ASSET_NAME = 'Sound.Buddy-0.4.2-arm64-mac.zip';

const MANIFEST_INPUT = {
  version: '0.4.2',
  notes: '## Highlights\n- Adds virtual soundcheck playback.',
  releaseUrl: 'https://github.com/on-par/sound-buddy-releases/releases/tag/v0.4.2',
  artifactUrl: `https://github.com/on-par/sound-buddy-releases/releases/download/v0.4.2/${ASSET_NAME}`,
  artifactSizeBytes: 123456789,
  sha256: 'a'.repeat(64),
  publishedAt: '2026-07-18T12:00:00Z',
};

const MANIFEST = buildReleaseManifest(MANIFEST_INPUT);

describe('checkManifestLayer', () => {
  it('passes on a valid manifest matching the tag', () => {
    const { result, manifest } = checkManifestLayer(TAG, 200, MANIFEST);
    expect(result.ok).toBe(true);
    expect(result.layer).toBe('manifest');
    expect(result.detail).toContain(`v${MANIFEST.version}`);
    expect(result.detail).toContain(TAG);
    expect(manifest).toEqual(MANIFEST);
  });

  it('fails on a non-2xx status', () => {
    const { result, manifest } = checkManifestLayer(TAG, 404, MANIFEST);
    expect(result.ok).toBe(false);
    expect(result.layer).toBe('manifest');
    expect(result.detail).toContain('HTTP 404');
    expect(result.detail).toContain('scripts/release.sh');
    expect(manifest).toBeNull();
  });

  it('fails and surfaces validation errors for an invalid body', () => {
    const { result, manifest } = checkManifestLayer(TAG, 200, { bad: true });
    expect(result.ok).toBe(false);
    expect(result.layer).toBe('manifest');
    expect(result.detail).toContain('schemaVersion');
    expect(manifest).toBeNull();
  });

  it('fails when the manifest version does not match the tag', () => {
    const { result, manifest } = checkManifestLayer('v9.9.9', 200, MANIFEST);
    expect(result.ok).toBe(false);
    expect(result.layer).toBe('manifest');
    expect(result.detail).toContain('v0.4.2');
    expect(result.detail).toContain('v9.9.9');
    expect(result.detail).toContain('releases/latest');
    expect(manifest).toBeNull();
  });

  it('fails when artifactUrl is not under the tag', () => {
    const bad = { ...MANIFEST, artifactUrl: 'https://github.com/on-par/sound-buddy-releases/releases/download/v0.0.1/x.zip' };
    const { result } = checkManifestLayer(TAG, 200, bad);
    expect(result.ok).toBe(false);
    expect(result.layer).toBe('manifest');
    expect(result.detail).toContain('artifactUrl');
  });

  it('fails when releaseUrl does not end with the tag', () => {
    const bad = { ...MANIFEST, releaseUrl: 'https://github.com/on-par/sound-buddy-releases/releases/tag/v0.0.1' };
    const { result } = checkManifestLayer(TAG, 200, bad);
    expect(result.ok).toBe(false);
    expect(result.layer).toBe('manifest');
    expect(result.detail).toContain('releaseUrl');
  });

  it('fails on a whitespace-only notesSummary', () => {
    const bad = { ...MANIFEST, notesSummary: '   ' };
    const { result } = checkManifestLayer(TAG, 200, bad);
    expect(result.ok).toBe(false);
    expect(result.layer).toBe('manifest');
    expect(result.detail).toContain('notesSummary');
  });
});

describe('checkArtifactLayer', () => {
  it('passes when size and sha256:-prefixed digest match', () => {
    const result = checkArtifactLayer(
      MANIFEST,
      { status: 200, contentLengthBytes: MANIFEST.artifactSizeBytes },
      `sha256:${MANIFEST.sha256}`,
    );
    expect(result.ok).toBe(true);
    expect(result.layer).toBe('artifact');
  });

  it('passes and skips the size check when contentLengthBytes is null', () => {
    const result = checkArtifactLayer(
      MANIFEST,
      { status: 200, contentLengthBytes: null },
      MANIFEST.sha256,
    );
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('skipped');
  });

  it('fails on a non-2xx head status', () => {
    const result = checkArtifactLayer(
      MANIFEST,
      { status: 404, contentLengthBytes: null },
      MANIFEST.sha256,
    );
    expect(result.ok).toBe(false);
    expect(result.layer).toBe('artifact');
    expect(result.detail).toContain('HTTP 404');
  });

  it('fails on a size mismatch', () => {
    const result = checkArtifactLayer(
      MANIFEST,
      { status: 200, contentLengthBytes: MANIFEST.artifactSizeBytes + 1 },
      MANIFEST.sha256,
    );
    expect(result.ok).toBe(false);
    expect(result.layer).toBe('artifact');
    expect(result.detail).toContain('size mismatch');
  });

  it('fails and propagates the checksum mismatch error', () => {
    const other = 'c'.repeat(64);
    const result = checkArtifactLayer(
      MANIFEST,
      { status: 200, contentLengthBytes: MANIFEST.artifactSizeBytes },
      other,
    );
    expect(result.ok).toBe(false);
    expect(result.layer).toBe('artifact');
    expect(result.detail).toContain(MANIFEST.sha256);
    expect(result.detail).toContain(other);
  });

  it('fails and propagates the empty-digest checksum error', () => {
    const result = checkArtifactLayer(
      MANIFEST,
      { status: 200, contentLengthBytes: MANIFEST.artifactSizeBytes },
      '',
    );
    expect(result.ok).toBe(false);
    expect(result.layer).toBe('artifact');
    expect(result.detail).toContain('shasum -a 256');
  });
});

describe('checkSiteRouteLayer', () => {
  it('passes when the redirect points at the manifest artifactUrl', () => {
    const result = checkSiteRouteLayer(MANIFEST, { status: 302, location: MANIFEST.artifactUrl });
    expect(result.ok).toBe(true);
    expect(result.layer).toBe('site-route');
  });

  it('fails with "degraded" wording when redirected to the releases-page fallback', () => {
    const result = checkSiteRouteLayer(MANIFEST, {
      status: 302,
      location: 'https://github.com/on-par/sound-buddy-releases/releases/latest',
    });
    expect(result.ok).toBe(false);
    expect(result.layer).toBe('site-route');
    expect(result.detail).toContain('degraded');
  });

  it('fails when redirected to an unrelated URL', () => {
    const result = checkSiteRouteLayer(MANIFEST, { status: 302, location: 'https://example.com/nope' });
    expect(result.ok).toBe(false);
    expect(result.layer).toBe('site-route');
    expect(result.detail).toContain('https://example.com/nope');
    expect(result.detail).toContain(MANIFEST.artifactUrl);
  });

  it('fails on a non-redirect status', () => {
    const result = checkSiteRouteLayer(MANIFEST, { status: 200, location: null });
    expect(result.ok).toBe(false);
    expect(result.layer).toBe('site-route');
  });

  it('fails when location is null', () => {
    const result = checkSiteRouteLayer(MANIFEST, { status: 302, location: null });
    expect(result.ok).toBe(false);
    expect(result.layer).toBe('site-route');
  });
});

describe('isNewerVersion', () => {
  it('returns true when latest is greater', () => {
    expect(isNewerVersion('0.3.0', '0.2.9')).toBe(true);
  });

  it('compares numerically, not lexicographically', () => {
    expect(isNewerVersion('0.10.0', '0.9.0')).toBe(true);
  });

  it('returns false when versions are equal', () => {
    expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false);
  });

  it('returns false when latest is older', () => {
    expect(isNewerVersion('1.0.0', '1.2.3')).toBe(false);
  });

  it('strips a leading "v"', () => {
    expect(isNewerVersion('v1.2.4', 'v1.2.3')).toBe(true);
  });

  it('strips a pre-release suffix', () => {
    expect(isNewerVersion('1.2.4-beta.1', '1.2.3')).toBe(true);
  });

  it('treats missing segments as 0 across differing segment counts', () => {
    expect(isNewerVersion('1.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('1.0.1', '1.0')).toBe(true);
  });
});

describe('checkAppUpdateLayer', () => {
  it('passes when the body is valid and newer than the baseline', () => {
    const result = checkAppUpdateLayer(MANIFEST, MANIFEST, DEFAULT_BASELINE_APP_VERSION);
    expect(result.ok).toBe(true);
    expect(result.layer).toBe('app-update');
  });

  it('fails naming the app parser when the body violates an app rule', () => {
    const badBody = { ...MANIFEST, schemaVersion: 0 };
    const result = checkAppUpdateLayer(badBody, MANIFEST, DEFAULT_BASELINE_APP_VERSION);
    expect(result.ok).toBe(false);
    expect(result.layer).toBe('app-update');
    expect(result.detail).toContain("app's update parser");
    expect(result.detail).toContain('schemaVersion');
  });

  it.each([
    ['version', { version: 'v0.4.2' }, 'version must be a semver string'],
    ['notesSummary', { notesSummary: 42 }, 'notesSummary must be a string'],
    ['releaseUrl', { releaseUrl: 'http://example.com' }, 'releaseUrl must be an https:// URL'],
    ['artifactUrl', { artifactUrl: 'http://example.com' }, 'artifactUrl must be an https:// URL'],
    ['sha256', { sha256: 'not-hex' }, 'sha256 must be 64 lowercase hex characters'],
    ['artifactSizeBytes', { artifactSizeBytes: 0 }, 'artifactSizeBytes must be a positive integer'],
  ])('fails naming the app parser when %s violates the app contract', (_field, override, expectedProblem) => {
    const badBody = { ...MANIFEST, ...override };
    const result = checkAppUpdateLayer(badBody, MANIFEST, DEFAULT_BASELINE_APP_VERSION);
    expect(result.ok).toBe(false);
    expect(result.layer).toBe('app-update');
    expect(result.detail).toContain(expectedProblem);
  });

  it('fails naming the field on a payload/manifest mismatch', () => {
    const badBody = { ...MANIFEST, version: '9.9.9' };
    const result = checkAppUpdateLayer(badBody, MANIFEST, DEFAULT_BASELINE_APP_VERSION);
    expect(result.ok).toBe(false);
    expect(result.layer).toBe('app-update');
    expect(result.detail).toContain('version');
  });

  it('fails when the app would not be offered the update', () => {
    const result = checkAppUpdateLayer(MANIFEST, MANIFEST, MANIFEST.version);
    expect(result.ok).toBe(false);
    expect(result.layer).toBe('app-update');
    expect(result.detail).toContain('would NOT be offered');
    expect(result.detail).toContain(MANIFEST.version);
  });

  it('fails on a non-object body', () => {
    const result = checkAppUpdateLayer(null, MANIFEST, DEFAULT_BASELINE_APP_VERSION);
    expect(result.ok).toBe(false);
    expect(result.layer).toBe('app-update');
  });
});

function makeFetchers(overrides: Partial<ReleaseSmokeFetchers> = {}): ReleaseSmokeFetchers {
  return {
    fetchManifest: async () => ({ status: 200, body: MANIFEST }),
    fetchArtifactHead: async () => ({ status: 200, contentLengthBytes: MANIFEST.artifactSizeBytes }),
    fetchArtifactDigest: async () => MANIFEST.sha256,
    fetchDownloadRedirect: async () => ({ status: 302, location: MANIFEST.artifactUrl }),
    ...overrides,
  };
}

describe('runReleaseSmoke', () => {
  it('returns ok: true with all 4 layers in order and version set on an all-green run', async () => {
    const report = await runReleaseSmoke({ tag: TAG }, makeFetchers());
    expect(report.ok).toBe(true);
    expect(report.results.map((r) => r.layer)).toEqual([...SMOKE_LAYERS]);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.version).toBe(MANIFEST.version);
  });

  it('skips downstream layers and calls no other fetcher when the manifest layer fails', async () => {
    let artifactHeadCalled = false;
    let artifactDigestCalled = false;
    let redirectCalled = false;
    const fetchers = makeFetchers({
      fetchManifest: async () => ({ status: 404, body: null }),
      fetchArtifactHead: async () => {
        artifactHeadCalled = true;
        return { status: 200, contentLengthBytes: null };
      },
      fetchArtifactDigest: async () => {
        artifactDigestCalled = true;
        return '';
      },
      fetchDownloadRedirect: async () => {
        redirectCalled = true;
        return { status: 302, location: null };
      },
    });
    const report = await runReleaseSmoke({ tag: TAG }, fetchers);
    expect(report.ok).toBe(false);
    expect(report.version).toBeNull();
    expect(report.results).toHaveLength(4);
    expect(report.results[0].ok).toBe(false);
    for (const result of report.results.slice(1)) {
      expect(result.ok).toBe(false);
      expect(result.detail).toContain('skipped');
      expect(result.detail).toContain('manifest layer failed');
    }
    expect(artifactHeadCalled).toBe(false);
    expect(artifactDigestCalled).toBe(false);
    expect(redirectCalled).toBe(false);
  });

  it('skips downstream layers with an actionable detail when fetchManifest rejects', async () => {
    const fetchers = makeFetchers({
      fetchManifest: async () => {
        throw new Error('network down');
      },
    });
    const report = await runReleaseSmoke({ tag: TAG }, fetchers);
    expect(report.ok).toBe(false);
    expect(report.results[0].ok).toBe(false);
    expect(report.results[0].detail).toContain('network down');
    for (const result of report.results.slice(1)) {
      expect(result.detail).toContain('skipped');
    }
  });

  it('stringifies a non-Error throw when a fetcher rejects', async () => {
    const fetchers = makeFetchers({
      fetchArtifactHead: async () => {
        throw 'boom-string';
      },
    });
    const report = await runReleaseSmoke({ tag: TAG }, fetchers);
    const artifact = report.results.find((r) => r.layer === 'artifact');
    expect(artifact?.ok).toBe(false);
    expect(artifact?.detail).toContain('boom-string');
  });

  it('fails only the layer whose fetcher rejects, others still run', async () => {
    const fetchers = makeFetchers({
      fetchArtifactHead: async () => {
        throw new Error('boom');
      },
    });
    const report = await runReleaseSmoke({ tag: TAG }, fetchers);
    expect(report.ok).toBe(false);
    const byLayer = Object.fromEntries(report.results.map((r) => [r.layer, r]));
    expect(byLayer.manifest.ok).toBe(true);
    expect(byLayer.artifact.ok).toBe(false);
    expect(byLayer.artifact.detail).toContain('boom');
    expect(byLayer['site-route'].ok).toBe(true);
    expect(byLayer['app-update'].ok).toBe(true);
  });

  it('derives assetName from the artifactUrl, decoding percent-escapes', async () => {
    let receivedTag: string | undefined;
    let receivedAsset: string | undefined;
    const encodedManifest = {
      ...MANIFEST,
      artifactUrl: 'https://github.com/on-par/sound-buddy-releases/releases/download/v0.4.2/Sound%20Buddy-0.4.2-arm64-mac.zip',
    };
    const fetchers = makeFetchers({
      fetchManifest: async () => ({ status: 200, body: encodedManifest }),
      fetchArtifactDigest: async (tag, assetName) => {
        receivedTag = tag;
        receivedAsset = assetName;
        return encodedManifest.sha256;
      },
      fetchDownloadRedirect: async () => ({ status: 302, location: encodedManifest.artifactUrl }),
    });
    await runReleaseSmoke({ tag: TAG }, fetchers);
    expect(receivedTag).toBe(TAG);
    expect(receivedAsset).toBe('Sound Buddy-0.4.2-arm64-mac.zip');
  });

  it('applies the default baseline app version when currentVersion is omitted', async () => {
    const report = await runReleaseSmoke({ tag: TAG }, makeFetchers());
    const appUpdate = report.results.find((r) => r.layer === 'app-update');
    expect(appUpdate?.ok).toBe(true);
  });
});

describe('formatSmokeReport', () => {
  it('formats a passing report with ✓ lines and a PASSED summary', async () => {
    const report = await runReleaseSmoke({ tag: TAG }, makeFetchers());
    const text = formatSmokeReport(report);
    expect(text).toContain('✓ manifest:');
    expect(text).toContain('✓ artifact:');
    expect(text).toContain('✓ site-route:');
    expect(text).toContain('✓ app-update:');
    expect(text).toContain(`RELEASE SMOKE PASSED for v${MANIFEST.version}`);
  });

  it('formats a failing report with ✖ lines and a FAILED summary listing broken layers', () => {
    const report: ReleaseSmokeReport = {
      ok: false,
      version: null,
      results: [
        { layer: 'manifest', ok: false, detail: 'nope' },
        { layer: 'artifact', ok: false, detail: 'skipped — manifest layer failed' },
        { layer: 'site-route', ok: false, detail: 'skipped — manifest layer failed' },
        { layer: 'app-update', ok: false, detail: 'skipped — manifest layer failed' },
      ],
    };
    const text = formatSmokeReport(report);
    expect(text).toContain('✖ manifest:');
    expect(text).toContain('RELEASE SMOKE FAILED — broken layer(s): manifest, artifact, site-route, app-update');
  });
});
