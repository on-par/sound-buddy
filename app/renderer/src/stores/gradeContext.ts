// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Resolves the GradeContext a report-card source is built with: the ideal EQ
// curve the band rules grade against (the Ideal selector's pick — Auto by
// content type for a file, the live default for a capture — or a custom
// captured/edited curve) plus the rubric's symptom sensitivity offset. One
// resolver for every source builder (ReportCardIsland, report-card-chrome,
// the Directory batch, the live bridge) so the four never disagree on which
// baseline a grade used. Factory pattern with injected store readers, per the
// constitution's "side effects are injected" rule.

import type { AppSettings, CustomIdealProfile } from '../../../electron/ipc/api';
import { gradeBaselineFor, symptomThresholdOffsetFrom, type GradeBaseline, type GradeContext } from '../report-card';
import { resolveActiveProfile, isAutoSelected } from '../ideal-profiles';
import { useIdealProfilesStore } from './idealProfilesStore';
import { useSettingsStore } from './settingsStore';

export interface GradeContextDeps {
  idealProfiles(): { selectedId: string; customProfiles: CustomIdealProfile[] };
  settings(): AppSettings | null;
}

export interface GradeContextResolver {
  /** The context for a file analysis' spectrum (null spectrum = live capture / no file). */
  forSpectrum(spectrum: { contentType?: string } | null): GradeContext;
  /** The live-capture baseline (Auto → the live default), attached to live sources. */
  liveBaseline(): GradeBaseline | null;
}

export function createGradeContextResolver(deps: GradeContextDeps): GradeContextResolver {
  const forSpectrum = (spectrum: { contentType?: string } | null): GradeContext => {
    const { selectedId, customProfiles } = deps.idealProfiles();
    const profile = resolveActiveProfile(selectedId, customProfiles, spectrum);
    return {
      idealProfile: profile,
      isAutoProfile: isAutoSelected(selectedId),
      symptomThresholdOffsetDb: symptomThresholdOffsetFrom(deps.settings()),
    };
  };
  return {
    forSpectrum,
    liveBaseline: () => gradeBaselineFor(forSpectrum(null)),
  };
}

export const gradeContext: GradeContextResolver = createGradeContextResolver({
  idealProfiles: () => useIdealProfilesStore.getState(),
  settings: () => useSettingsStore.getState().settings,
});
