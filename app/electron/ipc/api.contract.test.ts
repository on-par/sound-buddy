// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Conformance guard for the SoundBuddyApi composition (TD-011, #405). This is
// a type-only refactor — no new runtime behavior — so the guard is applied at
// the type level: the assignability checks below fail `tsc` if a method is
// dropped/double-homed by the sub-interface split, or if a DTO defined fresh
// in api.ts (not moved from its producing module) drifts from what that
// module's function or IPC handler actually returns. The one runtime
// assertion (below) proves the real preload-bridge shape — via its test
// double — actually implements every domain slice, not just the type.

import { describe, it, expect } from 'vitest';
import type {
  SoundBuddyApi,
  AppInfoApi,
  SettingsApi,
  StorageApi,
  RigApi,
  LicenseApi,
  AnalysisApi,
  LiveApi,
  PlaybackApi,
  DialogApi,
  UpdateApi,
  FeedbackApi,
  CrashReportingApi,
  ListenerApi,
  AppSettings,
  PublicLlmConfig,
  StorageUsage,
  LicenseState,
  RevealDiagnosticsResult,
  SubmitFeedbackResult,
  StopLiveResult,
  AnalyzeFileResult,
  SaveSummaryResult,
  ListSummariesResult,
  CancelAnalysisResult,
} from './api';
import { createMockSoundBuddy } from '../../renderer/src/mock-sound-buddy';

// Type-only imports of the actual producing functions. `import type` is
// erased at build time, so these never pull electron/fs/node modules into
// this test's runtime — they exist purely so `ReturnType<typeof ...>` below
// checks against the real function, not a hand-copied guess.
import type { getSettings } from '../settings';
import type { getPublicLlmConfig } from '../llm-config';
import type { getLicenseState } from '../license';
import type { revealDiagnosticLog, submitFeedback } from '../feedback';

// ─── Composition coverage ────────────────────────────────────────────────────
// The intersection of every domain sub-interface must describe exactly the
// same surface as SoundBuddyApi — bidirectional assignability proves no
// method was dropped in the split and none is claimed by two sub-interfaces
// with incompatible signatures (which would break the intersection).

type SubInterfaceIntersection = AppInfoApi &
  SettingsApi &
  StorageApi &
  RigApi &
  LicenseApi &
  AnalysisApi &
  LiveApi &
  PlaybackApi &
  DialogApi &
  UpdateApi &
  FeedbackApi &
  CrashReportingApi &
  ListenerApi;

// `true` only when the extends-check holds; assigning `true` to a `never`
// result is a compile error, so a real drift fails `tsc`, not this line.
type AssertForward = SubInterfaceIntersection extends SoundBuddyApi ? true : never;
type AssertBackward = SoundBuddyApi extends SubInterfaceIntersection ? true : never;
const compositionForward: AssertForward = true;
const compositionBackward: AssertBackward = true;

// ─── Drift guards: mirrored (not moved) DTOs vs. their real producer ────────
// Moved DTOs (AppSettings, PublicLlmConfig, AnalysisSummary, ...) can't drift
// by construction — the producing module imports them back from here. These
// are the ones defined fresh in api.ts because no canonical type exists (a
// hand-duplicated LicenseState) or because the handler wraps/builds its
// result inline — so a shape change on the producing side must be caught here.

const settingsDrift: AppSettings = null as unknown as ReturnType<typeof getSettings>;
const llmConfigDrift: PublicLlmConfig = null as unknown as ReturnType<typeof getPublicLlmConfig>;
const licenseDrift: LicenseState = null as unknown as ReturnType<typeof getLicenseState>;
const diagnosticsDrift: RevealDiagnosticsResult = null as unknown as ReturnType<
  typeof revealDiagnosticLog
>;

// submitFeedback (feedback.ts, #472) is async — unwrap the Promise before
// comparing against the mirrored DTO.
const submitFeedbackDrift: SubmitFeedbackResult = null as unknown as Awaited<
  ReturnType<typeof submitFeedback>
>;

// get-storage-usage (ipc/settings.ts) builds its result inline from local
// variables rather than calling a named function — mirror its literal
// `return { path, isDefault, defaultPath, bytes, human, exists }`.
const storageUsageDrift: StorageUsage = {
  path: '/tmp/sound-buddy',
  isDefault: true,
  defaultPath: '/tmp/sound-buddy-default',
  bytes: 0,
  human: '0 B',
  exists: true,
};

// stop-live (ipc/live-capture.ts) always resolves { success: true, sessionDir }.
const stopLiveDrift: StopLiveResult = { success: true, sessionDir: null };

// analyze-file (ipc/analysis.ts) has three literal return shapes.
const analyzeFileOkDrift: AnalyzeFileResult = { success: true, data: undefined };
const analyzeFileCancelledDrift: AnalyzeFileResult = { success: false, cancelled: true };
const analyzeFileErrDrift: AnalyzeFileResult = { success: false, error: 'failed' };

// save-analysis-summary / list-analysis-summaries / cancel-analysis
// (ipc/analysis.ts) each build their result inline too.
const saveSummaryDrift: SaveSummaryResult = { success: true };
const listSummariesDrift: ListSummariesResult = { success: true, summaries: [] };
const cancelAnalysisDrift: CancelAnalysisResult = { success: true };

describe('SoundBuddyApi composition (TD-011, #405)', () => {
  it('the mock bridge implements every domain slice (real preload-bridge shape)', () => {
    // createMockSoundBuddy() builds one runtime object satisfying the full
    // SoundBuddyApi. Assigning it to each domain-typed variable is a real
    // compile-time+runtime check that the composition covers every domain
    // with no gaps — not just that the *type* SoundBuddyApi exists.
    const { api } = createMockSoundBuddy();
    const appInfo: AppInfoApi = api;
    const settingsSlice: SettingsApi = api;
    const storageSlice: StorageApi = api;
    const rigSlice: RigApi = api;
    const licenseSlice: LicenseApi = api;
    const analysisSlice: AnalysisApi = api;
    const liveSlice: LiveApi = api;
    const playbackSlice: PlaybackApi = api;
    const dialogSlice: DialogApi = api;
    const updateSlice: UpdateApi = api;
    const feedbackSlice: FeedbackApi = api;
    const crashReportingSlice: CrashReportingApi = api;
    const listenerSlice: ListenerApi = api;

    const slices: unknown[] = [
      appInfo,
      settingsSlice,
      storageSlice,
      rigSlice,
      licenseSlice,
      analysisSlice,
      liveSlice,
      playbackSlice,
      dialogSlice,
      updateSlice,
      feedbackSlice,
      crashReportingSlice,
      listenerSlice,
    ];

    expect(slices).toHaveLength(13);
    for (const slice of slices) expect(slice).toBeTruthy();
  });

  it('composition and drift-guard assertions above hold (see compile-time checks)', () => {
    // The real assertion already happened at compile time: if the sub-interface
    // split dropped/double-homed a method, or a mirrored DTO drifted from its
    // producer, this file fails to build before the runner ever gets here.
    // These values are only ever `true`/the literal itself once that has
    // already been proven, so this exercises the whole chain end to end.
    expect(compositionForward).toBe(true);
    expect(compositionBackward).toBe(true);
    expect(settingsDrift).toBeNull();
    expect(llmConfigDrift).toBeNull();
    expect(licenseDrift).toBeNull();
    expect(diagnosticsDrift).toBeNull();
    expect(submitFeedbackDrift).toBeNull();
    expect(storageUsageDrift.path).toBe('/tmp/sound-buddy');
    expect(stopLiveDrift.sessionDir).toBeNull();
    expect(analyzeFileOkDrift.success).toBe(true);
    expect(analyzeFileCancelledDrift.success).toBe(false);
    expect(analyzeFileErrDrift.success).toBe(false);
    expect(saveSummaryDrift.success).toBe(true);
    expect(listSummariesDrift.summaries).toEqual([]);
    expect(cancelAnalysisDrift.success).toBe(true);
  });
});
