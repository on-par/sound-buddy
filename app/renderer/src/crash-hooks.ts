// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Renderer-side crash capture hooks (#473): pure/injected logic so it's
// testable without jsdom or real DOM event classes — duck-types on the
// shape of an ErrorEvent/PromiseRejectionEvent rather than using
// `instanceof`, since a plain object built in a test exercises the same code
// path as the real browser event.

export function serializeRendererError(e: unknown): { message: string; stack?: string } | null {
  if (typeof e !== 'object' || e === null) return null;
  const anyE = e as Record<string, unknown>;

  if ('reason' in anyE) {
    const reason = anyE.reason;
    if (reason instanceof Error) {
      const message = reason.message || String(reason);
      return message ? { message, stack: reason.stack } : null;
    }
    const message = String(reason);
    return message ? { message } : null;
  }

  if (anyE.error instanceof Error) {
    const eventMessage = typeof anyE.message === 'string' ? anyE.message : '';
    const message = anyE.error.message || eventMessage;
    return message ? { message, stack: anyE.error.stack } : null;
  }

  if (typeof anyE.message === 'string' && anyE.message) {
    return { message: anyE.message };
  }

  return null;
}

export function installCrashHooks(
  // `any` mirrors the DOM's own listener callback signature (ErrorEvent /
  // PromiseRejectionEvent) — serializeRendererError narrows it immediately.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  target: { addEventListener: (type: string, cb: (e: any) => void) => void },
  report: (input: { message: string; stack?: string }) => Promise<void> | void
): void {
  const handle = (e: unknown): void => {
    const serialized = serializeRendererError(e);
    if (serialized === null) return;
    // The crash hook must never throw — guard both a synchronous throw from
    // `report` and an async rejection.
    try {
      void Promise.resolve(report(serialized)).catch(() => {});
    } catch {
      /* swallow — reporting a crash must never itself crash the renderer */
    }
  };
  target.addEventListener('error', handle);
  target.addEventListener('unhandledrejection', handle);
}
