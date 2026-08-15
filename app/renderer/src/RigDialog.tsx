// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The shared rig/group name prompt (TD-001 slice 6i, #712) — React port of
// inline-app.js's rigDialog() modal, driven by rigDialogStore and portaled by
// App.tsx onto the static #rig-dialog-island index.html node. Keeps the exact
// ids/classes (#rig-dialog/-title/-msg/-input/-ok/-cancel) so the deleted
// static markup's consumers — RigControls.tsx, rigStore.ts's save() fallback,
// LiveCapturePanel.tsx's group prompts (all via the ambient window.rigDialog
// promise API, installed by this component's mount effect) — and
// named-channel-groups.spec.ts's locators are unchanged.

import { useEffect, useRef, useState, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useRigDialogStore } from './stores/rigDialogStore';

export default function RigDialog(): JSX.Element {
  const { isOpen, title, msg, value, confirmLabel, withInput } = useStoreShallow(useRigDialogStore, (s) => ({
    isOpen: s.isOpen,
    title: s.title,
    msg: s.msg,
    value: s.value,
    confirmLabel: s.confirmLabel,
    withInput: s.withInput,
  }));

  // The input's local draft — seeded from the store's value when the dialog
  // (re)opens (a render-phase update so renderToString reflects the seed), then
  // owned by the user's typing until OK/Cancel.
  const [draft, setDraft] = useState('');
  const seededValue = useRef<string | null>(null);
  if (isOpen && seededValue.current !== value) {
    seededValue.current = value;
    setDraft(value);
  }

  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  /* c8 ignore start -- mount effect + focus/keyboard/backdrop dispatch, no
     jsdom in this harness; covered by app/tests/e2e/named-channel-groups.spec.ts
     (group create/rename/delete + rig Save As/Rename/Delete prompts). */
  useEffect(() => {
    // Installs the promise bridge the still-React rig/group callers call —
    // window.rigDialog's ambient shape (rig-panel.ts) is unchanged.
    window.rigDialog = (opts) => useRigDialogStore.getState().open(opts);
    return () => { delete window.rigDialog; };
  }, []);

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && useRigDialogStore.getState().isOpen) {
      useRigDialogStore.getState().close(null);
    }
  }
  useEffect(() => {
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (withInput) { inputRef.current?.focus(); inputRef.current?.select(); }
    else okRef.current?.focus();
  }, [isOpen, withInput]);
  /* c8 ignore stop */

  /* c8 ignore next -- the OK/Cancel/backdrop/Escape dispatch below is the only
     caller; no jsdom in this harness, covered by
     app/tests/e2e/named-channel-groups.spec.ts. */
  const close = (result: string | boolean | null): void => useRigDialogStore.getState().close(result);

  return (
    <div
      id="rig-dialog"
      className="rig-dialog"
      style={{ display: isOpen ? 'flex' : 'none' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="rig-dialog-title"
      /* c8 ignore next -- backdrop click dispatch, no jsdom */
      onClick={(e) => { if (e.target === e.currentTarget) close(null); }}
    >
      <div className="rig-dialog-card">
        <div className="rig-dialog-title" id="rig-dialog-title">{title}</div>
        <div className="rig-dialog-msg" id="rig-dialog-msg" style={{ display: msg ? 'block' : 'none' }}>{msg}</div>
        <input
          ref={inputRef}
          type="text"
          id="rig-dialog-input"
          className="rig-dialog-input"
          placeholder="Rig name"
          autoComplete="off"
          spellCheck={false}
          style={{ display: withInput ? 'block' : 'none' }}
          value={draft}
          /* c8 ignore next -- input dispatch, no jsdom */
          onChange={(e) => setDraft(e.target.value)}
          /* c8 ignore next -- key dispatch, no jsdom */
          onKeyDown={(e) => { if (e.key === 'Enter') close(draft); }}
        />
        <div className="rig-dialog-actions">
          <button
            type="button"
            id="rig-dialog-cancel"
            className="btn btn-secondary sm"
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => close(null)}
          >
            Cancel
          </button>
          <button
            ref={okRef}
            type="button"
            id="rig-dialog-ok"
            className="btn btn-primary sm"
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => close(withInput ? draft : true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
