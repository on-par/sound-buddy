// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type { JSX } from 'react';
import { useMixerStore } from '../stores/mixerStore';
import { MixerScribble } from './MixerCard';
import type { DockTile, DockView } from './view-model';

export function MixerTile({ tile, sermonQuiet }: { tile: DockTile; sermonQuiet: boolean }): JSX.Element {
  const cls = [
    'mx-tile',
    tile.queuedSeverity ? `mx-tile-q mx-sev-${tile.queuedSeverity}` : '',
    tile.watched ? 'mx-tile-watch' : '',
    tile.dimmed ? 'mx-tile-dim' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={cls}
      data-channel={tile.channel}
      aria-pressed={sermonQuiet ? tile.watched : undefined}
      title={sermonQuiet ? 'Watch this mic for feedback' : 'Inspect this channel'}
      /* c8 ignore next 4 -- click dispatch, no jsdom */
      onClick={() =>
        sermonQuiet
          ? useMixerStore.getState().watchChannel(tile.channel)
          : useMixerStore.getState().inspectChannel(tile.channel)
      }
    >
      <MixerScribble scribble={tile.scribble} small />
      {tile.watched && <span className="mx-watch-tag">WATCH</span>}
      <span className="mx-tile-lv" title={tile.level.label}>
        {tile.level.available && <i style={{ width: `${tile.level.percent}%` }} />}
      </span>
    </button>
  );
}

export function MixerDock({ dock, sermonQuiet }: { dock: DockView; sermonQuiet: boolean }): JSX.Element {
  return (
    <section className="mx-dock" id="mixer-dock" aria-label="Channel dock">
      <div className="mx-dock-h">
        <span className="panel-title">{dock.header}</span>
        <span className="mx-dock-sub">queued strips wait here until a card frees up</span>
        <span className="mx-dock-r">
          {dock.buses.map((b) => (
            <span key={b.index} className={b.on ? 'mx-bus' : 'mx-bus mx-bus-off'}>
              {`${b.label} `}
              <b>{b.on ? b.fader : 'off'}</b> <span className="mx-bus-age">{b.age}</span>
            </span>
          ))}
          <span className="mx-unavailable">{dock.busMeters}</span>
          <span className="mx-unavailable">{dock.mainLufs}</span>
        </span>
      </div>
      <div className="mx-tiles">
        {dock.tiles.map((t) => (
          <MixerTile key={t.channel} tile={t} sermonQuiet={sermonQuiet} />
        ))}
      </div>
    </section>
  );
}
