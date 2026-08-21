// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Debounced church-name persistence (#1020, epic #1000): a burst of typing
// in the Settings dialog's church-name field should settle into exactly one
// settingsStore.updateSettings round-trip carrying the final value, not one
// write per keystroke. This harness renders SettingsPanel.tsx with
// react-dom/server (no jsdom), so effects and timers never run under test —
// every side effect here (schedule/cancel/commit) is injected, following the
// createLiveMeterController pattern in live-meter-controller.ts, so the state
// machine is drivable with a fake scheduler instead of real timers.

/** Quiet period after the last keystroke before the typed name is persisted. */
export const CHURCH_NAME_DEBOUNCE_MS = 400;

export interface ChurchNameCommitterDeps<H = number> {
  /** setTimeout-shaped scheduler; returns an opaque handle passed back to cancel(). */
  schedule(cb: () => void, ms: number): H;
  /** clearTimeout-shaped canceller. */
  cancel(handle: H): void;
  /** Persists one settled value — SettingsPanel injects commitShareChurchName. */
  commit(value: string): void;
  /** Overridable debounce window; defaults to CHURCH_NAME_DEBOUNCE_MS. */
  delayMs?: number;
}

export interface ChurchNameCommitter {
  /** Records a typed value and (re)arms the debounce window. */
  change(value: string): void;
  /** Commits a pending value right now; a no-op when nothing is pending. */
  flush(): void;
  /** Drops any pending value without committing it. */
  cancel(): void;
}

export function createChurchNameCommitter<H = number>(
  deps: ChurchNameCommitterDeps<H>
): ChurchNameCommitter {
  let handle: H | null = null;
  // Tracked separately from `handle` and typed string | null (not '' as
  // empty) because '' is a legitimate value — clearing the field must
  // persist an empty string.
  let pending: string | null = null;
  const delay = deps.delayMs ?? CHURCH_NAME_DEBOUNCE_MS;

  function clearPending() {
    if (handle !== null) {
      deps.cancel(handle);
      handle = null;
    }
  }

  return {
    change(value: string) {
      clearPending();
      pending = value;
      handle = deps.schedule(() => {
        handle = null;
        const v = pending;
        pending = null;
        if (v !== null) deps.commit(v);
      }, delay);
    },
    flush() {
      clearPending();
      if (pending === null) return;
      const v = pending;
      pending = null;
      deps.commit(v);
    },
    cancel() {
      clearPending();
      pending = null;
    },
  };
}
