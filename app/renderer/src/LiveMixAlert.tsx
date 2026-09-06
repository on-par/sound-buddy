// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type { JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import { getLiveAdjustmentsState } from './live-workspace-view';

export interface LiveMixAlertView {
  title: string;
  action: string;
}

export function lowEndMixAlertView(
  isCapturing: boolean,
  liveAdjustmentsEnabled: boolean,
  candidate: unknown,
): LiveMixAlertView | null {
  if (
    !isCapturing
    || liveAdjustmentsEnabled !== true
    || typeof candidate !== 'object'
    || candidate === null
    || !('id' in candidate)
    || !('scope' in candidate)
    || !('title' in candidate)
    || !('action' in candidate)
    || candidate.id !== 'low-end'
    || candidate.scope !== 'mix'
    || typeof candidate.title !== 'string'
    || typeof candidate.action !== 'string'
  ) {
    return null;
  }
  return { title: candidate.title, action: candidate.action };
}

export default function LiveMixAlert(): JSX.Element {
  const { isCapturing, lapCoaching } = useStoreShallow(useLiveCaptureStore, (s) => ({
    isCapturing: s.isCapturing,
    lapCoaching: s.lapCoaching,
  }));
  const settings = useStoreShallow(useSettingsStore, (s) => s.settings);
  const liveAdjustments = getLiveAdjustmentsState();
  const view = lowEndMixAlertView(
    isCapturing,
    liveAdjustments.isEnabled(settings),
    liveAdjustments.coachingView(lapCoaching, Date.now()).candidate,
  );

  if (!view) return <></>;
  return (
    <section id="live-mix-alert" className="live-mix-alert" role="alert">
      <strong className="live-mix-alert-title">{view.title}</strong>
      <span className="live-mix-alert-action">{view.action}</span>
    </section>
  );
}
