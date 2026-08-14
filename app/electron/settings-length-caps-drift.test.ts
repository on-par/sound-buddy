// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

// Same mocking discipline as settings.test.ts: settings.ts imports Electron's
// `app` and './logger' at module load, and this test only needs the exported
// length-cap constants — the mocks make the import safe outside Electron.
const userDataDir = '';
vi.mock('electron', () => ({
  app: { getPath: () => userDataDir },
  BrowserWindow: class {},
}));

vi.mock('./logger', () => ({ logWarn: vi.fn() }));

import { MAX_CHANNEL_LABEL_LEN, MAX_PROFILE_ID_LEN, MAX_SHARE_CHURCH_NAME_LEN } from './settings';

describe('main ↔ renderer length-cap drift guard (#747)', () => {
  // settings.ts owns the main-process caps (MAX_CHANNEL_LABEL_LEN /
  // MAX_PROFILE_ID_LEN / MAX_SHARE_CHURCH_NAME_LEN). The renderer keeps its
  // own copies (MAX_LABEL_LEN / MAX_PROFILE_ID_LEN / MAX_CHURCH_NAME_LEN)
  // because the packaged main process cannot import renderer code at runtime.
  // This is a value-based guard (house precedent: timeout.test.ts, profile-
  // drift.test.ts): it fails the instant a renderer copy diverges.
  const caps = [
    { main: MAX_CHANNEL_LABEL_LEN, source: '../renderer/src/stores/liveCaptureStore.ts', name: 'MAX_LABEL_LEN' },
    { main: MAX_PROFILE_ID_LEN, source: '../renderer/instrument-profiles.js', name: 'MAX_PROFILE_ID_LEN' },
    { main: MAX_SHARE_CHURCH_NAME_LEN, source: '../renderer/src/share-card.ts', name: 'MAX_CHURCH_NAME_LEN' },
  ] as const;

  it.each(caps)('$name ($source) equals settings.ts $main', ({ main, source, name }) => {
    const src = fs.readFileSync(fileURLToPath(new URL(source, import.meta.url)), 'utf8');
    const match = src.match(new RegExp(name + '\\s*=\\s*(\\d+)'));
    expect(match, `${source} does not declare ${name}`).not.toBeNull();
    expect(Number(match![1])).toBe(main);
  });
});
