import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Guardrail for #91: Sound Buddy has **no usage caps on any tier**. No
// recording-count limit, no recordings-per-month limit, no recording-length
// cap, no storage quota. The free/Pro line is drawn on workflow features only
// (#54, #63). This test locks that in so it can't drift back via gating code —
// if someone adds a usage-based limit, this fails before it ships.

const appRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (rel: string) => fs.readFileSync(path.join(appRoot, rel), 'utf8');

// Every source file that participates in feature gating, main and renderer.
const GATING_SOURCES = [
  'electron/license.ts',
  'electron/ipc.ts',
  'electron/settings.ts',
  'renderer/license-state.js',
];

// camelCase / kebab identifiers a usage cap would introduce. These are code
// tokens, not prose — the guardrail comments that *say* "never recording
// count/length/size" won't match them, but an actual `maxRecordings` gate will.
const USAGE_CAP_IDENTIFIERS = [
  'maxRecordings',
  'recordingLimit',
  'recordingCap',
  'recordingsPerMonth',
  'maxRecordingLength',
  'maxDuration',
  'durationLimit',
  'durationCap',
  'storageLimit',
  'storageQuota',
  'storageCap',
  'maxStorage',
  'quotaBytes',
  'usageCap',
  'usageLimit',
];

// The only Pro-gated features that may exist — all workflow features, none
// usage-based. Mirror of PRO_FEATURES in license.ts / license-state.js.
const ALLOWED_PRO_FEATURES = new Set([
  'saved-rigs',
  'live-monitoring',
  'virtual-soundcheck',
  'ai-narrative',
]);

/** Pull the string literals out of a `['a', 'b', ...]` PRO_FEATURES definition. */
function extractProFeatures(src: string): string[] {
  const m = src.match(/PRO_FEATURES\s*=\s*(?:new Set\()?\[([^\]]*)\]/);
  if (!m) throw new Error('could not locate PRO_FEATURES definition');
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((mm) => mm[1]);
}

describe('#91 — no usage caps on any tier', () => {
  it('no gating source introduces a usage-cap identifier', () => {
    for (const rel of GATING_SOURCES) {
      const src = read(rel);
      for (const id of USAGE_CAP_IDENTIFIERS) {
        expect(src.includes(id), `${rel} must not gate on "${id}" — #91 forbids usage caps`).toBe(
          false,
        );
      }
    }
  });

  it('main and renderer Pro-feature sets contain only workflow features', () => {
    for (const rel of ['electron/license.ts', 'renderer/license-state.js']) {
      const features = extractProFeatures(read(rel));
      expect(features.length).toBeGreaterThan(0);
      for (const f of features) {
        expect(ALLOWED_PRO_FEATURES.has(f), `${rel}: "${f}" is not an allowed workflow gate`).toBe(
          true,
        );
      }
    }
  });

  it('license.ts documents the no-usage-cap guardrail', () => {
    const src = read('electron/license.ts');
    expect(src).toMatch(/never recording count\/length\/size \(#91\)/);
  });
});
