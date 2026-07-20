// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, Electron-free folder scan for batch analysis (#270): given a folder,
// finds the whole-mix recordings it contains. Non-recursive (per-channel stem
// trees are out of scope) and never throws for an empty folder. All fs access
// is injected via FolderReader so this is unit-testable without touching disk.

import * as path from 'path';

export const AUDIO_EXTENSIONS = ['.wav', '.aif', '.aiff', '.flac', '.mp3', '.m4a', '.mp4', '.mov', '.caf'];

export interface FolderReader {
  readdir(dir: string): string[];
  isFile(fullPath: string): boolean;
}

/** Whole-mix candidates in `dir`: files whose extension is in AUDIO_EXTENSIONS
 *  (case-insensitive), dotfiles excluded, sorted by name for a stable order.
 *  Non-recursive — subfolders are ignored (per-channel stem trees are out of scope). */
export function collectAudioFiles(dir: string, io: FolderReader): string[] {
  return io
    .readdir(dir)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => AUDIO_EXTENSIONS.includes(path.extname(name).toLowerCase()))
    .filter((name) => io.isFile(path.join(dir, name)))
    // Filenames within one directory are always unique, so a < b covers it —
    // no equal case to handle.
    .sort((a, b) => (a < b ? -1 : 1))
    .map((name) => path.join(dir, name));
}
