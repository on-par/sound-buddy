// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type { RecordedSessionSummary } from '../../electron/ipc/api';
import type { SessionManifest } from './soundcheck-panel';
import { escapeHtml } from './spectrum-display';

export const OPEN_SESSION_FOLDER_VALUE = '__sound-buddy-open-session-folder__';
const NO_SESSION_VALUE = '';

export interface SessionTabSessionPickerOption extends RecordedSessionSummary {
  selected: boolean;
}

export interface SessionTabSessionPickerView {
  value: string;
  options: SessionTabSessionPickerOption[];
  statusMessage: string | null;
}

function folderName(sessionDir: string): string {
  const parts = sessionDir.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || sessionDir;
}

export function sessionTabSessionPickerView(
  sessions: RecordedSessionSummary[],
  sessionDir: string | null,
  manifest: SessionManifest | null,
  statusMessage: string | null,
): SessionTabSessionPickerView {
  const current = sessionDir && !sessions.some((session) => session.sessionDir === sessionDir)
    ? [{ sessionDir, name: manifest?.name || folderName(sessionDir), createdAt: manifest?.createdAt }]
    : [];
  return {
    value: sessionDir ?? NO_SESSION_VALUE,
    options: [...current, ...sessions].map((session) => ({
      ...session,
      // A loaded manifest is authoritative for the active recording; discovery
      // data may have been collected before the recording was renamed.
      name: session.sessionDir === sessionDir ? manifest?.name || folderName(session.sessionDir) : session.name,
      selected: session.sessionDir === sessionDir,
    })),
    statusMessage,
  };
}

export function sessionTabSessionPickerAction(value: string): { type: 'select'; sessionDir: string } | { type: 'open-folder' } | { type: 'none' } {
  if (value === OPEN_SESSION_FOLDER_VALUE) return { type: 'open-folder' };
  if (value === NO_SESSION_VALUE) return { type: 'none' };
  return { type: 'select', sessionDir: value };
}

export function sessionTabSessionPickerHTML(view: SessionTabSessionPickerView): string {
  const options = view.options.map((option) =>
    `<option value="${escapeHtml(option.sessionDir)}"${option.selected ? ' selected' : ''}>${escapeHtml(option.name)}</option>`).join('');
  const status = view.statusMessage
    ? `<span class="daw-session-picker-status" role="status">${escapeHtml(view.statusMessage)}</span>`
    : '';
  return `<label class="daw-session-picker"><span class="sr-only">Recorded session</span><select class="daw-session-picker-select">`
    + `<option value=""${view.value === NO_SESSION_VALUE ? ' selected' : ''}>Select a recorded session</option>`
    + options
    + `<option value="${OPEN_SESSION_FOLDER_VALUE}">open session folder…</option>`
    + `</select>${status}</label>`;
}
