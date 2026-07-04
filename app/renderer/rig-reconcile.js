// Pure, framework-free reconciliation helpers for loading a saved capture rig
// (#36) against the hardware currently attached. Kept in a standalone classic
// script so the logic is unit-testable (Vitest) yet shared verbatim with the
// renderer, which loads it via <script src> and reads it off window.rigReconcile.
//
// Nothing here touches the DOM or IPC — inputs in, plain objects out — so the
// renderer never has to duplicate the fiddly "device moved / device gone /
// channel out of range" rules that the acceptance criteria hinge on.

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

  const api = { reconcileRigDevice: reconcileRigDevice, clampChannelConfig: clampChannelConfig };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.rigReconcile = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
