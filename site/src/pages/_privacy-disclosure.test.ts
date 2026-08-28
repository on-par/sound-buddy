import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const privacySrc = readFileSync(fileURLToPath(new URL('./privacy.astro', import.meta.url)), 'utf8');
const readmeSrc = readFileSync(fileURLToPath(new URL('../../../README.md', import.meta.url)), 'utf8');
const feedbackSrc = readFileSync(fileURLToPath(new URL('../../../app/electron/feedback.ts', import.meta.url)), 'utf8');
const licenseRefreshSrc = readFileSync(fileURLToPath(new URL('../../../app/electron/license-refresh.ts', import.meta.url)), 'utf8');
const autoUpdaterSrc = readFileSync(fileURLToPath(new URL('../../../app/electron/auto-updater.ts', import.meta.url)), 'utf8');

describe('privacy page enumerates every outbound path (#1235 AC1)', () => {
  it('names the update check and its releases repo', () => {
    expect(privacySrc).toMatch(/update check/i);
    expect(privacySrc).toContain('sound-buddy-releases');
  });

  it('names license refresh', () => {
    expect(privacySrc).toMatch(/license refresh/i);
  });

  it('names the opt-in usage path by its real toggle label', () => {
    expect(privacySrc).toContain('Share anonymous usage counts');
  });

  it('names crash reports by its real toggle label', () => {
    expect(privacySrc).toContain('Send crash reports');
  });

  it('names feedback as user-initiated', () => {
    expect(privacySrc).toMatch(/feedback/i);
  });

  it('states the opt-ins are off by default', () => {
    expect(privacySrc).toMatch(/off by default/i);
  });
});

describe("privacy page drift-guards against the app's real endpoints (#1235 verification)", () => {
  const ingestUrl = feedbackSrc.match(/DEFAULT_INGEST_URL = '([^']+)'/)?.[1];
  const refreshUrl = licenseRefreshSrc.match(/DEFAULT_REFRESH_URL = '([^']+)'/)?.[1];
  const releasesRepo = autoUpdaterSrc.match(/RELEASES_REPO = '([^']+)'/)?.[1];

  it('finds the ingest URL constant and asserts the page names it', () => {
    expect(ingestUrl).toBeDefined();
    expect(privacySrc).toContain(ingestUrl!);
  });

  it('finds the license refresh URL constant and asserts the page names it', () => {
    expect(refreshUrl).toBeDefined();
    expect(privacySrc).toContain(refreshUrl!);
  });

  it('finds the releases repo constant and asserts the page names it', () => {
    expect(releasesRepo).toBeDefined();
    expect(privacySrc).toContain(releasesRepo!);
  });
});

describe('privacy page keeps the audio claim absolute (#1235 AC2)', () => {
  it('keeps the no-audio-leaves-your-machine callout', () => {
    expect(privacySrc).toContain('No audio data leaves your machine.');
    expect(privacySrc).toContain('We never upload, collect, or transmit your audio');
  });

  it('states none of the outbound paths ever carries audio', () => {
    expect(privacySrc).toContain('None of these ever carries your audio');
  });
});

describe('retired false claims are gone (#1235 AC1)', () => {
  it('no longer claims no telemetry from the app', () => {
    expect(privacySrc).not.toContain("We don't collect usage analytics or telemetry from the app");
    expect(privacySrc).not.toContain('The Sound Buddy app itself still sends nothing');
    expect(privacySrc).not.toContain('No telemetry from the app');
  });
});

describe('last-updated date reflects the change (#1235 AC4)', () => {
  it('bumps the updated date and drops the stale one', () => {
    expect(privacySrc).toContain('updated="August 27, 2026"');
    expect(privacySrc).not.toContain('updated="July 20, 2026"');
  });
});

describe('README makes no unqualified no-telemetry claim (#1235 AC3)', () => {
  it('drops the bare no-telemetry claim but keeps the audio claim', () => {
    expect(readmeSrc).not.toMatch(/no telemetry/i);
    expect(readmeSrc).toContain('Your audio never leaves your machine.');
  });
});
