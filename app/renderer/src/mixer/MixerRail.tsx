// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type { JSX } from 'react';
import { useMixerStore } from '../stores/mixerStore';
import { MixerScribble } from './MixerCard';
import { LOCKED_WRITES_COPY } from './proposed-moves';
import type { RailMove, RailView } from './view-model';

export const RAIL_TITLE = 'Mixer Assistant';
export const RAIL_BADGE = 'Suggest & Approve';
export const RAIL_PROMISE = 'Suggestions come from rules running on this Mac. Nothing changes on the console from here.';
export const RAIL_NO_MOVES = 'No proposed moves right now.';
export const RAIL_NO_MOVES_APPLIED = 'No moves applied';
export const RAIL_COMPOSER = 'Rules only in this build';

function MoveCard({ move, frozen }: { move: RailMove; frozen: boolean }): JSX.Element {
  return (
    <div className={`mx-move${move.changedOnDesk ? ' mx-move-done' : ''}`} data-move-key={move.key}>
      <div className="mx-move-h">
        <MixerScribble scribble={move.scribble} small />
        <span className="pill sm check">{move.label}</span>
        <span className="mx-move-num">{move.position}</span>
      </div>
      <div className="mx-move-param">{move.param}</div>
      <p className="mx-move-why">
        <b>Why:</b> {move.why}
      </p>
      <p className="mx-move-why">
        <b>Expected:</b> {move.expected}
      </p>
      {move.changedOnDesk ? (
        <div className="mx-move-acts">
          <span className="pill sm good">Changed on desk</span>
          <button
            type="button"
            className="btn btn-ghost mx-move-dismiss"
            disabled={frozen}
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => useMixerStore.getState().dismissMove(move.key)}
          >
            Dismiss
          </button>
        </div>
      ) : (
        <div className="mx-move-acts">
          <button type="button" className="btn btn-primary mx-apply" disabled title={LOCKED_WRITES_COPY}>
            Apply to Board
          </button>
          <button
            type="button"
            className="btn btn-secondary mx-move-dismiss"
            disabled={frozen}
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => useMixerStore.getState().dismissMove(move.key)}
          >
            Dismiss
          </button>
          <span className="mx-locked">{LOCKED_WRITES_COPY}</span>
        </div>
      )}
    </div>
  );
}

export function MixerRail({ rail }: { rail: RailView }): JSX.Element {
  return (
    <aside className="mx-rail" id="mixer-rail" aria-label={RAIL_TITLE}>
      <div className="mx-rail-h">
        <div className="mx-rail-r1">
          <h2>{RAIL_TITLE}</h2>
          <span className="pill sm gold mx-sa">{RAIL_BADGE}</span>
        </div>
        <p className="mx-rail-r2">{RAIL_PROMISE}</p>
      </div>
      <div className="mx-rail-ctx" id="mixer-rail-context">
        {rail.context}
      </div>
      {rail.sermonLine && (
        <div className="mx-rail-sermon" id="mixer-rail-sermon">
          {rail.sermonLine}
        </div>
      )}
      <div className="mx-rail-body">
        {rail.advice.map((a) => (
          <div key={a.key} className={`mx-advice mx-sev-${a.severity}`}>
            {a.text}
          </div>
        ))}
        {rail.moves.length === 0 ? (
          <p className="mx-rail-empty">{RAIL_NO_MOVES}</p>
        ) : (
          rail.moves.map((m) => <MoveCard key={m.key} move={m} frozen={rail.frozen} />)
        )}
      </div>
      <div className="mx-movelog" id="mixer-move-log">
        <span>{RAIL_NO_MOVES_APPLIED}</span>
        <button type="button" className="btn btn-secondary mx-undo" disabled title={LOCKED_WRITES_COPY}>
          Undo
        </button>
      </div>
      <div className="mx-composer">
        <input type="text" className="mx-composer-input" disabled placeholder={RAIL_COMPOSER} aria-label={RAIL_COMPOSER} />
      </div>
    </aside>
  );
}
