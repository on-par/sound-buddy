// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import LiveStatusLine from './LiveStatusLine';
import { useLiveCaptureStore } from './stores/liveCaptureStore';

// LiveStatusLine (TD-001 slice 6i, #712) — the shared #live-status line,
// single-owned: the capture-lifecycle module writes capture status and
// rigStore writes rig-apply notices, both to liveCaptureStore.liveStatusText,
// and this island renders it reactively.
describe('LiveStatusLine (TD-001 slice 6i, #712)', () => {
  afterEach(() => {
    useLiveCaptureStore.setState({ liveStatusText: null });
  });

  it('hides the status line when the text is null', () => {
    useLiveCaptureStore.setState({ liveStatusText: null });
    const html = renderToString(createElement(LiveStatusLine));
    expect(html).toMatch(/id="live-status"[^>]*style="display:none/);
  });

  it('renders the status text when set', () => {
    useLiveCaptureStore.setState({ liveStatusText: 'Monitoring · meters 10/s' });
    const html = renderToString(createElement(LiveStatusLine));
    expect(html).toContain('id="live-status"');
    expect(html).toContain('>Monitoring · meters 10/s</div>');
    expect(html).not.toContain('display:none');
  });
});
