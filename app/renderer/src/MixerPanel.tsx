// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type { JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useConsoleStore } from './stores/consoleStore';
import { useMixerStore } from './stores/mixerStore';
import { useSettingsStore } from './stores/settingsStore';
import { switchMode } from './mode-switch';
import { selectAttention, attentionForLink } from './mixer/attention';
import {
  boardTiles,
  calmChecks,
  cardView,
  dockView,
  queuedPill,
  railView,
  sermonBanner,
  channelLabel,
  linkNotice,
  toolbarView,
  type CardContext,
  type DockContext,
} from './mixer/view-model';
import { busRoutes } from './mixer/routing';
import { MixerBoard, MixerBuses, MixerCalm, MixerRouting, MixerSermonBanner, MixerToolbar, SermonQuietPill } from './mixer/MixerViews';
import { formatFreq, ringCandidates } from './mixer/room-ring';
import { MixerCard } from './mixer/MixerCard';
import { MixerDock } from './mixer/MixerDock';
import { MixerRail } from './mixer/MixerRail';
import { MixerInspector } from './mixer/MixerInspector';
import { inspectorView } from './mixer/inspector';
import { DEFAULT_MIXER_ATTENTION_CAP, MIXER_ATTENTION_CAPS } from '../../electron/ipc/api';

export const MIXER_NO_CONSOLE_TITLE = 'No console selected';
export const MIXER_NO_CONSOLE_BODY =
  'Choose your X32 or M32 on the Console tab, then start watching it. The Mixer reads that console and never changes it.';
export const MIXER_RANKED_COPY = 'ranked by severity';

function MixerEmptyState(): JSX.Element {
  return (
    <div className="mixer-empty" id="mixer-empty">
      <h2>{MIXER_NO_CONSOLE_TITLE}</h2>
      <p>{MIXER_NO_CONSOLE_BODY}</p>
      <button
        type="button"
        id="mixer-goto-console"
        className="btn btn-secondary"
        /* c8 ignore next -- click dispatch, no jsdom */
        onClick={() => switchMode('console')}
      >
        Go to Console
      </button>
    </div>
  );
}

export default function MixerPanel({ now: nowProp }: { now?: number }): JSX.Element | null {
  const appMode = useStoreShallow(useLiveCaptureStore, (s) => s.appMode);
  const con = useStoreShallow(useConsoleStore, (s) => ({
    selectedIp: s.selectedIp,
    identity: s.identity,
    liveStateStatus: s.liveStateStatus,
    liveChannels: s.liveChannels,
    liveMeters: s.liveMeters,
    liveStripDetail: s.liveStripDetail,
    liveSurfaces: s.liveSurfaces,
    link: s.link,
  }));
  const mx = useStoreShallow(useMixerStore, (s) => ({
    view: s.view,
    issues: s.issues,
    frozenIssues: s.frozenIssues,
    frozenAt: s.frozenAt,
    dismissals: s.dismissals,
    sermonQuiet: s.sermonQuiet,
    watched: s.watched,
    inspected: s.inspected,
    faderHistory: s.faderHistory,
    clipPeaks: s.history.clipPeak,
    moves: s.moves,
    roomCurve: s.roomCurve,
    ring: s.ring,
  }));
  const cap = useStoreShallow(useSettingsStore, (s) => s.settings?.mixerAttentionCap ?? DEFAULT_MIXER_ATTENTION_CAP);

  if (appMode !== 'mixer') return null;
  if (!con.selectedIp) return <MixerEmptyState />;

  const now = nowProp ?? Date.now();
  const roomListening = mx.roomCurve !== null;
  const ring =
    mx.ring.freq === null
      ? null
      : { freq: mx.ring.freq, freqLabel: formatFreq(mx.ring.freq), prominenceDb: mx.ring.prominence, candidates: ringCandidates(con.liveChannels, mx.watched) };
  const offline = con.link.status === 'offline';
  const metersAvailable = !con.link.metersDegraded;
  const live = selectAttention({ issues: mx.issues, now, cap, dismissals: mx.dismissals, sermonQuiet: mx.sermonQuiet });
  const frozen = mx.frozenIssues
    ? selectAttention({ issues: mx.frozenIssues, now, cap, dismissals: mx.dismissals, sermonQuiet: mx.sermonQuiet })
    : null;
  const attention = attentionForLink(offline, live, frozen);
  const inspected =
    mx.inspected ?? attention.visible.find((i) => i.channel !== null)?.channel ?? con.liveChannels[0]?.index ?? null;
  const ctx: CardContext = {
    channels: con.liveChannels,
    meters: con.liveMeters,
    metersAvailable,
    stripDetail: con.liveStripDetail,
    surfaces: con.liveSurfaces,
    faderHistory: mx.faderHistory,
    clipPeaks: mx.clipPeaks,
    ring,
    inspected,
    now,
  };
  const cards = attention.visible.map((i) => cardView(i, ctx));
  const pill = queuedPill(attention, con.liveChannels);
  const dockCtx: DockContext = {
    channels: con.liveChannels,
    meters: con.liveMeters,
    metersAvailable,
    surfaces: con.liveSurfaces,
    watched: mx.watched,
    sermonQuiet: mx.sermonQuiet,
    now,
  };
  const dock = dockView(attention, dockCtx);
  const routing = busRoutes(con.liveSurfaces, con.liveStripDetail, con.liveChannels, now);
  const toolbar = toolbarView({
    model: con.identity?.model ?? null,
    liveStateStatus: con.liveStateStatus,
    link: con.link,
    channelCount: con.liveChannels.length,
    attention,
    busesRead: routing.buses.filter((b) => b.read).length,
  });
  const calm = attention.visible.length === 0;
  const notice = linkNotice({ link: con.link, frozenAt: mx.frozenAt, now });
  const inspector =
    inspected === null
      ? null
      : inspectorView({
          index: inspected,
          channels: con.liveChannels,
          stripDetail: con.liveStripDetail,
          surfaces: con.liveSurfaces,
          moves: mx.moves,
          room: mx.roomCurve,
          ring: ring ? { freq: ring.freq, label: `Ring near ${ring.freqLabel}` } : null,
          now,
        });
  const rail = railView(attention, mx.moves, con.liveChannels, {
    sources: {
      model: con.identity?.model ?? null,
      offline,
      channelsRead: con.liveChannels.length > 0,
      metersAvailable,
      roomListening,
    },
    sermonQuiet: mx.sermonQuiet,
    ringFreq: ring?.freqLabel ?? null,
  });
  const banner = sermonBanner({
    watchLive: roomListening,
    watchedLabel: mx.watched === null ? null : channelLabel(con.liveChannels, mx.watched),
    heldCount: attention.held.length,
  });

  return (
    <div className="mixer" id="mixer-root">
      <div className="mx-main">
        <MixerToolbar toolbar={toolbar} view={mx.view}>
          <SermonQuietPill on={mx.sermonQuiet} />
        </MixerToolbar>
        {notice && (
          <p className={`mx-notice mx-sev-${notice.tone}`} id="mixer-link-notice" role="status">
            {notice.text}
          </p>
        )}
        {mx.view === 'attention' && mx.sermonQuiet && (
          <>
            <MixerSermonBanner banner={banner} />
            {cards.length > 0 && (
              <div className={`mx-cards mx-cards-${cap}`} id="mixer-cards">
                {cards.map((c) => (
                  <MixerCard key={c.key} card={c} frozen={attention.frozen} />
                ))}
              </div>
            )}
            <MixerBoard tiles={boardTiles(attention, dockCtx)} sermonQuiet title={`Board · ${con.liveChannels.length} channels`} />
            <MixerRouting routing={routing} />
          </>
        )}
        {mx.view === 'attention' && !mx.sermonQuiet && calm && (
          <>
            <MixerCalm checks={calmChecks({ channelCount: con.liveChannels.length, metersAvailable, roomListening })} />
            <MixerBoard tiles={boardTiles(attention, dockCtx)} sermonQuiet={mx.sermonQuiet} title={`Board · ${con.liveChannels.length} channels`} />
            <MixerRouting routing={routing} />
          </>
        )}
        {mx.view === 'attention' && !mx.sermonQuiet && !calm && (
          <>
            <div className="mx-sec-h">
              <span className="panel-title">Needs attention</span>
              <span className="mx-sec-sub">{`top ${cap} strips · ${MIXER_RANKED_COPY}`}</span>
              {pill && (
                <span className={`mx-queued mx-sev-${pill.severity}`} id="mixer-queued">
                  {pill.label}
                </span>
              )}
              <span className="mx-cap" role="group" aria-label="Cards shown at once">
                {MIXER_ATTENTION_CAPS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={c === cap ? 'mx-seg-on' : ''}
                    aria-pressed={c === cap}
                    /* c8 ignore next -- click dispatch, no jsdom */
                    onClick={() => void useSettingsStore.getState().updateSettings({ mixerAttentionCap: c })}
                  >
                    {c}
                  </button>
                ))}
              </span>
            </div>
            <div className={`mx-cards mx-cards-${cap}`} id="mixer-cards">
              {cards.map((c) => (
                <MixerCard key={c.key} card={c} frozen={attention.frozen} />
              ))}
            </div>
            <MixerInspector view={inspector} />
            <MixerDock dock={dock} sermonQuiet={mx.sermonQuiet} />
          </>
        )}
        {mx.view === 'all' && (
          <>
            <MixerBoard tiles={boardTiles(attention, dockCtx)} sermonQuiet={mx.sermonQuiet} title={`All channels · ${con.liveChannels.length}`} />
            <MixerInspector view={inspector} />
          </>
        )}
        {mx.view === 'buses' && <MixerBuses routing={routing} />}
      </div>
      <MixerRail rail={rail} />
    </div>
  );
}
