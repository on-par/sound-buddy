// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { TIMELINE_MIN_BPM, TIMELINE_MAX_BPM, createTimelineTempo } from './timeline-bpm';
import {
  TIMELINE_BPM_INPUT_ID,
  TIMELINE_BPM_HINT_ID,
  TIMELINE_BPM_REJECTED_MESSAGE,
  timelineBpmClampedMessage,
  timelineBpmControlView,
  commitTimelineBpmEntry,
  timelineBpmControlHTML,
} from './timeline-bpm-control';

describe('timelineBpmControlView', () => {
  it('defaults to an empty message and invalid: false', () => {
    const tempo = createTimelineTempo();
    const view = timelineBpmControlView(tempo);
    expect(view.message).toBe('');
    expect(view.invalid).toBe(false);
  });

  it('marks a non-empty message as invalid', () => {
    const view = timelineBpmControlView(createTimelineTempo(), 'oops');
    expect(view.message).toBe('oops');
    expect(view.invalid).toBe(true);
  });

  it('returns the supplied tempo by reference', () => {
    const tempo = createTimelineTempo();
    expect(timelineBpmControlView(tempo).tempo).toBe(tempo);
  });
});

describe('commitTimelineBpmEntry accepted', () => {
  it('accepts a plain in-range integer', () => {
    const entry = commitTimelineBpmEntry('96', createTimelineTempo());
    expect(entry.status).toBe('accepted');
    expect(entry.tempo.bpm).toBe(96);
    expect(entry.message).toBe('');
  });

  it('trims surrounding whitespace and accepts a fractional value', () => {
    const entry = commitTimelineBpmEntry(' 128.5 ', createTimelineTempo());
    expect(entry.status).toBe('accepted');
    expect(entry.tempo.bpm).toBe(128.5);
  });

  it('accepts the min bound as-is, not clamped', () => {
    const entry = commitTimelineBpmEntry(String(TIMELINE_MIN_BPM), createTimelineTempo());
    expect(entry.status).toBe('accepted');
    expect(entry.tempo.bpm).toBe(TIMELINE_MIN_BPM);
  });

  it('accepts the max bound as-is, not clamped', () => {
    const entry = commitTimelineBpmEntry(String(TIMELINE_MAX_BPM), createTimelineTempo());
    expect(entry.status).toBe('accepted');
    expect(entry.tempo.bpm).toBe(TIMELINE_MAX_BPM);
  });

  it('returns the identical tempo reference for a no-op commit (withTimelineBpm identity path)', () => {
    const tempo = createTimelineTempo();
    const entry = commitTimelineBpmEntry(String(tempo.bpm), tempo);
    expect(entry.status).toBe('accepted');
    expect(entry.tempo).toBe(tempo);
  });
});

describe('commitTimelineBpmEntry clamped', () => {
  it('clamps an above-range request to TIMELINE_MAX_BPM and names both bounds plus the stored value', () => {
    const entry = commitTimelineBpmEntry('900', createTimelineTempo());
    expect(entry.status).toBe('clamped');
    expect(entry.tempo.bpm).toBe(TIMELINE_MAX_BPM);
    expect(entry.message).toContain(String(TIMELINE_MIN_BPM));
    expect(entry.message).toContain(String(TIMELINE_MAX_BPM));
    expect(entry.message).toContain(String(TIMELINE_MAX_BPM));
  });

  it('clamps a below-range positive request to TIMELINE_MIN_BPM', () => {
    const entry = commitTimelineBpmEntry('5', createTimelineTempo());
    expect(entry.status).toBe('clamped');
    expect(entry.tempo.bpm).toBe(TIMELINE_MIN_BPM);
  });

  it('clamps a negative request to TIMELINE_MIN_BPM', () => {
    const entry = commitTimelineBpmEntry('-40', createTimelineTempo());
    expect(entry.status).toBe('clamped');
    expect(entry.tempo.bpm).toBe(TIMELINE_MIN_BPM);
  });

  it('clamps a zero request to TIMELINE_MIN_BPM', () => {
    const entry = commitTimelineBpmEntry('0', createTimelineTempo());
    expect(entry.status).toBe('clamped');
    expect(entry.tempo.bpm).toBe(TIMELINE_MIN_BPM);
  });
});

describe('commitTimelineBpmEntry rejected', () => {
  it.each(['abc', '12,5', '', '   '])('rejects %j without storing an invalid value', (raw) => {
    const tempo = createTimelineTempo();
    const entry = commitTimelineBpmEntry(raw, tempo);
    expect(entry.status).toBe('rejected');
    expect(entry.tempo).toBe(tempo);
    expect(entry.message).toBe(TIMELINE_BPM_REJECTED_MESSAGE);
  });
});

describe('timelineBpmControlHTML', () => {
  it('renders the default tempo as a valid text input', () => {
    const html = timelineBpmControlHTML(timelineBpmControlView(createTimelineTempo()));
    expect(html).toContain(`id="${TIMELINE_BPM_INPUT_ID}"`);
    expect(html).toContain('value="120"');
    expect(html).toContain('type="text"');
    expect(html).not.toContain('type="number"');
    expect(html).toContain('aria-invalid="false"');
    expect(html).toContain(`aria-describedby="${TIMELINE_BPM_HINT_ID}"`);
    expect(html).toContain(`<span class="daw-transport-bpm-hint" id="${TIMELINE_BPM_HINT_ID}" role="status"></span>`);
    expect(html).not.toContain('daw-transport-bpm invalid');
  });

  it('renders the invalid state with the message and invalid class', () => {
    const view = timelineBpmControlView(createTimelineTempo(), TIMELINE_BPM_REJECTED_MESSAGE);
    const html = timelineBpmControlHTML(view);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('class="daw-transport-bpm invalid"');
    expect(html).toContain(TIMELINE_BPM_REJECTED_MESSAGE);
  });
});

describe('timelineBpmClampedMessage', () => {
  it('names both bounds and the value the tempo was set to', () => {
    const message = timelineBpmClampedMessage(TIMELINE_MAX_BPM);
    expect(message).toContain(String(TIMELINE_MIN_BPM));
    expect(message).toContain(String(TIMELINE_MAX_BPM));
  });
});

describe('the BPM control stays display-only (ADR-0104)', () => {
  it('does not import the timeline scale, shell geometry, or React', () => {
    const source = fs.readFileSync(new URL('./timeline-bpm-control.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from '\.\/(timeline-scale|daw-shell-runtime)'/);
    expect(source).not.toMatch(/from 'react'/);
  });
});
