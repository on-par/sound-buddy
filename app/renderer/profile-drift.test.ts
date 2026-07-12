import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ─── Ideal-profile import guard (#309, formerly the drift guard #160/#138/#274) ──
//
// The renderer used to hand-maintain a mirror of the engine's PROFILES
// (packages/audio-engine/src/profiles/index.ts) because it was a bundler-free
// static page and couldn't `import` the package. #303 introduced a Vite build,
// so #309 replaced the mirror: App.tsx now imports the engine's profiles module
// directly and bridges it onto `window.audioEngineProfiles`, and inline-app.js
// (still a classic `?raw` script) reads that bridge instead of duplicating data.
// Drift is now structurally impossible — this test just asserts the wiring
// stayed in place: the import in App.tsx, and no reintroduced inline literal.

const appTsxPath = fileURLToPath(new URL('./src/App.tsx', import.meta.url));
const inlineAppPath = fileURLToPath(new URL('./src/inline-app.js', import.meta.url));

const appTsx = fs.readFileSync(appTsxPath, 'utf8');
const inlineApp = fs.readFileSync(inlineAppPath, 'utf8');

describe('renderer imports ideal-EQ profiles from the audio-engine package', () => {
  it('App.tsx imports the engine profiles module', () => {
    expect(appTsx).toContain('packages/audio-engine/src/profiles/index.js');
  });

  it('inline-app.js no longer hand-mirrors the profile data', () => {
    expect(inlineApp).not.toContain('dbOffsets: [3.0, 3.0, 3.0, 15.0');
  });

  it('inline-app.js reads profiles off the window.audioEngineProfiles bridge', () => {
    expect(inlineApp).toContain('window.audioEngineProfiles');
  });
});
