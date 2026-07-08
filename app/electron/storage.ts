// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Storage-folder helpers (#91). Sound Buddy has **no usage caps** — no recording
// count, length, or storage-size limit on any tier. These helpers only *report*
// how much disk a folder is using so Settings can show it informationally; the
// number is never compared against a limit or used to gate a feature.

import * as fs from 'fs';
import * as path from 'path';

/**
 * Total size in bytes of every file under `dir`, walked recursively. Returns 0
 * when the folder does not exist yet (nothing recorded) — a missing storage dir
 * is a normal cold-start state, not an error. Individual entries that can't be
 * stat'd (permissions, a race with a delete) are skipped rather than throwing,
 * so a single unreadable file never breaks the Settings display. Purely
 * informational: the result is shown to the user, never enforced as a quota.
 */
export function dirSizeBytes(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // Missing or unreadable folder — treat as empty.
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        total += dirSizeBytes(full);
      } else if (entry.isFile()) {
        total += fs.statSync(full).size;
      }
      // Symlinks and other special entries are ignored — we only count real
      // files that live inside the storage folder itself.
    } catch {
      // Entry vanished or is unreadable — skip it, keep summing the rest.
    }
  }
  return total;
}

/**
 * A short human-readable size like "0 B", "512 KB", "1.4 GB". Binary units
 * (1 KB = 1024 B) to match Finder's "Get Info" on macOS. Display-only.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exp;
  // Whole bytes read cleanly; larger units get one decimal unless it rounds up
  // to a whole number (avoid a stray "2.0 GB").
  const rounded = exp === 0 ? String(bytes) : (Math.round(value * 10) / 10).toString();
  return `${rounded} ${units[exp]}`;
}
