// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Storage-folder helpers (#91). Sound Buddy has **no usage caps** — no recording
// count, length, or storage-size limit on any tier. These helpers only *report*
// how much disk a folder is using so Settings can show it informationally; the
// number is never compared against a limit or used to gate a feature.

import { promises as fsp } from 'fs';
import type { Dirent } from 'fs';
import { randomUUID } from 'crypto';
import * as path from 'path';

export interface AnalysisSummary {
  /** ISO 8601 timestamp of when the analysis completed. */
  date: string;
  sourceFilename: string;
  gradeLetter: string;
  score: number;
  recordingType: string;
  topFixes: string[];
}

/**
 * Total size in bytes of every file under `dir`, walked recursively. Returns 0
 * when the folder does not exist yet (nothing recorded) — a missing storage dir
 * is a normal cold-start state, not an error. Individual entries that can't be
 * stat'd (permissions, a race with a delete) are skipped rather than throwing,
 * so a single unreadable file never breaks the Settings display. Purely
 * informational: the result is shown to the user, never enforced as a quota.
 *
 * Async on purpose: "unlimited recordings" means this folder can hold tens of GB
 * across thousands of files, and the README suggests pointing it inside an
 * iCloud/Dropbox/Drive folder where a stat can be slow. A synchronous walk would
 * block the Electron main thread and freeze the window; the async walk yields.
 */
export async function dirSizeBytes(dir: string): Promise<number> {
  let entries: Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    // Missing or unreadable folder — treat as empty.
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        total += await dirSizeBytes(full);
      } else if (entry.isFile()) {
        total += (await fsp.stat(full)).size;
      }
      // Symlinks and other special entries are ignored — we only count real
      // files that live inside the storage folder itself (isDirectory()/isFile()
      // are both false for a symlink under withFileTypes, so cycles are safe).
    } catch {
      // Entry vanished or is unreadable — skip it, keep summing the rest.
    }
  }
  return total;
}

/**
 * Write one discrete summary record under `historyDir`, creating the folder
 * (recursively) if missing — mirrors dirSizeBytes treating a missing storage dir
 * as a normal cold-start state, not an error. One file per analysis (never an
 * append-to-shared-array read-modify-write) so concurrent/rapid analyses can
 * never clobber each other and each record is individually addressable (#147).
 * Filename derives from the record's own ISO date (colons/dots swapped for '-'
 * so it is filesystem-safe) plus a short random suffix to stay unique within the
 * same millisecond. Returns the absolute path written.
 */
export async function saveAnalysisSummary(
  historyDir: string,
  summary: AnalysisSummary,
): Promise<string> {
  await fsp.mkdir(historyDir, { recursive: true });
  const stamp = summary.date.replace(/[:.]/g, '-');
  const file = path.join(historyDir, `${stamp}-${randomUUID().slice(0, 8)}.json`);
  await fsp.writeFile(file, JSON.stringify(summary, null, 2));
  return file;
}

/**
 * A short human-readable size like "0 B", "512 KB", "1.4 GB". Binary units
 * (1 KB = 1024 B) to match Finder's "Get Info" on macOS. Display-only.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  let value = Math.round((bytes / 1024 ** exp) * 10) / 10;
  // Rounding can push a value at the top of a range up to 1024 (e.g. 1 MB − 1 B
  // rounds to "1024 KB"); promote it to the next unit so it reads "1 MB".
  if (value >= 1024 && exp < units.length - 1) {
    exp += 1;
    value = Math.round((bytes / 1024 ** exp) * 10) / 10;
  }
  // Whole bytes read cleanly; larger units carry one decimal (dropped when it's
  // a whole number, so "2 GB" not "2.0 GB").
  const rounded = exp === 0 ? String(bytes) : value.toString();
  return `${rounded} ${units[exp]}`;
}
