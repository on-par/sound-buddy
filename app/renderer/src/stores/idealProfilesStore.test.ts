// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { GRID_FREQS } from '@sound-buddy/audio-engine/dist/profiles/index.js';
import { createIdealProfilesStore, useIdealProfilesStore, type IdealProfilesDeps } from './idealProfilesStore';
import type { IdealCurvesApi } from '../ideal-profiles';
import type { AppSettings, CustomIdealProfile, UpdateSettingsPatch } from '../../../electron/ipc/api';
import type { IdealProfileLike, SpectrumData } from '../spectrum-display';
import { useSpectrumStore } from './spectrumStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';

vi.useFakeTimers();
vi.setSystemTime(new Date('2026-07-08T12:00:00Z'));

// ideal-curves is a plain classic script (window.idealCurves / module.exports)
// — require the real implementation, same pattern as ideal-curves.test.ts.
const curves = require('../../ideal-curves.js') as IdealCurvesApi;

const usableSpectrum = (): SpectrumData => ({
  contentType: 'music',
  curve: { freqs: GRID_FREQS, db: GRID_FREQS.map(() => -20) },
});

function createFakeDeps() {
  const settingsCalls: UpdateSettingsPatch[] = [];
  const savedProfileCalls: CustomIdealProfile[][] = [];
  const pushedProfiles: { profile: IdealProfileLike; isAuto: boolean }[] = [];
  const editGatedCalls: number[] = [];
  let currentSpectrum: SpectrumData | null = null;
  let canEdit = true;
  let updateSettingsImpl = async (patch: UpdateSettingsPatch): Promise<unknown> => {
    settingsCalls.push(patch);
    return {};
  };
  let saveCustomProfilesImpl = async (profiles: CustomIdealProfile[]): Promise<unknown> => {
    savedProfileCalls.push(profiles);
    return {};
  };
  const deps: IdealProfilesDeps = {
    updateSettings: (patch) => updateSettingsImpl(patch),
    saveCustomProfiles: (profiles) => saveCustomProfilesImpl(profiles),
    getCurves: () => curves,
    getCurrentSpectrum: () => currentSpectrum,
    pushActiveProfile: (profile, isAuto) => {
      pushedProfiles.push({ profile, isAuto });
    },
    canEditCurves: () => canEdit,
    onEditGated: () => {
      editGatedCalls.push(1);
    },
  };
  return {
    deps,
    settingsCalls,
    savedProfileCalls,
    pushedProfiles,
    editGatedCalls,
    setSpectrum: (s: SpectrumData | null) => {
      currentSpectrum = s;
    },
    failUpdateSettings: (message: string) => {
      updateSettingsImpl = () => Promise.reject(new Error(message));
    },
    failSaveCustomProfiles: (message: string) => {
      saveCustomProfilesImpl = () => Promise.reject(new Error(message));
    },
    setCanEditCurves: (v: boolean) => {
      canEdit = v;
    },
  };
}

const customProfile = (overrides: Partial<CustomIdealProfile> = {}): CustomIdealProfile => ({
  id: 'sanctuary-ref',
  label: 'Sanctuary reference',
  description: 'Custom ideal curve',
  freqs: GRID_FREQS,
  dbOffsets: GRID_FREQS.map(() => 0),
  source: 'manual',
  createdAt: '2026-07-08T12:00:00.000Z',
  updatedAt: '2026-07-08T12:00:00.000Z',
  ...overrides,
});

describe('createIdealProfilesStore', () => {
  it('starts with no selection, no custom profiles, and a closed editor', () => {
    const { deps } = createFakeDeps();
    const store = createIdealProfilesStore(deps);

    expect(store.getState().selectedId).toBe('');
    expect(store.getState().customProfiles).toEqual([]);
    expect(store.getState().editor.open).toBe(false);
  });

  describe('hydrate', () => {
    it('seeds selectedId + customProfiles from settings and pushes the resolved profile', () => {
      const { deps, pushedProfiles } = createFakeDeps();
      const store = createIdealProfilesStore(deps);
      const settings = { idealProfile: 'flat', customIdealProfiles: [] } as unknown as AppSettings;

      store.getState().hydrate(settings);

      expect(store.getState().selectedId).toBe('flat');
      expect(pushedProfiles.at(-1)).toEqual({ profile: expect.objectContaining({ id: 'flat' }), isAuto: false });
    });

    it('normalizes settings.customIdealProfiles through the injected curves API', () => {
      const { deps } = createFakeDeps();
      const store = createIdealProfilesStore(deps);
      const settings = { idealProfile: '', customIdealProfiles: [customProfile()] } as unknown as AppSettings;

      store.getState().hydrate(settings);

      expect(store.getState().customProfiles).toEqual([customProfile()]);
    });

    it('defaults to no selection and no custom profiles when settings is null', () => {
      const { deps } = createFakeDeps();
      const store = createIdealProfilesStore(deps);

      store.getState().hydrate(null);

      expect(store.getState().selectedId).toBe('');
      expect(store.getState().customProfiles).toEqual([]);
    });
  });

  describe('syncActiveProfile', () => {
    it('pushes the profile resolved from the current selection + spectrum', () => {
      const { deps, pushedProfiles, setSpectrum } = createFakeDeps();
      setSpectrum(usableSpectrum());
      const store = createIdealProfilesStore(deps);
      store.setState({ selectedId: '' });

      store.getState().syncActiveProfile();

      expect(pushedProfiles.at(-1)).toEqual({ profile: expect.objectContaining({ id: 'worship-service' }), isAuto: true });
    });
  });

  describe('select', () => {
    it('sets selectedId, persists the choice, and resyncs the active profile', async () => {
      const { deps, settingsCalls, pushedProfiles } = createFakeDeps();
      const store = createIdealProfilesStore(deps);

      await store.getState().select('broadcast');

      expect(store.getState().selectedId).toBe('broadcast');
      expect(settingsCalls).toContainEqual({ idealProfile: 'broadcast' });
      expect(pushedProfiles.at(-1)).toEqual({ profile: expect.objectContaining({ id: 'broadcast' }), isAuto: false });
    });

    it('marks isAuto when selecting the empty (auto) value', async () => {
      const { deps, pushedProfiles } = createFakeDeps();
      const store = createIdealProfilesStore(deps);

      await store.getState().select('');

      expect(pushedProfiles.at(-1)?.isAuto).toBe(true);
    });

    it('still sets selectedId and resyncs when the settings write rejects (non-fatal)', async () => {
      const { deps, failUpdateSettings, pushedProfiles } = createFakeDeps();
      failUpdateSettings('disk full');
      const store = createIdealProfilesStore(deps);

      await store.getState().select('flat');

      expect(store.getState().selectedId).toBe('flat');
      expect(pushedProfiles.at(-1)).toEqual({ profile: expect.objectContaining({ id: 'flat' }), isAuto: false });
    });
  });

  describe('openEditor / closeEditor', () => {
    it('opens the editor before analysis for a new curve, seeded from the auto-resolved profile with capture disabled', () => {
      const { deps } = createFakeDeps();
      const store = createIdealProfilesStore(deps);

      store.getState().openEditor();

      expect(store.getState().editor.open).toBe(true);
      expect(store.getState().editor.editingId).toBeNull();
      expect(store.getState().editor.title).toBe('Create Ideal Curve');
      expect(store.getState().editor.name).toBe('Copy of Worship service');
      expect(store.getState().editor.bands).toHaveLength(7);
      expect(store.getState().editor.canCapture).toBe(false);
      expect(store.getState().editor.canDelete).toBe(false);
    });

    it('opens the editor for the selected custom profile', () => {
      const { deps } = createFakeDeps();
      const store = createIdealProfilesStore(deps);
      store.setState({ selectedId: 'custom:sanctuary-ref', customProfiles: [customProfile()] });

      store.getState().openEditor();

      expect(store.getState().editor.editingId).toBe('sanctuary-ref');
      expect(store.getState().editor.title).toBe('Edit Ideal Curve');
      expect(store.getState().editor.canDelete).toBe(true);
    });

    it('closes the editor without clearing its other fields', () => {
      const { deps } = createFakeDeps();
      const store = createIdealProfilesStore(deps);
      store.getState().openEditor();

      store.getState().closeEditor();

      expect(store.getState().editor.open).toBe(false);
      expect(store.getState().editor.title).toBe('Create Ideal Curve');
    });
  });

  describe('setEditorName / setEditorBand / resetFlat', () => {
    it('updates the editor name', () => {
      const { deps } = createFakeDeps();
      const store = createIdealProfilesStore(deps);
      store.getState().openEditor();

      store.getState().setEditorName('Sunday AM');

      expect(store.getState().editor.name).toBe('Sunday AM');
    });

    it('clamps a single band through the injected curves API', () => {
      const { deps } = createFakeDeps();
      const store = createIdealProfilesStore(deps);
      store.getState().openEditor();

      store.getState().setEditorBand(0, 100);

      expect(store.getState().editor.bands[0]).toBe(24);
    });

    it('resets every band to 0', () => {
      const { deps } = createFakeDeps();
      const store = createIdealProfilesStore(deps);
      store.getState().openEditor();
      store.getState().setEditorBand(2, 6);

      store.getState().resetFlat();

      expect(store.getState().editor.bands).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });
  });

  describe('save', () => {
    it('rejects an empty name without persisting', async () => {
      const { deps, settingsCalls, savedProfileCalls } = createFakeDeps();
      const store = createIdealProfilesStore(deps);
      store.getState().openEditor();
      store.getState().setEditorName('   ');

      await store.getState().save();

      expect(store.getState().editor.status).toEqual({ text: 'Name the curve first.', kind: 'err' });
      expect(store.getState().editor.open).toBe(true);
      expect(settingsCalls).toHaveLength(0);
      expect(savedProfileCalls).toHaveLength(0);
    });

    it('upserts, persists, selects the new custom profile, and closes the editor without analysis data', async () => {
      const { deps, settingsCalls, savedProfileCalls } = createFakeDeps();
      const store = createIdealProfilesStore(deps);
      store.getState().openEditor();
      store.getState().setEditorName('Sunday AM');

      await store.getState().save();

      expect(store.getState().editor.open).toBe(false);
      expect(store.getState().customProfiles).toHaveLength(1);
      expect(store.getState().customProfiles[0].label).toBe('Sunday AM');
      expect(store.getState().selectedId).toBe(`custom:${store.getState().customProfiles[0].id}`);
      expect(savedProfileCalls.at(-1)).toEqual(store.getState().customProfiles);
      expect(settingsCalls.at(-1)).toEqual({ idealProfile: store.getState().selectedId });
    });

    it('updates an existing custom profile in place without analysis data when editing it', async () => {
      const { deps } = createFakeDeps();
      const store = createIdealProfilesStore(deps);
      store.setState({ selectedId: 'custom:sanctuary-ref', customProfiles: [customProfile()] });
      store.getState().openEditor();
      store.getState().setEditorName('Renamed target');

      await store.getState().save();

      expect(store.getState().customProfiles).toHaveLength(1);
      expect(store.getState().customProfiles[0].id).toBe('sanctuary-ref');
      expect(store.getState().customProfiles[0].label).toBe('Renamed target');
    });

    it('sets an error status and keeps the editor open when the settings write fails', async () => {
      const { deps, failUpdateSettings } = createFakeDeps();
      failUpdateSettings('disk full');
      const store = createIdealProfilesStore(deps);
      store.getState().openEditor();
      store.getState().setEditorName('Sunday AM');

      await store.getState().save();

      expect(store.getState().editor.open).toBe(true);
      expect(store.getState().editor.status).toEqual({ text: 'Could not save curve settings.', kind: 'err' });
    });
  });

  describe('capture', () => {
    it('sets an error status when there is no current analysis', async () => {
      const { deps } = createFakeDeps();
      const store = createIdealProfilesStore(deps);
      store.getState().openEditor();

      await store.getState().capture();

      expect(store.getState().editor.status).toEqual({ text: 'Analyze a file or start a live capture first.', kind: 'err' });
      expect(store.getState().editor.open).toBe(true);
    });

    it('sets an error status when the spectrum has no usable curve', async () => {
      const { deps, setSpectrum } = createFakeDeps();
      setSpectrum({ contentType: 'speech' });
      const store = createIdealProfilesStore(deps);
      store.getState().openEditor();

      await store.getState().capture();

      expect(store.getState().editor.status.kind).toBe('err');
    });

    it('captures the current curve, persists it, and closes the editor', async () => {
      const { deps, setSpectrum, settingsCalls, savedProfileCalls } = createFakeDeps();
      setSpectrum(usableSpectrum());
      const store = createIdealProfilesStore(deps);
      store.getState().openEditor();
      store.getState().setEditorName('Current mix');

      await store.getState().capture();

      expect(store.getState().editor.open).toBe(false);
      expect(store.getState().customProfiles[0].label).toBe('Current mix');
      expect(store.getState().customProfiles[0].source).toBe('analysis');
      expect(settingsCalls).toHaveLength(1);
      expect(savedProfileCalls).toHaveLength(1);
    });

    it('defaults the captured curve name to "Current analysis target" when the name field is empty', async () => {
      const { deps, setSpectrum } = createFakeDeps();
      setSpectrum(usableSpectrum());
      const store = createIdealProfilesStore(deps);
      store.getState().openEditor();
      store.getState().setEditorName('');

      await store.getState().capture();

      expect(store.getState().customProfiles[0].label).toBe('Current analysis target');
    });

    it('sets an error status when the measured curve cannot be used (grid mismatch)', async () => {
      const { deps, setSpectrum } = createFakeDeps();
      setSpectrum({ contentType: 'music', curve: { freqs: [20, 40], db: [-10, -12] } });
      const store = createIdealProfilesStore(deps);
      store.getState().openEditor();

      await store.getState().capture();

      expect(store.getState().editor.status).toEqual({ text: 'This analysis cannot be used as a target.', kind: 'err' });
      expect(store.getState().editor.open).toBe(true);
    });
  });

  describe('capture from a live capture (no file analysis)', () => {
    const liveBands = { subBass: -61, bass: -63, lowMid: -71, mid: -77, highMid: -96, presence: -93, brilliance: -104 };
    const withLive = (bands: Record<string, number> | null) => {
      const fake = createFakeDeps();
      const deps: IdealProfilesDeps = { ...fake.deps, getCurrentLiveBands: () => bands };
      return { ...fake, deps };
    };

    it('openEditor enables capture when live band levels are available', () => {
      const { deps } = withLive(liveBands);
      const store = createIdealProfilesStore(deps);
      store.getState().openEditor();
      expect(store.getState().editor.canCapture).toBe(true);
    });

    it('captures the live bands as a level-matched 7-band curve, persists it, and closes the editor', async () => {
      const { deps, settingsCalls } = withLive(liveBands);
      const store = createIdealProfilesStore(deps);
      store.getState().openEditor();
      store.getState().setEditorName('');

      await store.getState().capture();

      expect(store.getState().editor.open).toBe(false);
      const [profile] = store.getState().customProfiles;
      expect(profile.label).toBe('Live capture target');
      expect(profile.description).toBe('Captured from a live capture');
      expect(profile.dbOffsets).toHaveLength(GRID_FREQS.length);
      expect(profile.dbOffsets[0]).toBeGreaterThan(profile.dbOffsets[GRID_FREQS.length - 1]);
      expect(settingsCalls[0]).toMatchObject({ idealProfile: `custom:${profile.id}` });
    });

    it('prefers the file curve when both a file analysis and live bands exist', async () => {
      const { deps, setSpectrum } = withLive(liveBands);
      setSpectrum(usableSpectrum());
      const store = createIdealProfilesStore(deps);
      store.getState().openEditor();
      await store.getState().capture();
      expect(store.getState().customProfiles[0].source).toBe('analysis');
    });

    it('errors when the live bands are unusable', async () => {
      const { deps } = withLive({ mid: -20 });
      const store = createIdealProfilesStore(deps);
      store.getState().openEditor();
      await store.getState().capture();
      expect(store.getState().editor.status).toEqual({ text: 'Analyze a file or start a live capture first.', kind: 'err' });
    });
  });

  describe('saveMeasuredBands', () => {
    const liveBands = { subBass: -61, bass: -63, lowMid: -71, mid: -77, highMid: -96, presence: -93, brilliance: -104 };

    it('saves the live bands under the given meta and selects the new curve', async () => {
      const { deps, settingsCalls, savedProfileCalls } = createFakeDeps();
      const store = createIdealProfilesStore(deps);
      const ok = await store.getState().saveMeasuredBands(liveBands, { id: 'strongmix-live', label: 'Target from Live capture — Crowd Mic' });
      expect(ok).toBe(true);
      expect(store.getState().selectedId).toBe('custom:strongmix-live');
      expect(store.getState().customProfiles[0].label).toBe('Target from Live capture — Crowd Mic');
      expect(store.getState().customProfiles[0].description).toBe('Captured from a live capture');
      expect(settingsCalls).toHaveLength(1);
      expect(savedProfileCalls).toHaveLength(1);
    });

    it('returns false without touching settings when the bands are unusable', async () => {
      const { deps, settingsCalls } = createFakeDeps();
      const store = createIdealProfilesStore(deps);
      expect(await store.getState().saveMeasuredBands(null, { label: 'x' })).toBe(false);
      expect(await store.getState().saveMeasuredBands({ mid: -1 }, { label: 'x' })).toBe(false);
      expect(settingsCalls).toHaveLength(0);
    });
  });

  describe('remove', () => {
    it('does nothing when the editor is not editing an existing custom profile', async () => {
      const { deps, settingsCalls } = createFakeDeps();
      const store = createIdealProfilesStore(deps);
      store.getState().openEditor();

      await store.getState().remove();

      expect(settingsCalls).toHaveLength(0);
      expect(store.getState().editor.open).toBe(true);
    });

    it('deletes the custom profile, clears the selection, persists, and closes the editor', async () => {
      const { deps, settingsCalls, savedProfileCalls } = createFakeDeps();
      const store = createIdealProfilesStore(deps);
      store.setState({ selectedId: 'custom:sanctuary-ref', customProfiles: [customProfile()] });
      store.getState().openEditor();

      await store.getState().remove();

      expect(store.getState().customProfiles).toEqual([]);
      expect(store.getState().selectedId).toBe('');
      expect(store.getState().editor.open).toBe(false);
      expect(savedProfileCalls.at(-1)).toEqual([]);
      expect(settingsCalls.at(-1)).toEqual({ idealProfile: '' });
    });
  });

  describe('saveMeasured', () => {
    it('upserts + persists the measured curve and returns true', async () => {
      const { deps } = createFakeDeps();
      const store = createIdealProfilesStore(deps);

      const ok = await store.getState().saveMeasured(
        { freqs: GRID_FREQS, db: GRID_FREQS.map(() => -18) },
        { id: 'strongmix-service', label: 'Target from service', description: 'Saved from a strong-grading mix' }
      );

      expect(ok).toBe(true);
      expect(store.getState().customProfiles).toHaveLength(1);
      expect(store.getState().customProfiles[0].label).toBe('Target from service');
      expect(store.getState().selectedId).toBe('custom:strongmix-service');
    });

    it('returns false without persisting when the curve cannot be used as a target', async () => {
      const { deps, settingsCalls } = createFakeDeps();
      const store = createIdealProfilesStore(deps);

      const ok = await store.getState().saveMeasured(
        { freqs: [20, 40], db: [-10, -12] },
        { label: 'Bad curve' }
      );

      expect(ok).toBe(false);
      expect(settingsCalls).toHaveLength(0);
    });
  });

  describe('Pro gating (#1523) — canEditCurves() false', () => {
    it('openEditor does not open the editor and calls onEditGated once', () => {
      const { deps, setCanEditCurves, editGatedCalls } = createFakeDeps();
      setCanEditCurves(false);
      const store = createIdealProfilesStore(deps);

      store.getState().openEditor();

      expect(store.getState().editor.open).toBe(false);
      expect(editGatedCalls).toHaveLength(1);
    });

    it('save does not call saveCustomProfiles', async () => {
      const { deps, setCanEditCurves, savedProfileCalls, editGatedCalls } = createFakeDeps();
      const store = createIdealProfilesStore(deps);
      store.getState().openEditor();
      store.getState().setEditorName('Sunday AM');
      setCanEditCurves(false);

      await store.getState().save();

      expect(savedProfileCalls).toHaveLength(0);
      expect(editGatedCalls).toHaveLength(1);
    });

    it('capture does not call saveCustomProfiles', async () => {
      const { deps, setSpectrum, setCanEditCurves, savedProfileCalls, editGatedCalls } = createFakeDeps();
      setSpectrum(usableSpectrum());
      const store = createIdealProfilesStore(deps);
      store.getState().openEditor();
      setCanEditCurves(false);

      await store.getState().capture();

      expect(savedProfileCalls).toHaveLength(0);
      expect(editGatedCalls).toHaveLength(1);
    });

    it('remove does not call saveCustomProfiles', async () => {
      const { deps, setCanEditCurves, savedProfileCalls, editGatedCalls } = createFakeDeps();
      const store = createIdealProfilesStore(deps);
      store.setState({ selectedId: 'custom:sanctuary-ref', customProfiles: [customProfile()] });
      store.getState().openEditor();
      setCanEditCurves(false);

      await store.getState().remove();

      expect(savedProfileCalls).toHaveLength(0);
      expect(editGatedCalls).toHaveLength(1);
    });

    it('saveMeasured resolves false and calls onEditGated', async () => {
      const { deps, setCanEditCurves, savedProfileCalls, editGatedCalls } = createFakeDeps();
      setCanEditCurves(false);
      const store = createIdealProfilesStore(deps);

      const ok = await store.getState().saveMeasured(
        { freqs: GRID_FREQS, db: GRID_FREQS.map(() => -18) },
        { label: 'Target from service' }
      );

      expect(ok).toBe(false);
      expect(savedProfileCalls).toHaveLength(0);
      expect(editGatedCalls).toHaveLength(1);
    });

    it('saveMeasuredBands resolves false and calls onEditGated', async () => {
      const liveBands = { subBass: -61, bass: -63, lowMid: -71, mid: -77, highMid: -96, presence: -93, brilliance: -104 };
      const { deps, setCanEditCurves, savedProfileCalls, editGatedCalls } = createFakeDeps();
      setCanEditCurves(false);
      const store = createIdealProfilesStore(deps);

      const ok = await store.getState().saveMeasuredBands(liveBands, { label: 'Target from Live capture' });

      expect(ok).toBe(false);
      expect(savedProfileCalls).toHaveLength(0);
      expect(editGatedCalls).toHaveLength(1);
    });

    it('select() and hydrate() still work while gated (a saved curve loads for Free)', async () => {
      const { deps, setCanEditCurves, editGatedCalls } = createFakeDeps();
      setCanEditCurves(false);
      const store = createIdealProfilesStore(deps);

      store.getState().hydrate({ idealProfile: 'custom:sanctuary-ref', customIdealProfiles: [customProfile()] } as unknown as AppSettings);
      expect(store.getState().customProfiles).toEqual([customProfile()]);

      await store.getState().select('flat');
      expect(store.getState().selectedId).toBe('flat');
      expect(editGatedCalls).toHaveLength(0);
    });
  });
});

describe('useIdealProfilesStore (default singleton)', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    useIdealProfilesStore.setState({ selectedId: '', customProfiles: [], editor: useIdealProfilesStore.getInitialState().editor });
    useSpectrumStore.setState({ idealProfile: null, isAutoProfile: false });
  });

  it('binds to the window preload bridge and pushes into spectrumStore', async () => {
    const mock = createMockSoundBuddy({
      updateSettings: async (patch) => ({ idealProfile: (patch.idealProfile as string) ?? '', customIdealProfiles: [] }) as unknown as AppSettings,
    });
    (globalThis as { window?: unknown }).window = { soundBuddy: mock.api, idealCurves: curves };

    await useIdealProfilesStore.getState().select('flat');

    expect(useSpectrumStore.getState().idealProfile).toEqual(expect.objectContaining({ id: 'flat' }));
    expect(useSpectrumStore.getState().isAutoProfile).toBe(false);
  });
});
