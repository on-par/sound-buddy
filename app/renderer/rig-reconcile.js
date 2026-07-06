// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free helpers for the capture-rig strip config: reconciling a
// saved rig (#36) against the hardware currently attached, and resolving a
// strip's display label (#39). Kept in a standalone classic script so the logic
// is unit-testable (Vitest) yet shared verbatim with the renderer, which loads
// it via <script src> and reads it off window.rigReconcile.
//
// Nothing here touches the DOM or IPC — inputs in, plain values out — so the
// renderer never has to duplicate the fiddly "device moved / device gone /
// channel out of range / label → device name → Ch N" rules the acceptance
// criteria hinge on.

(function (root) {
  'use strict';

  /**
   * Match a rig's saved device name against the currently enumerated devices.
   * Devices are matched BY NAME (not index) so the selection survives the OS
   * reordering inputs between sessions.
   *
   * @param {string} deviceName  Rig's saved device name ('' = Default Device).
   * @param {Array<{index:number,name:string,channels:number}>} devices
   * @returns {{found:boolean, index:string, deviceName:string}}
   *   `index` is the string value for the device <select> ('' = Default Device).
   *   `found` is false only when a *named* device is no longer present.
   */
  function reconcileRigDevice(deviceName, devices) {
    const list = Array.isArray(devices) ? devices : [];
    // An empty name means the rig used the Default Device — always resolvable.
    if (!deviceName) return { found: true, index: '', deviceName: '' };
    const match = list.find((d) => d && d.name === deviceName);
    if (match) return { found: true, index: String(match.index), deviceName: deviceName };
    return { found: false, index: '', deviceName: deviceName };
  }

  /**
   * Clamp a rig's channel config to the channel count the current device
   * exposes. Any leg beyond the last valid channel is pulled back to the highest
   * valid index; a stereo strip whose legs then collapse to the same channel is
   * left as-is (the renderer already degrades an a===b stereo pair to a mono
   * token). Never throws and always returns a fresh array so the caller can
   * assign it straight to channelConfig.
   *
   * @param {Array<{kind:string,a:number,b:number,label?:string}>} channelConfig
   * @param {number} maxChannels  Channels the current device exposes.
   * @returns {{config:Array<{kind:string,a:number,b:number,label?:string}>, adjusted:boolean}}
   *   `adjusted` is true when any in-use leg had to be clamped, so the caller can
   *   surface a non-fatal notice.
   */
  function clampChannelConfig(channelConfig, maxChannels) {
    const strips = Array.isArray(channelConfig) ? channelConfig : [];
    const hi = Math.max(1, Math.floor(maxChannels) || 1) - 1; // last valid index
    let adjusted = false;
    const config = strips.map((s) => {
      const stereo = !!(s && s.kind === 'stereo');
      const a0 = s && Number.isFinite(s.a) ? s.a : 0;
      const b0 = s && Number.isFinite(s.b) ? s.b : 0;
      const a = Math.min(Math.max(0, a0), hi);
      const b = Math.min(Math.max(0, b0), hi);
      // Only an in-use leg that actually moved counts as an adjustment: a mono
      // strip's ignored `b` clamping must not raise a spurious notice.
      if (a !== a0 || (stereo && b !== b0)) adjusted = true;
      const out = { kind: stereo ? 'stereo' : 'mono', a: a, b: b };
      if (s && s.label != null) out.label = s.label;
      return out;
    });
    return { config: config, adjusted: adjusted };
  }

  /**
   * Resolve the display name for a channel strip (#39): a user-entered `label`
   * wins, else the backend device channel name, else a generic "Ch N". Whitespace
   * is trimmed and a whitespace-only label counts as empty, so clearing a label
   * (or typing spaces) falls through to the device name / index. Pure and
   * DOM-free so it drives both the live meter header and the config rows from one
   * rule, and unit tests can pin every branch.
   *
   * @param {?{label?:string}} strip   The channelConfig strip (may be null).
   * @param {?{name?:string}} ch        The backend live channel (may be null).
   * @param {number} index             0-based strip index; drives "Ch N" = N+1.
   * @returns {string}
   */
  function resolveStripLabel(strip, ch, index) {
    const label = strip && typeof strip.label === 'string' ? strip.label.trim() : '';
    if (label) return label;
    const name = ch && typeof ch.name === 'string' ? ch.name.trim() : '';
    if (name) return name;
    const n = Number.isFinite(index) ? index : 0;
    return 'Ch ' + (n + 1);
  }

  const api = {
    reconcileRigDevice: reconcileRigDevice,
    clampChannelConfig: clampChannelConfig,
    resolveStripLabel: resolveStripLabel,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.rigReconcile = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
