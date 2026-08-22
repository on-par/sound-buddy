// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it } from 'vitest';
import type { RecordedSessionSummary } from '../../electron/ipc/api';
import type { SessionManifest } from './soundcheck-panel';
import {
  OPEN_SESSION_FOLDER_VALUE,
  sessionTabSessionPickerAction,
  sessionTabSessionPickerHTML,
  sessionTabSessionPickerView,
} from './session-tab-session-picker';

const SESSIONS: RecordedSessionSummary[] = [
  { sessionDir: '/recordings/sunday', name: 'Sunday AM', createdAt: '2026-08-17T10:00:00.000Z' },
  { sessionDir: '/recordings/rehearsal', name: 'Rehearsal', createdAt: '2026-08-16T10:00:00.000Z' },
];

const MANIFEST: SessionManifest = {
  name: 'Sunday AM',
  createdAt: '2026-08-17T10:00:00.000Z',
  sampleRate: 48000,
  tracks: [{ kind: 'mono', frames: 48000 }],
};

describe('sessionTabSessionPickerView', () => {
  it('renders a placeholder and explicit folder option with no selection', () => {
    const view = sessionTabSessionPickerView(SESSIONS, null, null, null);
    const html = sessionTabSessionPickerHTML(view);

    expect(view.value).toBe('');
    expect(html).toContain('Select a recorded session');
    expect(html).toContain('open session folder…');
  });

  it('uses the manifest name for the selected known recording in the toolbar', () => {
    const view = sessionTabSessionPickerView(SESSIONS, '/recordings/sunday', { ...MANIFEST, name: 'Sunday service' }, null);
    const html = sessionTabSessionPickerHTML(view);

    expect(view.value).toBe('/recordings/sunday');
    expect(view.options[0]).toMatchObject({ sessionDir: '/recordings/sunday', name: 'Sunday service', selected: true });
    expect(html).toContain('value="/recordings/sunday" selected');
    expect(html).toContain('Sunday service');
  });

  it('keeps an external current selection using the manifest name', () => {
    const external: SessionManifest = { ...MANIFEST, name: 'Offsite recording' };
    const view = sessionTabSessionPickerView(SESSIONS, '/external/take-1', external, null);

    expect(view.value).toBe('/external/take-1');
    expect(view.options).toContainEqual(expect.objectContaining({ sessionDir: '/external/take-1', name: 'Offsite recording', selected: true }));
  });

  it('falls back to the session folder name when manifest metadata is absent', () => {
    const view = sessionTabSessionPickerView([], '/external/take-1', { tracks: [] }, null);

    expect(view.options).toEqual([expect.objectContaining({ name: 'take-1', selected: true })]);
  });

  it('escapes display values and exposes validation text accessibly', () => {
    const view = sessionTabSessionPickerView(
      [{ sessionDir: '/recordings/<unsafe>', name: 'Mix <&>', createdAt: undefined }],
      '/external/current',
      { name: 'Current', tracks: [] },
      'Could not read <session>.',
    );
    const html = sessionTabSessionPickerHTML(view);

    expect(html).toContain('Mix &lt;&amp;&gt;');
    expect(html).toContain('role="status"');
    expect(html).toContain('Could not read &lt;session&gt;.');
  });
});

describe('sessionTabSessionPickerAction', () => {
  it('maps known directories to selection actions', () => {
    expect(sessionTabSessionPickerAction('/recordings/sunday')).toEqual({ type: 'select', sessionDir: '/recordings/sunday' });
  });

  it('maps the folder sentinel and placeholder without conflating them with selections', () => {
    expect(sessionTabSessionPickerAction(OPEN_SESSION_FOLDER_VALUE)).toEqual({ type: 'open-folder' });
    expect(sessionTabSessionPickerAction('')).toEqual({ type: 'none' });
  });
});
