// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Settings → About plan/trial readout (#1191): shows the current plan status
// (free, trialing with days left, active Pro, lifetime, grace, expired) and,
// for any non-active-paid user, an "Upgrade to Pro" checkout CTA. Copy/status
// derivation comes from the pure window.upgradePrompt module (BOOT_SCRIPTS),
// matching UpgradeMomentum.tsx's window-cast + getSoundBuddy convention.

import type { JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLicensingStore } from './stores/licensingStore';
import { getSoundBuddy } from './useElectron';
import type { LicenseState } from '../../electron/ipc/api';

interface PlanStatusView {
  label: string;
  isPro: boolean;
  showUpgrade: boolean;
  trialDaysLeft: number | null;
}
interface UpgradePromptApi {
  UPGRADE_CTA_PLAN: 'monthly' | 'annual';
  UPGRADE_CTA_LABEL: string;
  planStatusView(state: LicenseState | null, now?: Date): PlanStatusView;
}
// upgrade-prompt.js stays a classic script — read via a typed window cast,
// matching UpgradeMomentum.tsx's getUpgradeMomentum()-style pattern.
function getUpgradePrompt(): UpgradePromptApi {
  return (window as unknown as { upgradePrompt: UpgradePromptApi }).upgradePrompt;
}

export default function SettingsPlanStatus(): JSX.Element {
  const licenseStatus = useStoreShallow(useLicensingStore, (s) => s.licenseStatus);
  const up = getUpgradePrompt();
  const view = up.planStatusView(licenseStatus ?? { tier: 'free', status: 'none' }, new Date());

  return (
    <div id="settings-plan-status" className="settings-plan-status">
      <span id="settings-plan-label">{view.label}</span>
      {view.showUpgrade && (
        <button
          type="button"
          id="settings-plan-upgrade"
          className="btn btn-primary sm"
          /* c8 ignore next -- click dispatch, no jsdom */
          onClick={() => {
            try { getSoundBuddy().openCheckout(up.UPGRADE_CTA_PLAN)?.catch(() => {}); }
            catch { /* preload missing */ }
          }}
        >
          {up.UPGRADE_CTA_LABEL}
        </button>
      )}
    </div>
  );
}
