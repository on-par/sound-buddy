// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The app-update banner (TD-001 slice 6e, #703) — portaled by App.tsx onto
// #update-banner-island, replacing inline-app.js's initUpdates() IIFE with a
// mounted component. window.updateDownloadState stays a classic script
// (unchanged) — this only relocates the IPC listener registration + DOM
// glue into a component.

import { useEffect, useRef, useState, type JSX } from 'react';
import { useElectron } from './useElectron';
import { iconSvg } from './report-card';
import type { UpdateInfo, UpdateStatus, UpdateDownloadStatus } from '../../electron/ipc/api';

interface UpdateDownloadStateView {
  text: string;
  primary: { label: string; action: 'download' | 'install' } | null;
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

export default function UpdateBanner(): JSX.Element {
  const api = useElectron();
  const [visible, setVisible] = useState(false);
  const [text, setText] = useState('');
  const [primary, setPrimary] = useState<{ label: string; action: 'download' | 'install' } | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const [percent, setPercent] = useState(0);
  const [indeterminate, setIndeterminate] = useState(false);
  const infoRef = useRef<UpdateInfo | null>(null);

  /* c8 ignore start -- IPC listener registration + setTimeout auto-hide, no
     jsdom in this harness; exercised by tests/e2e/report-card-basics.spec.ts
     (the banner is dormant unless a real update event fires). */
  useEffect(() => {
    function applyView(view: UpdateDownloadStateView): void {
      setText(view.text);
      setPrimary(view.primary);
      setShowProgress(view.showProgress);
      setPercent(view.percent);
      setIndeterminate(view.indeterminate);
    }

    api.onUpdateAvailable((info: UpdateInfo) => {
      infoRef.current = info;
      applyView(getUpdateDownloadState().viewFor(null, info));
      setVisible(true);
    });
    api.onUpdateStatus((s: UpdateStatus) => {
      // Feedback for the manual "Check for Updates…" menu item.
      if (s.state === 'up-to-date') {
        setText(`You're up to date (v${s.version}).`);
        setPrimary(null);
        setShowProgress(false);
        setVisible(true);
        setTimeout(() => setVisible(false), 4000);
      } else if (s.state === 'error') {
        setText('Could not check for updates. Try again later.');
        setPrimary(null);
        setShowProgress(false);
        setVisible(true);
        setTimeout(() => setVisible(false), 5000);
      }
    });
    api.onUpdateDownloadStatus((s: UpdateDownloadStatus) => {
      if (!infoRef.current) return;
      applyView(getUpdateDownloadState().viewFor(s.state === 'cancelled' ? null : s, infoRef.current));
    });
  }, [api]);
  /* c8 ignore stop */

  return (
    <div id="update-banner" role="status" className={visible ? 'show' : ''}>
      <span className="ub-icon" dangerouslySetInnerHTML={{ __html: iconSvg('arrow-up-circle', 16) }} />
      <span id="update-banner-text">{text}</span>
      <progress
        id="update-progress"
        max={100}
        value={indeterminate ? undefined : percent}
        hidden={!showProgress}
      />
      <button
        type="button"
        id="update-download-btn"
        className="ub-btn"
        hidden={primary == null}
        /* c8 ignore next -- click dispatch, no jsdom */
        onClick={() => { if (primary?.action === 'install') void api.installUpdate(); else void api.downloadUpdate(); }}
      >
        {primary?.label ?? ''}
      </button>
      <button
        type="button"
        id="update-dismiss-btn"
        className="ub-x"
        aria-label="Dismiss"
        /* c8 ignore next -- click dispatch, no jsdom */
        onClick={() => setVisible(false)}
      >
        ✕
      </button>
    </div>
  );
}
