// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The #tab-ringout Feedback Ring-Out Assistant wizard (#366, TD-001 slice
// 6e, #703) — portaled by App.tsx onto #tab-ringout, a pure render of
// stores/ringoutStore.ts's state into the same ids the static markup used,
// with buttons wired to store actions. feedback-ringout-state.js stays a
// classic script whose HTML-string functions are injected wholesale via
// dangerouslySetInnerHTML (same functions the old imperative renderer
// called) — only the click delegation moves to React.

import { useEffect, useState, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useRingoutStore, type RingoutCut, type RingoutProfile } from './stores/ringoutStore';
import { escapeHtml } from './spectrum-display';
import { iconSvg } from './report-card';

interface FeedbackRingoutApi {
  isFirstStep(i: number): boolean;
  isLastStep(i: number): boolean;
  stepHtml(index: number, escape: typeof escapeHtml): string;
  suggestionHtml(cut: RingoutCut | null, escape: typeof escapeHtml): string;
  profileRowHtml(profile: RingoutProfile, escape: typeof escapeHtml): string;
}
// feedback-ringout-state.js stays a classic script — read via a typed
// window cast, matching ReportCardIsland.tsx's getGrading()-style pattern.
function getFeedbackRingout(): FeedbackRingoutApi {
  return (window as unknown as { feedbackRingout: FeedbackRingoutApi }).feedbackRingout;
}

export default function RingoutPanel(): JSX.Element {
  const appMode = useStoreShallow(useLiveCaptureStore, (s) => s.appMode);
  const { stepIndex, cut, status, profiles, capturing } = useStoreShallow(useRingoutStore, (s) => ({
    stepIndex: s.stepIndex,
    cut: s.cut,
    status: s.status,
    profiles: s.profiles,
    capturing: s.capturing,
  }));
  const [manualInput, setManualInput] = useState('');
  const [profileName, setProfileName] = useState('');

  /* c8 ignore start -- storage re-read on tab entry, no jsdom in this
     harness; reload-on-every-visit is exercised by
     tests/e2e/live-capture-workspace.spec.ts. */
  useEffect(() => {
    if (appMode === 'ringout') useRingoutStore.getState().loadProfiles();
  }, [appMode]);
  /* c8 ignore stop */

  const ro = getFeedbackRingout();

  return (
    <>
      <span className="section-label">Ring-Out Assistant</span>
      <div className="bg-list" id="ringout-step" dangerouslySetInnerHTML={{ __html: ro.stepHtml(stepIndex, escapeHtml) }} />
      <div className="ro-nav">
        <button
          type="button"
          id="ringout-prev"
          className="ghost-btn sm"
          disabled={ro.isFirstStep(stepIndex)}
          onClick={() => useRingoutStore.getState().prev()}
        >
          Back
        </button>
        <button
          type="button"
          id="ringout-next"
          className="ghost-btn sm"
          disabled={ro.isLastStep(stepIndex)}
          onClick={() => useRingoutStore.getState().next()}
        >
          Next
        </button>
      </div>

      <span className="section-label">Capture</span>
      <button
        type="button"
        id="ringout-capture"
        className="btn btn-secondary sm full"
        disabled={capturing}
        dangerouslySetInnerHTML={{ __html: iconSvg('waveform', 16) + 'Capture from mic' }}
        /* c8 ignore next -- click dispatch, no jsdom */
        onClick={() => { void useRingoutStore.getState().captureFromMic(); }}
      />
      <p className="dz-hint" id="ringout-status">{status}</p>
      <div className="ro-manual">
        <input
          type="number"
          id="ringout-manual-input"
          placeholder="Frequency (Hz)"
          min="20"
          max="20000"
          value={manualInput}
          onChange={(e) => setManualInput(e.target.value)}
        />
        <button
          type="button"
          id="ringout-manual-apply"
          className="ghost-btn sm"
          onClick={() => useRingoutStore.getState().applyManual(manualInput)}
        >
          Use this frequency
        </button>
      </div>

      <span className="section-label">Suggested cut</span>
      <div id="ringout-suggestion" dangerouslySetInnerHTML={{ __html: ro.suggestionHtml(cut, escapeHtml) }} />

      <span className="section-label">Mic EQ profiles</span>
      <div className="ro-profile-save">
        <input
          type="text"
          id="ringout-profile-name"
          placeholder="Mic name (e.g. SM58)"
          value={profileName}
          onChange={(e) => setProfileName(e.target.value)}
        />
        <button
          type="button"
          id="ringout-profile-save"
          className="ghost-btn sm"
          onClick={() => {
            if (!profileName.trim() || !cut) return;
            useRingoutStore.getState().saveProfile(profileName);
            setProfileName('');
          }}
        >
          Save profile
        </button>
      </div>
      <div
        id="ringout-profile-list"
        dangerouslySetInnerHTML={{ __html: profiles.map((p) => ro.profileRowHtml(p, escapeHtml)).join('') }}
        /* c8 ignore next -- click delegation, no jsdom */
        onClick={(e) => {
          const target = e.target as HTMLElement;
          const row = target.closest<HTMLElement>('[data-mic]');
          if (!row?.dataset.mic) return;
          if (target.closest('.ro-profile-recall')) useRingoutStore.getState().recallProfile(row.dataset.mic);
          else if (target.closest('.ro-profile-delete')) useRingoutStore.getState().deleteProfile(row.dataset.mic);
        }}
      />
    </>
  );
}
