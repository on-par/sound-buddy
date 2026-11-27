// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type { JSX } from 'react';
import { useMixerStore } from '../stores/mixerStore';
import type { CardView, ScribbleView } from './view-model';

export function MixerScribble({ scribble, small }: { scribble: ScribbleView; small?: boolean }): JSX.Element {
  const cls = `mx-scrib ${scribble.colorClass}${scribble.inverted ? ' mx-inv' : ''}${small ? ' mx-scrib-sm' : ''}`;
  return (
    <span className={cls}>
      <span className="mx-scrib-no">{scribble.number}</span>
      <span className="mx-scrib-name">{scribble.name}</span>
      {scribble.icon !== null && (
        <span className="mx-scrib-icon" title={`Desk icon ${scribble.icon}`}>
          {scribble.icon}
        </span>
      )}
    </span>
  );
}

export function MixerCard({ card, frozen }: { card: CardView; frozen: boolean }): JSX.Element {
  return (
    <article className={`mx-card mx-sev-${card.severity}${card.inspected ? ' mx-card-sel' : ''}`} data-card-key={card.key}>
      {card.inspected && <span className="mx-inspect-tag">INSPECTING</span>}
      {card.scribble ? (
        <button
          type="button"
          className="mx-card-scrib"
          aria-label={`Inspect ${card.scribble.number} ${card.scribble.name}`}
          /* c8 ignore next -- click dispatch, no jsdom */
          onClick={() => useMixerStore.getState().inspectChannel(card.channel)}
        >
          <MixerScribble scribble={card.scribble} />
        </button>
      ) : (
        <span className="mx-scrib mx-c-room">
          <span className="mx-scrib-name">Room</span>
        </span>
      )}
      <div className="mx-card-row">
        <span className={`pill sm ${card.severity}`}>{card.pillLabel}</span>
        <span className="mx-card-age" title="Time active">
          {card.age}
        </span>
      </div>
      <p className="mx-card-ttl">{card.diagnosis}</p>
      <div className="mx-card-strip">
        {card.scribble && (
          <div className="mx-meters">
            <div className="mx-meter-cols">
              <span className="mx-fdr" aria-label={`Fader ${card.fader?.label ?? 'not read yet'}`}>
                {card.fader && <span className="mx-fdr-cap" style={{ bottom: `${card.fader.percent}%` }} />}
              </span>
              <span className={`mx-lv${card.level.available ? '' : ' mx-na'}`} aria-label={`Level ${card.level.label}`}>
                {card.level.available && <i style={{ height: `${card.level.percent}%` }} />}
              </span>
              <span className="mx-gr mx-na" aria-label={card.grLabel} />
            </div>
            <div className="mx-meter-labels">
              <span>FDR</span>
              <span>LV</span>
              <span>GR</span>
            </div>
            <div className="mx-fval">{card.fader?.label ?? '—'}</div>
            <div className="mx-meter-na">{card.grLabel}</div>
            {!card.level.available && <div className="mx-meter-na">{card.level.label}</div>}
          </div>
        )}
        <div className="mx-facts">
          {card.facts.map((f) => (
            <div className="mx-fact" key={f.label}>
              <span className="mx-fact-k">{f.label}</span>
              <span className={`mx-fact-v${f.tone ? ` mx-tone-${f.tone}` : ''}`}>{f.value}</span>
            </div>
          ))}
        </div>
      </div>
      {card.candidates.length > 0 && (
        <p className="mx-card-cands">{`Open channels (candidates, not confirmed): ${card.candidates.join(', ')}`}</p>
      )}
      {card.sends !== '' && <p className="mx-card-sends">{card.sends}</p>}
      <div className="mx-card-foot">
        {card.share !== '' && <span className="mx-unavailable">{card.share}</span>}
        <button
          type="button"
          className="btn btn-ghost mx-card-dismiss"
          disabled={frozen}
          /* c8 ignore next -- click dispatch, no jsdom */
          onClick={() => useMixerStore.getState().dismissCard(card.key, Date.now())}
        >
          Dismiss
        </button>
      </div>
    </article>
  );
}
