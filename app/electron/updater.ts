// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { shell } from 'electron';

// Update discovery + download/install now go through electron-updater
// (./auto-updater.ts, #625). This module keeps only the menu's "Check for
// Updates…" fallback link and the shared UpdateInfo shape.
export type { UpdateInfo } from './auto-updater';

const RELEASES_PAGE = 'https://github.com/on-par/sound-buddy-releases/releases/latest';

export function openReleasePage(url?: string): void {
  void shell.openExternal(url || RELEASES_PAGE);
}
