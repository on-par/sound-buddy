// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type { JSX } from 'react';
import { useConsoleStore } from '../stores/consoleStore';
import { useMixerStore, type MixerViewFilter } from '../stores/mixerStore';
import { MixerTile } from './MixerDock';
import { CALM_BODY, CALM_TITLE, type DockTile, type SermonBanner, type ToolbarView } from './view-model';
import type { RoutingView } from './routing';

const FILTERS: ReadonlyArray<{ view: MixerViewFilter; label: string; count: keyof ToolbarView['counts'] }> = [
  { view: 'attention', label: 'Needs Attention', count: 'attention' },
  { view: 'all', label: 'All Channels', count: 'all' },
  { view: 'buses', label: 'Buses', count: 'buses' },
];

export function MixerToolbar({ toolbar, view, children }: { toolbar: ToolbarView; view: MixerViewFilter; children?: JSX.Element }): JSX.Element {
  return (
    <div className="mx-tb" id="mixer-toolbar">
      <span className={`mx-conn mx-conn-${toolbar.chipState}`} id="mixer-conn">
        <span className="mx-conn-dot" />
        {toolbar.chipText}
      </span>
      {toolbar.showReconnect && (
        <button
          type="button"
          className="btn btn-secondary mx-reconnect"
          id="mixer-reconnect"
          /* c8 ignore next -- click dispatch, no jsdom */
          onClick={() => void useConsoleStore.getState().startLiveState()}
        >
          Reconnect
        </button>
      )}
      {toolbar.showStart && (
        <button
          type="button"
          className="btn btn-secondary"
          id="mixer-start-watching"
          /* c8 ignore next -- click dispatch, no jsdom */
          onClick={() => void useConsoleStore.getState().startLiveState()}
        >
          Start watching
        </button>
      )}
      <span className="mx-tb-spacer" />
      {children}
      <div className="mx-seg" role="group" aria-label="Mixer view">
        {FILTERS.map((f) => (
          <button
            key={f.view}
            type="button"
            className={f.view === view ? 'mx-seg-on' : ''}
            aria-pressed={f.view === view}
            data-view={f.view}
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => useMixerStore.getState().showView(f.view)}
          >
            {f.label}
            <span className="mx-seg-n">{toolbar.counts[f.count]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function MixerBoard({ tiles, sermonQuiet, title }: { tiles: DockTile[]; sermonQuiet: boolean; title: string }): JSX.Element {
  return (
    <section className="mx-board" id="mixer-board" aria-label={title}>
      <div className="mx-board-h">
        <span className="panel-title">{title}</span>
      </div>
      <div className="mx-board-grid">
        {tiles.map((t) => (
          <MixerTile key={t.channel} tile={t} sermonQuiet={sermonQuiet} />
        ))}
      </div>
    </section>
  );
}

export function MixerRouting({ routing }: { routing: RoutingView }): JSX.Element {
  const sending = routing.buses.filter((b) => b.channels.length > 0);
  return (
    <section className="mx-routing" id="mixer-routing" aria-label="Routing overview">
      <div className="mx-board-h">
        <span className="panel-title">Routing overview</span>
        <span className="mx-board-r">{routing.coverage}</span>
      </div>
      {sending.length === 0 ? (
        <p className="mx-muted">No active sends read yet.</p>
      ) : (
        sending.map((b) => (
          <div className="mx-route" key={b.index}>
            <span className="mx-route-chs" title={b.channels.join(', ')}>
              {b.ranges}
            </span>
            <span className="mx-route-arrow">→</span>
            <span className={b.on === false ? 'mx-route-bus mx-bus-off' : 'mx-route-bus'}>{b.label}</span>
          </div>
        ))
      )}
    </section>
  );
}

export function MixerBuses({ routing }: { routing: RoutingView }): JSX.Element {
  return (
    <div className="mx-buses-view" id="mixer-buses">
      <section className="mx-board" aria-label="Buses">
        <div className="mx-board-h">
          <span className="panel-title">Buses</span>
          <span className="mx-board-r">Bus meters unavailable</span>
        </div>
        <div className="mx-bus-list">
          {routing.buses.map((b) => (
            <div className={`mx-bus-row${b.on === false ? ' mx-bus-off' : ''}`} key={b.index} data-bus={b.index}>
              <span className="mx-bus-name">{b.label}</span>
              <span className="mx-bus-fader">{b.fader === null ? 'not read yet' : b.on ? b.fader : `off · ${b.fader}`}</span>
              <span className="mx-bus-age">{b.age}</span>
              <span className="mx-bus-chs">{b.channels.length === 0 ? 'No channels sending' : b.channels.join(', ')}</span>
            </div>
          ))}
        </div>
      </section>
      <MixerRouting routing={routing} />
    </div>
  );
}

export function MixerCalm({ checks }: { checks: string[] }): JSX.Element {
  return (
    <section className="mx-calm" id="mixer-calm">
      <div>
        <h2>{CALM_TITLE}</h2>
        <p>{CALM_BODY}</p>
        <ul className="mx-checks">
          {checks.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function SermonQuietPill({ on }: { on: boolean }): JSX.Element {
  return (
    <button
      type="button"
      className={on ? 'mx-sq mx-sq-on' : 'mx-sq'}
      id="mixer-sermon-quiet"
      aria-pressed={on}
      /* c8 ignore next -- click dispatch, no jsdom */
      onClick={() => useMixerStore.getState().toggleSermonQuiet()}
    >
      {on ? 'Sermon Quiet · Feedback only' : 'Sermon Quiet'}
      <span className="mx-sw" />
    </button>
  );
}

export function MixerSermonBanner({ banner }: { banner: SermonBanner }): JSX.Element {
  return (
    <section className={`mx-sermon${banner.live ? '' : ' mx-sermon-na'}`} id="mixer-sermon-banner">
      <div>
        <h2>{banner.title}</h2>
        <p>{banner.body}</p>
      </div>
      <span className="mx-sermon-held">{banner.held}</span>
    </section>
  );
}
