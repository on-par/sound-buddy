import { describe, expect, it } from 'vitest';
import { buildReleaseNotes, planDmgNotarization, selectDmgArtifacts } from './index.js';

describe('index barrel', () => {
  it('re-exports buildReleaseNotes from install-instructions', () => {
    expect(buildReleaseNotes({ version: '1.0.0', signed: false })).toContain('Sound.Buddy-1.0.0-arm64-mac.zip');
  });

  it('re-exports selectDmgArtifacts and planDmgNotarization from dmg-notarization', () => {
    expect(selectDmgArtifacts(['/out/app.dmg'])).toEqual(['/out/app.dmg']);
    expect(planDmgNotarization([], {})).toEqual({
      notarize: false,
      reason: expect.stringContaining('APPLE_KEYCHAIN_PROFILE'),
    });
  });
});
