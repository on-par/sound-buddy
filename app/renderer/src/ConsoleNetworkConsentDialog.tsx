// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The mandatory Tier 2 (console-network/OSC-UDP) first-run consent modal
// (#378) — the only path capable of setting consoleNetworkConsentGranted to
// true. Mounted unconditionally alongside LicenseChrome (App.tsx); visibility
// is driven entirely by consoleNetworkConsentStore's dialogOpen, which only a
// future Tier 2 feature's requestConsent() call ever opens. Same
// rig-dialog/rig-dialog-card markup family as OnboardingDialog.tsx — no new
// stylesheet work needed.

import { useEffect, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useConsoleNetworkConsentStore } from './stores/consoleNetworkConsentStore';
import { CONSOLE_NETWORK_CONSENT_SCOPE } from '../../electron/console-network-consent';

export default function ConsoleNetworkConsentDialog(): JSX.Element {
  const { dialogOpen } = useStoreShallow(useConsoleNetworkConsentStore, (s) => ({ dialogOpen: s.dialogOpen }));

  /* c8 ignore start -- document-level Escape close, no jsdom in this harness;
     mirrors OnboardingDialog.tsx's identical, justified ignore. Escape always
     declines, never grants. */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && useConsoleNetworkConsentStore.getState().dialogOpen) {
        useConsoleNetworkConsentStore.getState().decline();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  /* c8 ignore stop */

  return (
    <div
      id="console-network-consent-dialog"
      className="rig-dialog"
      style={{ display: dialogOpen ? 'flex' : 'none' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="console-network-consent-title"
      /* c8 ignore next -- click dispatch, no jsdom; backdrop click always declines, never grants. */
      onClick={(e) => { if (e.target === e.currentTarget) useConsoleNetworkConsentStore.getState().decline(); }}
    >
      <div className="rig-dialog-card">
        <h2 id="console-network-consent-title" className="rig-dialog-title">
          Allow console network access?
        </h2>
        <p>Sound Buddy would read the following from your console over OSC/UDP:</p>
        <ul>
          {CONSOLE_NETWORK_CONSENT_SCOPE.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>
          Connects over OSC/UDP, scoped to your local network only — this never leaves your church&apos;s
          network, and there is no cloud relay. Read-only: Sound Buddy never writes to or changes console
          settings. You can revoke this anytime in Settings.
        </p>
        <div className="rig-dialog-actions">
          <button
            type="button"
            id="console-network-consent-decline"
            className="btn btn-secondary"
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => useConsoleNetworkConsentStore.getState().decline()}
          >
            Not now
          </button>
          <button
            type="button"
            id="console-network-consent-allow"
            className="btn btn-primary"
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => { void useConsoleNetworkConsentStore.getState().grant(); }}
          >
            Allow read-only access
          </button>
        </div>
      </div>
    </div>
  );
}
