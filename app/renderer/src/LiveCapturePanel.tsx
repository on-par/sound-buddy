// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Presentational counterpart to live-capture-panel.ts (#307, epic #302): the
// device picker, start/stop transport, and per-channel vertical-EQ meters
// rendered today by inline-app.js's imperative renderLiveMeters/
// renderLiveWorkspace, from the shared module's functions, so there is one
// source of truth for the live-capture panel's HTML. NOT mounted into the
// running app yet — inline-app.js still drives the live tab via the
// window.liveCapturePanel bridge (see App.tsx). Mounting is a later epic
// slice, once the imperative per-tick DOM patching (patchLiveChannel) is also
// componentized — a React mount here would fight that today. Runtime label
// resolution (window.rigReconcile.resolveStripLabel) and collapse
// persistence stay with the imperative renderer until then; this component
// falls back to `ch.name` (or "Ch N"), which real stream.py ticks always
// carry.
//
// Assumes a single instance per page, same as today's single #spectrum-body
// panel.

import {
  deviceOptionLabel,
  deviceChannelCount,
  liveMetersHTML,
  type LiveDevice,
  type StripConfig,
  type ChannelGroup,
  type LiveEvent,
  type StripView,
  type PanelView,
} from './live-capture-panel';

export interface LiveCapturePanelProps {
  devices: LiveDevice[];
  selectedDevice: string;            // '' = Default Device
  channels: StripConfig[];           // configured strips (channelConfig)
  isLive: boolean;
  onStart: () => void;
  onStop: () => void;
  meterEvents: LiveEvent[];          // stream.py JSON-lines events, oldest→newest
  liveMode?: 'monitor' | 'record';   // default 'monitor'
  groups?: ChannelGroup[];           // default []
}

export default function LiveCapturePanel({
  devices,
  selectedDevice,
  channels,
  isLive,
  onStart,
  onStop,
  meterEvents,
  liveMode = 'monitor',
  groups = [],
}: LiveCapturePanelProps) {
  let latestTick: LiveEvent | undefined;
  for (let i = meterEvents.length - 1; i >= 0; i--) {
    if (meterEvents[i].channels?.length > 0) { latestTick = meterEvents[i]; break; }
  }

  let metersHTML = '';
  if (latestTick) {
    const panel: PanelView = { deviceChannels: deviceChannelCount(selectedDevice, devices), liveRunning: isLive, liveMode, groups };
    const stripViews: StripView[] = latestTick.channels.map((ch, idx) => {
      const strip = channels[idx] ?? null;
      const groupIndex = groups.findIndex((g) => g.members.includes(idx));
      return {
        strip,
        displayName: ch.name ?? `Ch ${idx + 1}`,
        collapsed: false,
        // Mirrors window.armState.isArmed: a strip is armed unless explicitly
        // disarmed, so config with no `armed` field (e.g. loaded via
        // clampChannelConfig) still reads as armed.
        armed: !!strip && strip.armed !== false,
        groupIndex,
        groupCollapsed: !!groups[groupIndex]?.collapsed,
      };
    });
    metersHTML = liveMetersHTML(latestTick.channels, stripViews, panel);
  }

  return (
    <div>
      <div className="select-wrap">
        <select id="device-select" defaultValue={selectedDevice}>
          <option value="">Default Device</option>
          {devices.map((d) => <option key={d.index} value={String(d.index)}>{deviceOptionLabel(d)}</option>)}
        </select>
      </div>
      <button
        type="button"
        id="live-start-btn"
        className="btn btn-primary full"
        onClick={onStart}
        style={{ display: isLive ? 'none' : undefined }}
      >
        Start Capture
      </button>
      <button
        type="button"
        id="live-stop-btn"
        className="btn btn-danger full"
        onClick={onStop}
        style={{ display: isLive ? 'inline-flex' : 'none' }}
      >
        Stop Capture
      </button>
      {latestTick
        ? <div className="meter-card sb-live-meters" dangerouslySetInnerHTML={{ __html: metersHTML }} />
        : <div className="spectrum-empty">Waiting for live audio…</div>}
    </div>
  );
}
