// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Owns the ideal-profile selection surface (TD-001 slice 6b, #700): the
// selected profile id, user-authored custom curves, and the curve-editor
// dialog's working state. Factory pattern mirroring settingsStore.ts — every
// side effect (settings persistence, the injected window.idealCurves UMD
// API, reading the current spectrum, pushing the resolved profile into
// spectrumStore) comes in via IdealProfilesDeps rather than a module-level
// import, per the constitution's "side effects are injected" rule. Replaces
// inline-app.js's idealProfileId/customIdealProfiles/curveEditorId/
// curveEditorBands module vars and their surrounding closures.

import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import type { AppSettings, CustomIdealProfile, UpdateSettingsPatch } from '../../../electron/ipc/api';
import { GRID_FREQS } from '@sound-buddy/audio-engine/dist/profiles/index.js';
import type { IdealProfileLike, SpectrumCurve, SpectrumData } from '../spectrum-display';
import { hasUsableCurve } from '../spectrum-display';
import {
  resolveActiveProfile,
  isAutoSelected,
  curveEditorInit,
  captureBandOffsets,
  hasUsableLiveBands,
  CUSTOM_PREFIX,
  type IdealCurvesApi,
} from '../ideal-profiles';
import { useAnalysisStore } from './analysisStore';
import { extractSpectrum, useSpectrumStore } from './spectrumStore';

export interface CurveEditorState {
  open: boolean;
  editingId: string | null;
  title: string;
  name: string;
  bands: number[];
  status: { text: string; kind: '' | 'err' };
  canCapture: boolean;
  canDelete: boolean;
}

const CLOSED_EDITOR: CurveEditorState = {
  open: false,
  editingId: null,
  title: '',
  name: '',
  bands: [],
  status: { text: '', kind: '' },
  canCapture: false,
  canDelete: false,
};

export interface IdealProfilesDeps {
  updateSettings(patch: UpdateSettingsPatch): Promise<unknown>;
  getCurves(): IdealCurvesApi;
  getCurrentSpectrum(): SpectrumData | null;
  /** The live-capture card's 7-band levels when a live source (and no file
   *  analysis) is showing — the capture-from-live input. Optional so existing
   *  callers/tests that never capture from live need no change. */
  getCurrentLiveBands?(): Record<string, number> | null;
  pushActiveProfile(profile: IdealProfileLike, isAuto: boolean): void;
}

export const LIVE_CAPTURE_TARGET_NAME = 'Live capture target';
export const NO_CAPTURE_SOURCE_TEXT = 'Analyze a file or start a live capture first.';

export interface IdealProfilesState {
  selectedId: string;
  customProfiles: CustomIdealProfile[];
  editor: CurveEditorState;
  hydrate(settings: AppSettings | null | undefined): void;
  syncActiveProfile(): void;
  select(id: string): Promise<void>;
  openEditor(): void;
  closeEditor(): void;
  setEditorName(name: string): void;
  setEditorBand(index: number, db: number): void;
  resetFlat(): void;
  save(): Promise<void>;
  capture(): Promise<void>;
  remove(): Promise<void>;
  saveMeasured(curve: SpectrumCurve | undefined, meta: { id?: string; label: string; description?: string; createdAt?: string }): Promise<boolean>;
  /** Save a live capture's 7-band levels as a custom curve (the live "save this mix as your target" path). */
  saveMeasuredBands(bands: Record<string, number> | null | undefined, meta: { id?: string; label: string; description?: string; createdAt?: string }): Promise<boolean>;
}

export function createIdealProfilesStore(deps: IdealProfilesDeps): UseBoundStore<StoreApi<IdealProfilesState>> {
  return create<IdealProfilesState>()((set, get) => {
    // Normalize + persist a next customProfiles/selectedId pair, then re-sync
    // the resolved active profile. Kept out of IdealProfilesState (not a
    // store action) so it stays a private implementation detail, mirroring
    // inline-app.js's persistCustomIdealProfiles.
    async function persist(nextProfiles: CustomIdealProfile[], nextSelectedId: string): Promise<boolean> {
      const customProfiles = deps.getCurves().normalizeProfiles(nextProfiles, GRID_FREQS);
      set({ customProfiles, selectedId: nextSelectedId });
      try {
        await deps.updateSettings({ customIdealProfiles: customProfiles, idealProfile: nextSelectedId });
      } catch {
        set((state) => ({ editor: { ...state.editor, status: { text: 'Could not save curve settings.', kind: 'err' } } }));
        return false;
      }
      get().syncActiveProfile();
      return true;
    }

    function liveBands(): Record<string, number> | null {
      return deps.getCurrentLiveBands ? deps.getCurrentLiveBands() : null;
    }

    // The custom profile the open editor is editing (undefined for a new
    // curve) — shared by save()/capture() so both derive `id`/`createdAt`
    // for the upserted profile from the same lookup.
    function editingProfile(): CustomIdealProfile | undefined {
      const { editor, customProfiles } = get();
      return editor.editingId ? customProfiles.find((p) => p.id === editor.editingId) : undefined;
    }

    return {
      selectedId: '',
      customProfiles: [],
      editor: CLOSED_EDITOR,

      hydrate(settings) {
        const selectedId = settings && typeof settings.idealProfile === 'string' ? settings.idealProfile : '';
        const customProfiles = deps.getCurves().normalizeProfiles(settings?.customIdealProfiles, GRID_FREQS);
        set({ selectedId, customProfiles });
        get().syncActiveProfile();
      },

      syncActiveProfile() {
        const { selectedId, customProfiles } = get();
        const profile = resolveActiveProfile(selectedId, customProfiles, deps.getCurrentSpectrum());
        deps.pushActiveProfile(profile, isAutoSelected(selectedId));
      },

      async select(id) {
        set({ selectedId: id });
        try {
          await deps.updateSettings({ idealProfile: id });
        } catch {
          /* non-fatal — mirrors inline's select handler, which swallows the write failure */
        }
        get().syncActiveProfile();
      },

      openEditor() {
        const { selectedId, customProfiles } = get();
        const init = curveEditorInit(selectedId, customProfiles, deps.getCurrentSpectrum(), deps.getCurves(), liveBands());
        set({
          editor: {
            open: true,
            editingId: init.editingId,
            title: init.title,
            name: init.name,
            bands: init.bands,
            status: { text: '', kind: '' },
            canCapture: init.canCapture,
            canDelete: init.canDelete,
          },
        });
      },

      closeEditor() {
        set((state) => ({ editor: { ...state.editor, open: false } }));
      },

      setEditorName(name) {
        set((state) => ({ editor: { ...state.editor, name } }));
      },

      setEditorBand(index, db) {
        const clampDb = deps.getCurves().clampDb;
        set((state) => {
          const bands = state.editor.bands.slice();
          bands[index] = clampDb(db);
          return { editor: { ...state.editor, bands } };
        });
      },

      resetFlat() {
        set((state) => ({ editor: { ...state.editor, bands: state.editor.bands.map(() => 0) } }));
      },

      async save() {
        const { editor, customProfiles } = get();
        const name = editor.name.trim();
        if (!name) {
          set({ editor: { ...editor, status: { text: 'Name the curve first.', kind: 'err' } } });
          return;
        }
        const curves = deps.getCurves();
        const existing = editingProfile();
        const profile = curves.profileFromBands(editor.bands, GRID_FREQS, {
          id: editor.editingId ?? existing?.id,
          label: name,
          description: 'Custom ideal curve',
          createdAt: existing?.createdAt,
        });
        const next = curves.upsertProfile(customProfiles, profile);
        if (await persist(next, `${CUSTOM_PREFIX}${profile.id}`)) get().closeEditor();
      },

      async capture() {
        const { editor, customProfiles } = get();
        const spectrum = deps.getCurrentSpectrum();
        const curves = deps.getCurves();
        const existing = editingProfile();
        const fileCurve = !!(spectrum && hasUsableCurve(spectrum));
        const bands = fileCurve ? null : liveBands();
        if (!fileCurve && !hasUsableLiveBands(bands)) {
          set({ editor: { ...editor, status: { text: NO_CAPTURE_SOURCE_TEXT, kind: 'err' } } });
          return;
        }
        const name = editor.name.trim() || (fileCurve ? 'Current analysis target' : LIVE_CAPTURE_TARGET_NAME);
        // A file analysis captures its fine 48-point curve; a live capture has
        // only the seven band levels, so its target is built from those.
        const profile = fileCurve
          ? curves.profileFromMeasuredCurve(spectrum!.curve, GRID_FREQS, {
              id: editor.editingId ?? existing?.id,
              label: name,
              createdAt: existing?.createdAt,
            })
          : curves.profileFromBands(captureBandOffsets(bands, (b) => curves.profileFromBands(b, GRID_FREQS, { label: name })), GRID_FREQS, {
              id: editor.editingId ?? existing?.id,
              label: name,
              description: 'Captured from a live capture',
              createdAt: existing?.createdAt,
            });
        if (!profile) {
          set({ editor: { ...editor, status: { text: 'This analysis cannot be used as a target.', kind: 'err' } } });
          return;
        }
        set((state) => ({ editor: { ...state.editor, bands: curves.bandOffsetsFromProfile(profile, GRID_FREQS) } }));
        const next = curves.upsertProfile(customProfiles, profile);
        if (await persist(next, `${CUSTOM_PREFIX}${profile.id}`)) get().closeEditor();
      },

      async remove() {
        const { editor, customProfiles } = get();
        if (!editor.editingId) return;
        const next = deps.getCurves().deleteProfile(customProfiles, editor.editingId);
        if (await persist(next, '')) get().closeEditor();
      },

      async saveMeasured(curve, meta) {
        const curves = deps.getCurves();
        const profile = curves.profileFromMeasuredCurve(curve, GRID_FREQS, meta);
        if (!profile) return false;
        const next = curves.upsertProfile(get().customProfiles, profile);
        return persist(next, `${CUSTOM_PREFIX}${profile.id}`);
      },

      async saveMeasuredBands(bands, meta) {
        if (!hasUsableLiveBands(bands)) return false;
        const curves = deps.getCurves();
        const profile = curves.profileFromBands(captureBandOffsets(bands, (b) => curves.profileFromBands(b, GRID_FREQS, { label: meta.label })), GRID_FREQS, {
          ...meta,
          description: meta.description ?? 'Captured from a live capture',
        });
        const next = curves.upsertProfile(get().customProfiles, profile);
        return persist(next, `${CUSTOM_PREFIX}${profile.id}`);
      },
    };
  });
}

function getIdealCurves(): IdealCurvesApi {
  return (window as unknown as { idealCurves: IdealCurvesApi }).idealCurves;
}

export const useIdealProfilesStore = createIdealProfilesStore({
  updateSettings: (patch) => getSoundBuddy().updateSettings(patch),
  getCurves: getIdealCurves,
  getCurrentSpectrum: () => extractSpectrum(useAnalysisStore.getState().currentAnalysis),
  // Only while the LIVE card is showing (no file analysis wins over it).
  getCurrentLiveBands: () => {
    const { currentAnalysis, liveSource } = useAnalysisStore.getState();
    return !currentAnalysis && liveSource ? liveSource.bands : null;
  },
  pushActiveProfile: (profile, isAuto) => useSpectrumStore.getState().setIdealProfile(profile, isAuto),
});
