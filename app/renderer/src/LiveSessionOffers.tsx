// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The post-stop session chrome (TD-001 slice 6i, #712): the #live-rc-cue cue
// ("listening builds a live Report Card as it runs") + the three offer rows
// (#rec-offer session-saved, #rc-offer report-card, #rc-not-enough degraded
// state), rendered from liveCaptureStore's sessionOffers/liveCueVisible. The
// capture-lifecycle module writes the store at onCaptureStarting/Stopped and
// promoteToRecording; this island renders the exact ids the e2e specs pin.
// Portaled by App.tsx onto #live-session-offers-island (replacing the static
// root-markup rows). The folder name renders as a React text node, so a path
// can never inject markup (#42). Button click dispatch is c8-ignored — no
// jsdom in this harness — and is exercised by tests/e2e/live-capture.spec.ts
// (reveal-folder) and live-capture-report-card.spec.ts (report-card nav).
// #1597: the three offer rows render as one compact #session-offers strip
// instead of stacked full-width bars, and the cue below is now gated by
// isCapturing too (via liveCueShown), not just liveCueVisible.

import type { JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore, type SessionOffers } from './stores/liveCaptureStore';
import { getSoundBuddy } from './useElectron';
import { iconSvg } from './report-card';
import { switchMode } from './mode-switch';

function hasSessionOffer(o: SessionOffers): boolean {
  return Boolean(o.sessionDir) || o.reportCard || o.notEnoughData;
}

// #1597: the #488 cue is idle-only — never alongside a running capture
// (incl. the #776 post-record monitor auto-resume) or the post-stop offers.
export function liveCueShown(liveCueVisible: boolean, isCapturing: boolean, offers: SessionOffers): boolean {
  return liveCueVisible && !isCapturing && !hasSessionOffer(offers);
}

export default function LiveSessionOffers(): JSX.Element {
  const { sessionOffers, liveCueVisible, isCapturing } = useStoreShallow(useLiveCaptureStore, (s) => ({
    sessionOffers: s.sessionOffers,
    liveCueVisible: s.liveCueVisible,
    isCapturing: s.isCapturing,
  }));
  const { sessionDir, reportCard, notEnoughData } = sessionOffers;
  const name = sessionDir ? sessionDir.split('/').pop() : null;
  const cueShown = liveCueShown(liveCueVisible, isCapturing, sessionOffers);
  const anyOffer = hasSessionOffer(sessionOffers);

  return (
    <>
      {/* #776/#1597: the cue is driven by liveCueVisible AND is idle-only —
          hidden while a capture is running (incl. the #776 post-record
          monitor auto-resume) or while any post-stop offer below is shown. */}
      <div id="live-rc-cue" style={cueShown ? undefined : { display: 'none' }}>
        Listening builds a live Report Card as it runs.
      </div>
      <div id="session-offers" className="session-offers" role="status" aria-label="Session ended" style={{ display: anyOffer ? 'flex' : 'none' }}>
        <div id="rec-offer" className="rec-offer" style={{ display: sessionDir ? 'flex' : 'none' }}>
          <span className="ro-text" id="rec-offer-text">Session saved <b>{name}</b>.</span>
          <button
            type="button"
            className="btn btn-secondary sm"
            id="rec-offer-btn"
            /* c8 ignore next -- click dispatch, no jsdom; live-capture.spec.ts */
            onClick={() => {
              if (!sessionDir) return;
              void getSoundBuddy().revealPath(sessionDir);
              useLiveCaptureStore.getState().setSessionOffers({ sessionDir: null });
            }}
          >
            {/* #865: iconSvg returns a raw SVG string — must go through
                dangerouslySetInnerHTML or React escapes it as literal text. */}
            <span className="ro-icon" dangerouslySetInnerHTML={{ __html: iconSvg('folder', 16) }} />Open folder
          </button>
        </div>
        <div id="rc-offer" className="rec-offer" style={{ display: reportCard ? 'flex' : 'none' }}>
          <span className="ro-text">Report card ready.</span>
          <button
            type="button"
            className="btn btn-secondary sm"
            id="rc-offer-btn"
            /* c8 ignore next -- click dispatch, no jsdom; live-capture-report-card.spec.ts */
            onClick={() => {
              useLiveCaptureStore.getState().setSessionOffers({ reportCard: false });
              switchMode('reportcard');
            }}
          >
            {/* #865: iconSvg returns a raw SVG string — must go through
                dangerouslySetInnerHTML or React escapes it as literal text. */}
            <span className="ro-icon" dangerouslySetInnerHTML={{ __html: iconSvg('clipboard-check', 16) }} />View report card
          </button>
        </div>
        <div id="rc-not-enough" className="rec-offer" style={{ display: notEnoughData ? 'flex' : 'none' }}>
          <span className="ro-text">Not enough data — monitor at least a few seconds of audio to generate a report card.</span>
        </div>
      </div>
    </>
  );
}
