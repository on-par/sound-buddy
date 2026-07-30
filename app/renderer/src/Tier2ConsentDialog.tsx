// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { useEffect, useState } from 'react';
import { TIER2_CONSENT_COPY, TIER2_CONSENT_REQUEST_EVENT } from './tier2-consent';
import { useSettingsStore } from './stores/settingsStore';

type Resolver = (granted: boolean) => void;

/**
 * App-level modal that fulfils Tier 2 activation requests. Future console
 * features call activateTier2Feature({ requestConsent: requestTier2Consent,
 * ... }) before constructing any transport; they cannot use Settings alone
 * as an implicit grant.
 */
export default function Tier2ConsentDialog() {
  const [resolveRequest, setResolveRequest] = useState<Resolver | null>(null);

  useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ resolve: Resolver }>).detail;
      setResolveRequest(() => detail.resolve);
    };
    window.addEventListener(TIER2_CONSENT_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(TIER2_CONSENT_REQUEST_EVENT, onRequest);
  }, []);

  async function respond(granted: boolean) {
    if (granted) await useSettingsStore.getState().updateSettings({ tier2ConsoleConsent: true });
    resolveRequest?.(granted);
    setResolveRequest(null);
  }

  return (
    <div
      id="tier2-consent-dialog"
      className="rig-dialog"
      style={{ display: resolveRequest ? 'flex' : 'none' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tier2-consent-title"
    >
      <div className="rig-dialog-card settings-dialog-card">
        <div className="rig-dialog-title" id="tier2-consent-title">Allow local console access?</div>
        <p className="ai-dialog-note" id="tier2-consent-copy">{TIER2_CONSENT_COPY}</p>
        <p className="ai-dialog-note">You can revoke this permission anytime in Settings.</p>
        <div className="rig-dialog-actions">
          <button type="button" className="btn btn-secondary sm" onClick={() => void respond(false)}>Not now</button>
          <button type="button" id="tier2-consent-allow" className="btn btn-primary sm" onClick={() => void respond(true)}>
            Allow read-only local access
          </button>
        </div>
      </div>
    </div>
  );
}
