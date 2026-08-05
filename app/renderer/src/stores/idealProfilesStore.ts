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
import { resolveActiveProfile, isAutoSelected, curveEditorInit, type IdealCurvesApi } from '../ideal-profiles';
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
  pushActiveProfile(profile: IdealProfileLike, isAuto: boolean): void;
}

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
        const init = curveEditorInit(selectedId, customProfiles, deps.getCurrentSpectrum(), deps.getCurves());
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
        const existing = editor.editingId ? customProfiles.find((p) => p.id === editor.editingId) : undefined;
        const profile = curves.profileFromBands(editor.bands, GRID_FREQS, {
          id: editor.editingId ?? existing?.id,
          label: name,
          description: 'Custom ideal curve',
          createdAt: existing?.createdAt,
        });
        const next = curves.upsertProfile(customProfiles, profile);
        if (await persist(next, `custom:${profile.id}`)) get().closeEditor();
      },

      async capture() {
        const { editor, customProfiles } = get();
        const spectrum = deps.getCurrentSpectrum();
        if (!(spectrum && hasUsableCurve(spectrum))) {
          set({ editor: { ...editor, status: { text: 'Analyze a file with spectrum data first.', kind: 'err' } } });
          return;
        }
        const curves = deps.getCurves();
        const existing = editor.editingId ? customProfiles.find((p) => p.id === editor.editingId) : undefined;
        const name = editor.name.trim() || 'Current analysis target';
        const profile = curves.profileFromMeasuredCurve(spectrum.curve, GRID_FREQS, {
          id: editor.editingId ?? existing?.id,
          label: name,
          createdAt: existing?.createdAt,
        });
        if (!profile) {
          set({ editor: { ...editor, status: { text: 'This analysis cannot be used as a target.', kind: 'err' } } });
          return;
        }
        set((state) => ({ editor: { ...state.editor, bands: curves.bandOffsetsFromProfile(profile, GRID_FREQS) } }));
        const next = curves.upsertProfile(customProfiles, profile);
        if (await persist(next, `custom:${profile.id}`)) get().closeEditor();
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
        return persist(next, `custom:${profile.id}`);
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
  pushActiveProfile: (profile, isAuto) => useSpectrumStore.getState().setIdealProfile(profile, isAuto),
});
