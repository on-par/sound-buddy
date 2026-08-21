// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The app-update surface (TD-001 slice 6e, #703) — portaled by App.tsx onto
// #update-surface-island, replacing inline-app.js's initUpdates() IIFE with a
// mounted component. window.updateDownloadState stays a classic script — this
// owns the IPC listener registration and renders update availability as a
// modal, while manual check feedback uses a small snackbar.

import { useEffect, useRef, useState, type JSX } from 'react';
import { useElectron } from './useElectron';
import type { UpdateInfo, UpdateStatus, UpdateDownloadStatus } from '../../electron/ipc/api';

type UpdateAction = 'download' | 'install' | 'retry';

interface UpdateDownloadStateView {
  text: string;
  primary: { label: string; action: UpdateAction } | null;
  showProgress: boolean;
  percent: number;
  indeterminate: boolean;
}
interface UpdateDownloadStateApi {
  viewFor(status: UpdateDownloadStatus | null, info: UpdateInfo): UpdateDownloadStateView;
}
// update-download-state.js stays a classic script — read via a typed
// window cast, matching ReportCardIsland.tsx's getGrading()-style pattern.
function getUpdateDownloadState(): UpdateDownloadStateApi {
  return (window as unknown as { updateDownloadState: UpdateDownloadStateApi }).updateDownloadState;
}

const MARKDOWN_RUN = /(\*\*|`)/g;
const HTML_COMMENT_LINE = /^<!--[\s\S]*?-->$/;

function releaseNoteLines(notes: string): string[] {
  return notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !HTML_COMMENT_LINE.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, '').replace(/^[-*]\s+/, '').replace(MARKDOWN_RUN, '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

export default function UpdateBanner(): JSX.Element {
  const api = useElectron();
  const [dialogVisible, setDialogVisible] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastText, setToastText] = useState('');
  const [text, setText] = useState('');
  const [primary, setPrimary] = useState<{ label: string; action: UpdateAction } | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const [percent, setPercent] = useState(0);
  const [indeterminate, setIndeterminate] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const infoRef = useRef<UpdateInfo | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  /* c8 ignore start -- IPC listener registration + setTimeout auto-hide, no
     jsdom in this harness; exercised by tests/e2e/report-card-basics.spec.ts
     (the update surface is dormant unless a real update event fires). */
  useEffect(() => {
    function applyView(view: UpdateDownloadStateView): void {
      setText(view.text);
      setPrimary(view.primary);
      setShowProgress(view.showProgress);
      setPercent(view.percent);
      setIndeterminate(view.indeterminate);
    }

    function showToast(message: string, ms = 4500): void {
      setToastText(message);
      setToastVisible(true);
      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => {
        setToastVisible(false);
        toastTimerRef.current = null;
      }, ms);
    }

    api.onUpdateAvailable((info: UpdateInfo) => {
      infoRef.current = info;
      setNotes(releaseNoteLines(info.notes));
      applyView(getUpdateDownloadState().viewFor(null, info));
      setDialogVisible(true);
    });
    api.onUpdateStatus((s: UpdateStatus) => {
      // Feedback for the manual "Check for Updates…" menu item.
      if (s.state === 'up-to-date') {
        showToast(`You're up to date (v${s.version}).`, 4000);
      } else if (s.state === 'error') {
        showToast('Could not check for updates. Try again later.', 5000);
      }
    });
    api.onUpdateDownloadStatus((s: UpdateDownloadStatus) => {
      if (!infoRef.current) return;
      applyView(getUpdateDownloadState().viewFor(s.state === 'cancelled' ? null : s, infoRef.current));
      setDialogVisible(true);
    });

    return () => {
      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    };
  }, [api]);
  /* c8 ignore stop */

  return (
    <>
      <div id="update-toast" role="status" className={toastVisible ? 'show' : ''}>
        {toastText}
      </div>
      <div
        id="update-dialog"
        className="rig-dialog"
        style={{ display: dialogVisible ? 'flex' : 'none' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
      >
        <div className="rig-dialog-card update-dialog-card">
          <div className="rig-dialog-title" id="update-dialog-title">
            Sound Buddy {infoRef.current?.version ?? ''} is available
          </div>
          <p className="rig-dialog-msg" id="update-dialog-summary">{text}</p>
          <div className="update-notes" id="update-dialog-notes">
            <div className="update-notes-title">Changelog</div>
            {notes.length > 0 ? (
              <ul>
                {notes.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
              </ul>
            ) : (
              <p>No changelog was provided for this update.</p>
            )}
          </div>
          <progress
            id="update-progress"
            max={100}
            value={indeterminate ? undefined : percent}
            hidden={!showProgress}
          />
          <div className="rig-dialog-actions">
            <button
              type="button"
              id="update-cancel-btn"
              className="btn btn-secondary sm"
              hidden={showProgress}
              /* c8 ignore next -- click dispatch, no jsdom */
              onClick={() => setDialogVisible(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              id="update-download-btn"
              className="btn btn-primary sm"
              hidden={primary == null}
              /* c8 ignore next -- click dispatch, no jsdom */
              onClick={() => {
                if (primary?.action === 'install') void api.installUpdate();
                else void api.downloadUpdate();
              }}
            >
              {primary?.label ?? ''}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
