// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free helper for the mono↔stereo kind switch used by the
// workspace track header (#189). Kept in a standalone classic script so the
// logic is unit-testable (Vitest) yet shared verbatim with the renderer,
// which loads it via <script src> and reads it off window.rigKind.
//
// Nothing here touches the DOM — inputs in, a fresh strip out.

(function (root) {
  'use strict';

  /**
   * Switch a channel-config strip's kind (mono/stereo), resolving the source
   * channel(s) per the acceptance rules:
   *  - to 'stereo': keep `a`; default `b` to the next free channel when it's
   *    unset or collapsed onto `a`, clamped to the last device channel.
   *  - to 'mono': keep `a` (clamped); `b` is left as-is — a mono strip
   *    ignores it, so nothing is lost if the engineer switches back.
   * Always returns a fresh strip object (input is never mutated); `label`
   * and `armed` ride through unchanged.
   *
   * @param {{kind:string,a:number,b:number,label?:string,armed?:boolean}} strip
   * @param {string} kind          'mono' | 'stereo'
   * @param {number} maxChannels   Channels the current device exposes.
   * @returns {{kind:string,a:number,b:number,label?:string,armed?:boolean}}
   */
  function switchKind(strip, kind, maxChannels) {
    const hi = Math.max(1, Math.floor(maxChannels) || 1) - 1; // last valid index
    const a0 = strip && Number.isFinite(strip.a) ? strip.a : 0;
    const a = Math.min(Math.max(0, a0), hi);
    let b = strip && Number.isFinite(strip.b) ? strip.b : a;
    if (kind === 'stereo') {
      if (b == null || b === a) b = Math.min(a + 1, hi);
      b = Math.min(Math.max(0, b), hi);
    }
    const out = { kind: kind, a: a, b: b };
    if (strip && strip.label != null) out.label = strip.label;
    if (strip && strip.armed != null) out.armed = strip.armed;
    return out;
  }

  const api = { switchKind: switchKind };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.rigKind = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
