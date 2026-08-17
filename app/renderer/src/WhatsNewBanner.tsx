// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Post-update "what's new" note (#271) — TD-001 slice 6k (#714): portaled by
// App.tsx onto #whats-new-banner-island, replacing inline-app.js's
// initWhatsNew() with a mounted component (same relocation UpdateBanner.tsx
// already did for initUpdates()). Closes the loop opened by the in-app "Send
// Feedback" flow (#143/#144): after the user updates, a dismissible,
// non-blocking banner credits shipped, user-requested items —
// "You asked, we shipped: …". Bundled with the release and read from disk
// (never fetched), gated once-per-version by window.whatsNewState +
// localStorage (mirrors the onboarding "seen once" idiom). Never shows for a
// build that ships no note or an empty one. whats-new-state.js and
// onboarding-state.js stay unchanged classic scripts, read via typed window
// casts — same pattern UpdateBanner.tsx uses for update-download-state.js.

import { useEffect, useState, type JSX } from 'react';
import { useElectron } from './useElectron';
import { iconSvg } from './report-card';

interface WhatsNewNote {
  title: string | null;
  items: string[];
}
interface WhatsNewStateApi {
  parseNote(markdown: string | null): WhatsNewNote | null;
  hasSeen(storage: Storage, version: string): boolean;
  markSeen(storage: Storage, version: string): void;
}
interface OnboardingStateApi {
  hasSeenOnboarding(storage: Storage): boolean;
}
function getWhatsNewState(): WhatsNewStateApi {
  return (window as unknown as { whatsNewState: WhatsNewStateApi }).whatsNewState;
}
function getOnboardingState(): OnboardingStateApi | undefined {
  return (window as unknown as { onboardingState?: OnboardingStateApi }).onboardingState;
}

export default function WhatsNewBanner(): JSX.Element {
  const api = useElectron();
  const [visible, setVisible] = useState(false);
  const [text, setText] = useState('');
  const [version, setVersion] = useState('');

  /* c8 ignore start -- IPC + localStorage glue, no jsdom in this harness;
     exercised by tests/e2e/report-card-basics.spec.ts (the banner is dormant
     unless a real bundled changelog + unseen version fire it). */
  useEffect(() => {
    void (async () => {
      // Dev/e2e escape hatch (SOUND_BUDDY_DISABLE_ONBOARDING): reuse the
      // app's established "suppress first-run surfaces in e2e" switch so
      // automated specs aren't disrupted by a banner appearing mid-run.
      try { if (api.isOnboardingDisabled && (await api.isOnboardingDisabled())) return; } catch { /* no bridge → proceed */ }

      const [appVersion, md] = await Promise.all([
        api.getAppVersion().catch(() => ''),
        api.getWhatsNew().catch(() => null),
      ]);
      if (!appVersion) return;

      // A genuine first launch shows the onboarding overlay instead —
      // crediting "shipped" changes to someone who just installed today (no
      // prior version to compare against) would be a non-sequitur competing
      // with that overlay. Mark this version seen so it doesn't
      // retroactively appear later either.
      const onboardingState = getOnboardingState();
      if (onboardingState && !onboardingState.hasSeenOnboarding(window.localStorage)) {
        getWhatsNewState().markSeen(window.localStorage, appVersion);
        return;
      }

      const note = getWhatsNewState().parseNote(md);
      if (!note || getWhatsNewState().hasSeen(window.localStorage, appVersion)) return;

      setText(note.title ? `${note.title}: ${note.items.join(' • ')}` : note.items.join(' • '));
      setVersion(appVersion);
      setVisible(true);
    })();
  }, [api]);
  /* c8 ignore stop */

  return (
    <div id="whats-new-banner" role="status" className={visible ? 'show' : ''}>
      <span className="ub-icon" dangerouslySetInnerHTML={{ __html: iconSvg('sparkles', 16) }} />
      <span className="lb-text" id="whats-new-text">{text}</span>
      <button
        type="button"
        id="whats-new-dismiss"
        className="ub-x"
        aria-label="Dismiss"
        /* c8 ignore next -- click dispatch, no jsdom */
        onClick={() => {
          if (version) getWhatsNewState().markSeen(window.localStorage, version);
          setVisible(false);
        }}
      >
        ✕
      </button>
    </div>
  );
}
