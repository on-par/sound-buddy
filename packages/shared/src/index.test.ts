import { describe, expect, it } from 'vitest';
import { buildReleaseNotes } from './index.js';

describe('index barrel', () => {
  it('re-exports buildReleaseNotes from install-instructions', () => {
    expect(buildReleaseNotes({ version: '1.0.0', signed: false })).toContain('Sound.Buddy-1.0.0-arm64-mac.zip');
  });
});
