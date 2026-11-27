// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MixerInspector, INSPECTOR_EMPTY } from './MixerInspector';
import { CHANNEL_SPECTRUM_UNAVAILABLE, MASKING_UNAVAILABLE, SHARE_OF_MAIN_UNAVAILABLE, ROOM_RTA_LABEL, type InspectorView } from './inspector';

const VIEW: InspectorView = {
  channel: 1,
  scribble: { number: '01', name: 'Lead Vox', colorClass: 'mx-c-yellow', inverted: false, icon: 1 },
  chain: [
    { key: 'trim', name: 'Trim', value: '0.0 dB', age: 'read 3 s ago', state: 'ok' },
    { key: 'proposed:x', name: 'Comp', value: 'Comp ratio 5.0:1 → 4.0:1', age: 'proposed', state: 'proposed' },
  ],
  proposedCount: 1,
  spectrum: { kind: 'unavailable', label: CHANNEL_SPECTRUM_UNAVAILABLE },
  masking: MASKING_UNAVAILABLE,
  share: SHARE_OF_MAIN_UNAVAILABLE,
};

function render(view: InspectorView | null): string {
  return renderToString(createElement(MixerInspector, { view }));
}

describe('MixerInspector', () => {
  it('renders every no-source panel as an unavailable placard and draws no curve', () => {
    const html = render(VIEW);
    expect(html).toContain(CHANNEL_SPECTRUM_UNAVAILABLE);
    expect(html).toContain(MASKING_UNAVAILABLE);
    expect(html).toContain(SHARE_OF_MAIN_UNAVAILABLE);
    expect(html).not.toContain('<path');
    expect(html).not.toContain('<svg');
  });

  it('renders the signal chain with ages and a dashed proposed row and count', () => {
    const html = render(VIEW);
    expect(html).toContain('class="mx-step mx-step-ok"');
    expect(html).toContain('read 3 s ago');
    expect(html).toContain('class="mx-step mx-step-proposed"');
    expect(html).toContain('1 proposed');
  });

  it('omits the proposed count when there is no real move', () => {
    expect(render({ ...VIEW, proposedCount: 0, chain: [VIEW.chain[0]] })).not.toContain('proposed');
  });

  it('draws the room RTA, labelled as the room, with a ring marker when one is detected', () => {
    const html = render({ ...VIEW, spectrum: { kind: 'room', label: ROOM_RTA_LABEL, path: 'M0 10 L600 20', marker: { x: 300, label: 'Ring near 2.5 kHz' } } });
    expect(html).toContain(ROOM_RTA_LABEL);
    expect(html).toContain('d="M0 10 L600 20"');
    expect(html).toContain('class="mx-rta-ring"');
    expect(html).toContain('Ring near 2.5 kHz');
    expect(html).not.toContain(CHANNEL_SPECTRUM_UNAVAILABLE);
  });

  it('draws the room RTA without a marker when no ring is detected', () => {
    const html = render({ ...VIEW, spectrum: { kind: 'room', label: ROOM_RTA_LABEL, path: 'M0 10 L600 20', marker: null } });
    expect(html).not.toContain('mx-rta-ring');
  });

  it('asks the operator to pick a channel when nothing is inspected', () => {
    expect(render(null)).toContain(INSPECTOR_EMPTY);
  });
});
