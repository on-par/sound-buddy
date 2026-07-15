// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// First production React island of the strangler migration (#395 slice 3,
// #421): replaces inline-app.js's imperative #license-dialog wiring. Markup
// is ported byte-for-byte from index.html (same ids/classes/roles/the
// style.display visibility mechanism) so every existing Playwright locator
// and CSS rule keeps working unchanged; `data-react-island="license"` is the
// e2e proof that React now owns this DOM node. View/connected split mirrors
// ReportCard.tsx: the View is a pure function of props (renderToString-
// testable across every dialog/license state — there is no jsdom in this
// repo), and the default export just wires it to licensingStore.

import { useEffect, useRef, useState } from 'react';
import { useLicensingStore, licenseStatusLine } from './stores/licensingStore';
import { useStoreShallow } from './stores/useStoreShallow';

export interface LicensePanelViewProps {
  open: boolean;
  statusLine: string;
  error: string | null;
  showRemove: boolean;
  showRefresh: boolean;
  onActivate(key: string): void;
  onRemove(): void;
  onRefresh(): void;
  onClose(): void;
}

export function LicensePanelView({
  open,
  statusLine,
  error,
  showRemove,
  showRefresh,
  onActivate,
  onRemove,
  onRefresh,
  onClose,
}: LicensePanelViewProps) {
  const [key, setKey] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-seed the key field and focus it every time the dialog opens — matches
  // openLicenseDialog()'s `input.value = ''; input.focus();`.
  useEffect(() => {
    if (open) {
      setKey('');
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  function handleActivate() {
    const trimmed = key.trim();
    if (!trimmed) {
      inputRef.current?.focus();
      return;
    }
    onActivate(trimmed);
  }

  return (
    <div
      id="license-dialog"
      className="rig-dialog"
      style={{ display: open ? 'flex' : 'none' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="license-dialog-title"
      data-react-island="license"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="rig-dialog-card">
        <div className="rig-dialog-title" id="license-dialog-title">
          License
        </div>
        <div className="lic-status" id="license-dialog-status">
          {statusLine}
        </div>
        <input
          ref={inputRef}
          type="text"
          id="license-key-input"
          className="rig-dialog-input"
          placeholder="Paste your license key (SB1.…)"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleActivate();
          }}
        />
        <div
          className="lic-status err"
          id="license-dialog-error"
          style={{ display: error ? 'block' : 'none' }}
          role="alert"
        >
          {error || ''}
        </div>
        <div className="rig-dialog-actions">
          <button
            type="button"
            id="license-refresh-btn"
            className="btn btn-secondary sm"
            style={{ display: showRefresh ? 'inline-flex' : 'none' }}
            onClick={onRefresh}
          >
            Refresh license
          </button>
          <button
            type="button"
            id="license-remove-btn"
            className="btn btn-secondary sm"
            style={{ display: showRemove ? 'inline-flex' : 'none' }}
            onClick={onRemove}
          >
            Remove key
          </button>
          <button type="button" id="license-close-btn" className="btn btn-secondary sm" onClick={onClose}>
            Close
          </button>
          <button type="button" id="license-activate-btn" className="btn btn-primary sm" onClick={handleActivate}>
            Activate
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LicensePanel() {
  const { licenseStatus, trialDaysLeft, dialogOpen, dialogError, activateLicense, removeLicense, refreshLicense, closeDialog } =
    useStoreShallow(useLicensingStore, (s) => ({
      licenseStatus: s.licenseStatus,
      trialDaysLeft: s.trialDaysLeft,
      dialogOpen: s.dialogOpen,
      dialogError: s.dialogError,
      activateLicense: s.activateLicense,
      removeLicense: s.removeLicense,
      refreshLicense: s.refreshLicense,
      closeDialog: s.closeDialog,
    }));

  return (
    <LicensePanelView
      open={dialogOpen}
      statusLine={licenseStatusLine(licenseStatus, trialDaysLeft)}
      error={dialogError}
      showRemove={licenseStatus?.tier === 'pro'}
      showRefresh={licenseStatus?.tier === 'pro' && licenseStatus?.kind === 'subscription'}
      onActivate={(key) => void activateLicense(key)}
      onRemove={() => void removeLicense()}
      onRefresh={() => void refreshLicense()}
      onClose={closeDialog}
    />
  );
}
