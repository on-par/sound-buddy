// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import RecordSourceSettings from './RecordSourceSettings';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useRecordTakeStore } from './stores/recordTakeStore';

const INITIAL_LIVE_CAPTURE_STATE = useLiveCaptureStore.getInitialState();
const INITIAL_RECORD_TAKE_STATE = useRecordTakeStore.getInitialState();

afterEach(() => {
  useLiveCaptureStore.setState({
    devices: INITIAL_LIVE_CAPTURE_STATE.devices,
    selectedDevice: INITIAL_LIVE_CAPTURE_STATE.selectedDevice,
    secondaryMeasurement: INITIAL_LIVE_CAPTURE_STATE.secondaryMeasurement,
  });
  useRecordTakeStore.setState(INITIAL_RECORD_TAKE_STATE);
});

function renderMarkup(): string {
  return renderToString(createElement(RecordSourceSettings));
}

describe('RecordSourceSettings (#1648)', () => {
  it('renders one channel picker per source — Main and Measurement only', () => {
    useLiveCaptureStore.setState({
      devices: [
        { index: 3, name: 'X32 USB', channels: 4, default_sr: 48000 },
        { index: 5, name: 'UMIK-1', channels: 1, default_sr: 48000 },
      ],
      selectedDevice: '3',
      secondaryMeasurement: { status: 'active', deviceName: 'UMIK-1' },
    });
    useRecordTakeStore.setState({ mainChannels: '2-3' });

    const html = renderMarkup();

    expect(html.match(/<select/g)).toHaveLength(2);
    expect(html).toMatch(/Main input[\s\S]*X32 USB/);
    expect(html).toMatch(/Measurement input[\s\S]*UMIK-1/);
    expect(html).toMatch(/id="record-main-channels"[\s\S]*<option value="2-3" selected="">Ch 3–4 \(stereo\)<\/option>/);
    expect(html).toMatch(/id="record-measurement-channels"[^>]*>[\s\S]*<option value="0" selected="">Ch 1 \(mono\)<\/option><\/select>/);
    expect(html).not.toMatch(/disabled=""/);
  });

  it('locks both pickers while a take is recording', () => {
    useRecordTakeStore.setState({ phase: 'recording' });
    const html = renderMarkup();
    expect(html).toMatch(/id="record-main-channels"[^>]*disabled=""/);
    expect(html).toMatch(/id="record-measurement-channels"[^>]*disabled=""/);
  });
});
