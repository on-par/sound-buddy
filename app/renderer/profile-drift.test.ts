import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ─── Ideal-profile drift guard (#160, #138, #274) ────────────────────────────
//
// The renderer's IP_PROFILES block is a hand-maintained mirror of the engine's
// PROFILES (packages/audio-engine/src/profiles/index.ts) — the renderer is a
// bundler-free static page, so it can't import the package directly. Nothing
// stopped the two from silently diverging. This test evaluates the renderer's
// self-contained IP_* block in isolation and asserts its data is identical to
// the engine's, id-for-id.
//
// The block used to live inline in index.html; the Vite scaffold (#303)
// ported the inline script verbatim to src/inline-app.js, so this reads that
// file now — the block's content is unchanged.

import { PROFILES } from '../../packages/audio-engine/src/profiles/index.js';

const html = fs.readFileSync(fileURLToPath(new URL('./src/inline-app.js', import.meta.url)), 'utf8');

const START = 'const IP_GRID_POINTS = 48;';
const END = 'const IP_BY_ID';
const startIdx = html.indexOf(START);
const endIdx = html.indexOf(END, startIdx);
if (startIdx === -1 || endIdx === -1) {
  throw new Error('profile-drift: could not locate the IP_* block in index.html — did it move?');
}
const block = html.slice(startIdx, endIdx);

const IP_PROFILES = new Function(`${block}\n;return IP_PROFILES;`)();

describe('renderer IP_PROFILES === audio-engine PROFILES', () => {
  it('has the same set of profile ids', () => {
    expect(IP_PROFILES.map((p: { id: string }) => p.id).sort()).toEqual(
      PROFILES.map((p) => p.id).sort(),
    );
  });

  it.each(PROFILES.map((p) => [p.id, p]))('%s matches the engine profile', (_id, engineProfile) => {
    const rendererProfile = IP_PROFILES.find((p: { id: string }) => p.id === (engineProfile as { id: string }).id);
    expect(rendererProfile).toBeTruthy();
    const { id, label, description, freqs, dbOffsets } = engineProfile as {
      id: string;
      label: string;
      description: string;
      freqs: number[];
      dbOffsets: number[];
    };
    expect({ id: rendererProfile.id, label: rendererProfile.label, description: rendererProfile.description, freqs: rendererProfile.freqs, dbOffsets: rendererProfile.dbOffsets }).toEqual(
      { id, label, description, freqs, dbOffsets },
    );
  });

  it('detects a one-value divergence (the guard has teeth)', () => {
    const engine = PROFILES.find((p) => p.id === 'worship-service');
    const renderer = IP_PROFILES.find((p: { id: string }) => p.id === 'worship-service');
    expect(engine).toBeTruthy();
    expect(renderer).toBeTruthy();

    // Sanity: undamaged, the two agree (this is what the positive test asserts).
    expect(renderer.dbOffsets).toEqual(engine!.dbOffsets);

    // Deliberate test-only, in-memory one-value edit to a *clone* of the
    // renderer copy — proving the drift comparison actually fails on divergence.
    const mutated = {
      ...renderer,
      dbOffsets: renderer.dbOffsets.map((v: number, i: number) => (i === 3 ? v + 1 : v)),
    };
    expect(mutated.dbOffsets).not.toEqual(engine!.dbOffsets);
  });
});
