// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  trackChannelBadgeText,
  trackChannelPickerView,
  trackChannelPickerHTML,
  type TrackChannelPickerView,
} from './track-channel-picker';
import type { StripConfig } from './live-capture-panel';

const MONO: StripConfig = { kind: 'mono', a: 2, b: 3, armed: true };
const STEREO: StripConfig = { kind: 'stereo', a: 4, b: 5, armed: true };

describe('trackChannelBadgeText', () => {
  it('renders a 1-based single number for a mono strip', () => {
    expect(trackChannelBadgeText(MONO)).toBe('3');
  });

  it('renders "a/b" 1-based for a stereo strip', () => {
    expect(trackChannelBadgeText(STEREO)).toBe('5/6');
  });
});

describe('trackChannelPickerView', () => {
  it('is closed when the open index does not match this row', () => {
    const view = trackChannelPickerView(0, MONO, 8, 1, false);
    expect(view).toMatchObject({ index: 0, open: false, locked: false, badgeText: '3', kind: 'mono', a: 2, b: 3, deviceChannels: 8 });
  });

  it('is open when the open index matches this row', () => {
    const view = trackChannelPickerView(1, STEREO, 8, 1, false);
    expect(view.open).toBe(true);
    expect(view.kind).toBe('stereo');
  });

  it('carries the locked flag through unchanged', () => {
    expect(trackChannelPickerView(0, MONO, 8, null, true).locked).toBe(true);
  });
});

describe('trackChannelPickerHTML', () => {
  const closedView: TrackChannelPickerView = {
    index: 0, open: false, locked: false, badgeText: '3', kind: 'mono', a: 2, b: 3, deviceChannels: 8,
  };

  it('renders only the badge button when closed', () => {
    const html = trackChannelPickerHTML(closedView);
    expect(html).toBe('<button type="button" class="daw-track-head-channel-badge" aria-haspopup="true" aria-expanded="false" aria-label="Change channel routing — currently 3" title="Change channel routing">3</button>');
    expect(html).not.toContain('<select');
  });

  it('marks the badge disabled and aria-expanded=true when locked and open', () => {
    const html = trackChannelPickerHTML({ ...closedView, open: true, locked: true });
    expect(html).toContain('aria-expanded="true"');
    expect(html.match(/daw-track-head-channel-badge[^>]*disabled/)).not.toBeNull();
  });

  it('opens a Mono/Stereo select plus one Source select for a mono strip', () => {
    const html = trackChannelPickerHTML({ ...closedView, open: true });
    expect(html).toContain('class="daw-track-channel-picker"');
    expect(html).toContain('class="daw-track-channel-picker-kind"');
    expect(html).toContain('<option value="mono" selected>Mono</option>');
    expect(html).toContain('<option value="stereo">Stereo</option>');
    const sourceSelects = html.match(/class="daw-track-channel-picker-source"/g) ?? [];
    expect(sourceSelects).toHaveLength(1);
    expect(html).toContain('data-field="a"');
    expect(html).not.toContain('data-field="b"');
  });

  it('opens two Source selects for a stereo strip, each excluding the other leg', () => {
    const html = trackChannelPickerHTML({ ...closedView, open: true, kind: 'stereo', a: 4, b: 5 });
    expect(html).toContain('<option value="stereo" selected>Stereo</option>');
    const sourceSelects = html.match(/class="daw-track-channel-picker-source"/g) ?? [];
    expect(sourceSelects).toHaveLength(2);
    // Source A (value 4, selected) must never offer option value="5" (Source B's
    // current channel) — a === b would otherwise become selectable (#1404).
    const aSelect = html.slice(html.indexOf('data-field="a"'), html.indexOf('data-field="b"'));
    expect(aSelect).toContain('<option value="4" selected>Ch 5</option>');
    expect(aSelect).not.toContain('value="5"');
    const bSelect = html.slice(html.indexOf('data-field="b"'));
    expect(bSelect).toContain('<option value="5" selected>Ch 6</option>');
    expect(bSelect).not.toContain('value="4"');
  });

  it('disables the popover selects when locked', () => {
    const html = trackChannelPickerHTML({ ...closedView, open: true, locked: true });
    expect(html.match(/daw-track-channel-picker-kind"[^>]*disabled/)).not.toBeNull();
    expect(html.match(/daw-track-channel-picker-source"[^>]*disabled/)).not.toBeNull();
  });
});
