// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type { JSX } from 'react';
import { MixerScribble } from './MixerCard';
import { RTA_HEIGHT, RTA_WIDTH, type InspectorView } from './inspector';

export const INSPECTOR_EMPTY = 'Choose a card or a channel tile to inspect its signal chain.';

export function MixerInspector({ view }: { view: InspectorView | null }): JSX.Element {
  if (!view) {
    return (
      <section className="mx-insp mx-insp-empty" id="mixer-inspector" aria-label="Inspector">
        <p>{INSPECTOR_EMPTY}</p>
      </section>
    );
  }
  return (
    <section className="mx-insp" id="mixer-inspector" aria-label="Inspector">
      <div className="mx-spec">
        <div className="mx-spec-h">
          <MixerScribble scribble={view.scribble} small />
          <h3>Spectrum</h3>
        </div>
        {view.spectrum.kind === 'room' ? (
          <div className="mx-canvas" id="mixer-room-rta">
            <span className="mx-canvas-label">{view.spectrum.label}</span>
            <svg viewBox={`0 0 ${RTA_WIDTH} ${RTA_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
              <path d={view.spectrum.path} className="mx-rta-line" />
              {view.spectrum.marker && (
                <line x1={view.spectrum.marker.x} x2={view.spectrum.marker.x} y1={0} y2={RTA_HEIGHT} className="mx-rta-ring" />
              )}
            </svg>
            {view.spectrum.marker && <span className="mx-canvas-ring">{view.spectrum.marker.label}</span>}
          </div>
        ) : (
          <div className="mx-canvas mx-placard" id="mixer-spectrum-unavailable">
            {view.spectrum.label}
          </div>
        )}
        <div className="mx-placard mx-placard-sm" id="mixer-masking-unavailable">
          {view.masking}
        </div>
      </div>
      <div className="mx-chain">
        <div className="mx-chain-h">
          <span className="panel-title">Signal chain</span>
          {view.proposedCount > 0 && <span className="pill sm gold">{`${view.proposedCount} proposed`}</span>}
        </div>
        {view.chain.map((row) => (
          <div key={row.key} className={`mx-step mx-step-${row.state}`}>
            <span className="mx-step-nm">{row.name}</span>
            <span className="mx-step-vv" title={row.value}>
              {row.value}
            </span>
            <span className="mx-step-age">{row.age}</span>
          </div>
        ))}
        <div className="mx-placard mx-placard-sm" id="mixer-share-unavailable">
          {view.share}
        </div>
      </div>
    </section>
  );
}
