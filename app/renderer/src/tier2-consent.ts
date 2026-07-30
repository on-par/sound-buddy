// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

/** The disclosure shown before a Tier 2 feature can begin console networking. */
export const TIER2_CONSENT_COPY = [
  'Sound Buddy will read channel names, levels, and routing configuration from your console.',
  'It uses OSC over UDP on your local subnet only. No cloud relay is used, and console data is not persisted or transmitted beyond this LAN session.',
  'Access is read-only: Sound Buddy cannot change anything on your console.',
].join(' ');

export interface Tier2Activation {
  consentGranted: boolean;
  requestConsent: () => Promise<boolean>;
  persistConsent?: (granted: boolean) => Promise<void>;
  activate: () => void | Promise<void>;
}

/**
 * The common gate every future Tier 2 entry point calls before it does any
 * console work. Consent is requested before activation, never inferred from a
 * Settings toggle. A declined modal leaves the feature completely inactive.
 */
export async function activateTier2Feature({
  consentGranted,
  requestConsent,
  persistConsent,
  activate,
}: Tier2Activation): Promise<boolean> {
  if (!consentGranted) {
    const granted = await requestConsent();
    if (!granted) return false;
    await persistConsent?.(true);
  }
  await activate();
  return true;
}

export const TIER2_CONSENT_REQUEST_EVENT = 'sound-buddy:tier2-consent-request';

interface Tier2ConsentRequestDetail {
  resolve: (granted: boolean) => void;
}

/** Opens the first-run disclosure owned by Tier2ConsentDialog. */
export function requestTier2Consent(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    window.dispatchEvent(
      new CustomEvent<Tier2ConsentRequestDetail>(TIER2_CONSENT_REQUEST_EVENT, { detail: { resolve } })
    );
  });
}
