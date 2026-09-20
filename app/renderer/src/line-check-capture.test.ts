// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { GRID_FREQS } from '@sound-buddy/audio-engine/dist/profiles/index.js';
import {
  capturedProfileId,
  buildLineCheckCaptureProfile,
  captureLineCheckProfile,
  type LineCheckCaptureDeps,
} from './line-check-capture';
import type { IdealCurvesApi } from './ideal-profiles';
import type { CustomIdealProfile } from '../../electron/ipc/api';

// ideal-curves is a plain classic script (window.idealCurves / module.exports)
// — require the real implementation, same pattern as idealProfilesStore.test.ts.
const curves = require('../ideal-curves.js') as IdealCurvesApi;

const CURVE = { freqs: GRID_FREQS, db: GRID_FREQS.map((_, i) => (i % 2 === 0 ? -18 : -24)) };

function createFakeDeps() {
  const settingsCalls: Array<{ customIdealProfiles: CustomIdealProfile[]; inputInstrumentProfiles: Record<string, Record<string, string>> }> = [];
  let customProfiles: CustomIdealProfile[] = [];
  let overrides: Record<string, Record<string, string>> = {};
  const deps: LineCheckCaptureDeps = {
    getCurves: () => curves,
    getCustomProfiles: () => customProfiles,
    getOverrides: () => overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recordOverride: (require('../instrument-profiles.js') as any).recordOverride,
    updateSettings: async (patch) => {
      settingsCalls.push(patch as never);
      customProfiles = patch.customIdealProfiles as CustomIdealProfile[];
      overrides = patch.inputInstrumentProfiles as Record<string, Record<string, string>>;
      return {};
    },
  };
  return { deps, settingsCalls, getCustomProfiles: () => customProfiles, getOverrides: () => overrides };
}

describe('capturedProfileId', () => {
  it('is deterministic for the same device + token', () => {
    expect(capturedProfileId('Scarlett 18i20', '0')).toBe(capturedProfileId('Scarlett 18i20', '0'));
  });

  it('differs for different tokens on the same device', () => {
    expect(capturedProfileId('Scarlett 18i20', '0')).not.toBe(capturedProfileId('Scarlett 18i20', '1'));
  });

  it('differs for different devices with the same token', () => {
    expect(capturedProfileId('Scarlett 18i20', '0')).not.toBe(capturedProfileId('X32', '0'));
  });

  it('fits within MAX_PROFILE_ID_LEN (64) once prefixed with "custom:", even for long names', () => {
    const id = capturedProfileId('A'.repeat(120), 'stereo-leg-b-and-more'.repeat(5));
    expect(`custom:${id}`.length).toBeLessThanOrEqual(64);
  });

  it('starts with the lc- prefix', () => {
    expect(capturedProfileId('Scarlett', '0').startsWith('lc-')).toBe(true);
  });

  it('falls back to a non-empty slug for an empty device name (Default Device)', () => {
    const id = capturedProfileId('', '0');
    expect(id).toMatch(/^lc-x-0-[0-9a-f]{8}$/);
  });

  it('falls back to a non-empty slug when the token has no slug-safe characters', () => {
    const id = capturedProfileId('Scarlett', '!!!');
    expect(id).toMatch(/^lc-scarlett-x-[0-9a-f]{8}$/);
  });

  it('an empty device name still differs from a real device name for the same token', () => {
    expect(capturedProfileId('', '0')).not.toBe(capturedProfileId('Scarlett', '0'));
  });
});

describe('buildLineCheckCaptureProfile', () => {
  it('builds a CustomIdealProfile via profileFromMeasuredCurve, keyed by the deterministic captured id', () => {
    const profile = buildLineCheckCaptureProfile(CURVE, GRID_FREQS, 'Scarlett 18i20', '0', 'Kick', curves);
    expect(profile).not.toBeNull();
    expect(profile!.id).toBe(capturedProfileId('Scarlett 18i20', '0'));
    expect(profile!.source).toBe('analysis');
    expect(profile!.label).toContain('Kick');
  });

  it('returns null when the curve is unusable (mirrors profileFromMeasuredCurve)', () => {
    const profile = buildLineCheckCaptureProfile(undefined, GRID_FREQS, 'Scarlett 18i20', '0', 'Kick', curves);
    expect(profile).toBeNull();
  });
});

describe('captureLineCheckProfile', () => {
  it('persists a CustomIdealProfile and an override keyed by device name + strip token (AC1, AC2)', async () => {
    const { deps, getCustomProfiles, getOverrides } = createFakeDeps();

    const ok = await captureLineCheckProfile(CURVE, GRID_FREQS, 'Scarlett 18i20', '0', 'Kick', deps);

    expect(ok).toBe(true);
    const id = capturedProfileId('Scarlett 18i20', '0');
    expect(getCustomProfiles()).toEqual([expect.objectContaining({ id })]);
    expect(getOverrides()).toEqual({ 'Scarlett 18i20': { '0': `custom:${id}` } });
  });

  it('effectiveProfileId resolves the captured profile through the same override-map lookup used for a built-in choice (AC2)', async () => {
    const { deps, getOverrides } = createFakeDeps();
    const { effectiveProfileId } = require('../instrument-profiles.js') as {
      effectiveProfileId: (overrides: Record<string, string> | null | undefined, token: string, label: string | undefined) => string;
    };

    await captureLineCheckProfile(CURVE, GRID_FREQS, 'Scarlett 18i20', '0', 'Kick', deps);

    const id = capturedProfileId('Scarlett 18i20', '0');
    const overridesForDevice = getOverrides()['Scarlett 18i20'];
    expect(effectiveProfileId(overridesForDevice, '0', 'Kick')).toBe(`custom:${id}`);
  });

  it('re-capturing the same strip token overwrites rather than duplicates the stored profile (AC3)', async () => {
    const { deps, getCustomProfiles, getOverrides } = createFakeDeps();

    await captureLineCheckProfile(CURVE, GRID_FREQS, 'Scarlett 18i20', '0', 'Kick', deps);
    const secondCurve = { freqs: GRID_FREQS, db: GRID_FREQS.map(() => -10) };
    await captureLineCheckProfile(secondCurve, GRID_FREQS, 'Scarlett 18i20', '0', 'Kick', deps);

    const id = capturedProfileId('Scarlett 18i20', '0');
    const stored = getCustomProfiles().filter((p) => p.id === id);
    expect(stored).toHaveLength(1);
    expect(stored[0].dbOffsets.every((v) => v === 0)).toBe(true);
    expect(getOverrides()).toEqual({ 'Scarlett 18i20': { '0': `custom:${id}` } });
  });

  it('captures for two different strip tokens on the same device without clobbering each other', async () => {
    const { deps, getCustomProfiles, getOverrides } = createFakeDeps();

    await captureLineCheckProfile(CURVE, GRID_FREQS, 'Scarlett 18i20', '0', 'Kick', deps);
    await captureLineCheckProfile(CURVE, GRID_FREQS, 'Scarlett 18i20', '1', 'Snare', deps);

    expect(getCustomProfiles()).toHaveLength(2);
    expect(getOverrides()['Scarlett 18i20']).toEqual({
      '0': `custom:${capturedProfileId('Scarlett 18i20', '0')}`,
      '1': `custom:${capturedProfileId('Scarlett 18i20', '1')}`,
    });
  });

  it('returns false and does not call updateSettings when the curve is unusable', async () => {
    const { deps, settingsCalls } = createFakeDeps();

    const ok = await captureLineCheckProfile(undefined, GRID_FREQS, 'Scarlett 18i20', '0', 'Kick', deps);

    expect(ok).toBe(false);
    expect(settingsCalls).toHaveLength(0);
  });
});
