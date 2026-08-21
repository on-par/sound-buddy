// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The #mode-tabs bar (TD-001 slice 6e, #703) — portaled by App.tsx onto
// #mode-tabs, replacing inline-app.js's static button markup + its
// .mode-tab click listener with a component driven by
// liveCaptureStore.appMode. Renders the same top-level workspace buttons
// to define (same ids/data-mode/icons), then resolves + applies each click
// through mode-switch.ts's resolveModeSwitch/switchMode.

import { useState, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useAnalyzeSourceStore } from './stores/analyzeSourceStore';
import { resolveModeSwitch, switchMode } from './mode-switch';
import { iconSvg } from './report-card';

interface TabDef {
  mode: string;
  id?: string;
  icon: string;
  label: string;
  lock?: boolean;
}

// Verbatim port of root-markup.html:83-96's 9 buttons.
const TABS: TabDef[] = [
  { mode: 'analyze', id: 'nav-analyze', icon: 'activity', label: 'Analyze' },
  { mode: 'history', id: 'nav-history', icon: 'clock', label: 'History' },
  { mode: 'dir', icon: 'folder', label: 'Directory' },
  { mode: 'live', icon: 'radio', label: 'Live', lock: true },
  { mode: 'console', icon: 'sliders', label: 'Console' },
  { mode: 'soundcheck', icon: 'sliders', label: 'Soundcheck', lock: true },
  { mode: 'recent', icon: 'clock', label: 'Recent' },
  { mode: 'guide', icon: 'clipboard-check', label: 'Build Guide' },
  { mode: 'ringout', icon: 'waves', label: 'Ring Out' },
  { mode: 'reportcard', icon: 'clipboard-check', label: 'Report Card' },
];

function tabHtml(tab: TabDef): string {
  return iconSvg(tab.icon, 16) + tab.label + (tab.lock ? `<span class="tab-lock">${iconSvg('lock', 11)}</span>` : '');
}

export default function ModeTabs(): JSX.Element {
  const appMode = useStoreShallow(useLiveCaptureStore, (s) => s.appMode);
  // Final nav consolidation quirk (#547, epic e17): History is a flag-only
  // entry that delegates to Recent's real switch but visually marks itself
  // active anyway (inline-app.js's old tab.classList.add('active') after the
  // delegated .click()) — local state since liveCaptureStore.appMode never
  // becomes 'history' itself. Cleared by any real (non-history) switch.
  const [historyActive, setHistoryActive] = useState(false);

  /* c8 ignore start -- click dispatch; needs a real DOM click event to
     exercise (no jsdom in this harness). Covered by
     tests/e2e/report-first-ux.spec.ts and tests/e2e/momentum.spec.ts, which
     both drive the .mode-tab click idiom. resolveModeSwitch/switchMode
     themselves are exhaustively unit-tested in mode-switch.test.ts. */
  function handleClick(mode: string): void {
    const decision = resolveModeSwitch(mode, useLiveCaptureStore.getState().appMode);
    if (decision.type === 'noop') return;
    // TD-001 slice 6h (#711): the picker is analyzeSourceStore-owned now —
    // open() replaces the deleted window.analyzeSourcePicker bridge.
    if (decision.type === 'openPicker') { useAnalyzeSourceStore.getState().open(); return; }
    if (decision.type === 'redirect') {
      handleClick(decision.mode);
      setHistoryActive(true);
      return;
    }
    setHistoryActive(false);
    switchMode(decision.mode);
  }
  /* c8 ignore stop */

  return (
    <>
      {TABS.map((tab) => (
        <button
          key={tab.mode}
          type="button"
          className={`mode-tab${tab.mode === appMode || (tab.mode === 'history' && historyActive) ? ' active' : ''}`}
          id={tab.id}
          data-mode={tab.mode}
          /* c8 ignore next -- click dispatch, see handleClick's ignore note above */
          onClick={() => handleClick(tab.mode)}
          dangerouslySetInnerHTML={{ __html: tabHtml(tab) }}
        />
      ))}
    </>
  );
}
