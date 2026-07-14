// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free helpers for the pre-service Preflight checklist (#373):
// snapshot the current channel routing, diff it against a saved baseline, and
// turn the result into a green/amber/red checklist an engineer can scan before
// the band walks in. Kept as a classic script — no DOM, no IPC — so the drift
// rules are unit-testable, mirroring rig-reconcile.js and arm-state.js. Read
// off window.preflight in the renderer, module.exports under Node.
(function (root) {
  'use strict';

  /** A strip's routing token: stereo distinct legs "a-b", else mono "a" (mirrors arm-state's stripToken). */
  function tokenOf(s) {
    return s && s.kind === 'stereo' && s.a !== s.b ? s.a + '-' + s.b : '' + (s ? s.a : 0);
  }

  /** Display label for a strip: its own label, else "Ch N" (1-based). */
  function stripLabel(s, i) {
    return s && s.label ? s.label : 'Ch ' + (i + 1);
  }

  /**
   * Normalize a baseline/current snapshot the way `snapshotRig` shapes raw
   * config, so `detectDrift` can be handed either a fresh snapshot or a saved
   * one straight off disk without special-casing missing data.
   */
  function normalizeSnapshot(snapshot) {
    if (snapshot && Array.isArray(snapshot.strips)) {
      return { deviceName: String(snapshot.deviceName || ''), strips: snapshot.strips };
    }
    return { deviceName: '', strips: [] };
  }

  /**
   * Normalize the live channel config + selected device name into a baseline
   * shape: a fresh array of strips (kind coerced, missing legs zeroed, label
   * defaulted to ''), deliberately dropping `armed` — arming is a capture
   * choice, not routing, so it's never drift.
   */
  function snapshotRig(channelConfig, deviceName) {
    var strips = Array.isArray(channelConfig) ? channelConfig : [];
    return {
      deviceName: String(deviceName || ''),
      strips: strips.map(function (s) {
        return {
          kind: s && s.kind === 'stereo' ? 'stereo' : 'mono',
          a: s && Number.isFinite(s.a) ? s.a : 0,
          b: s && Number.isFinite(s.b) ? s.b : 0,
          label: s && typeof s.label === 'string' ? s.label : '',
        };
      }),
    };
  }

  /**
   * Diff a baseline snapshot against the current one. Produces device drift
   * first, then per-strip drift in index order (added/removed/kind/channel/
   * label), mirroring diffScenes's SceneChange push style.
   */
  function detectDrift(baseline, current) {
    var b0 = normalizeSnapshot(baseline);
    var c0 = normalizeSnapshot(current);
    var changes = [];

    if (b0.deviceName !== c0.deviceName) {
      changes.push({
        type: 'device',
        index: -1,
        label: 'Input device',
        from: b0.deviceName || 'Default Device',
        to: c0.deviceName || 'Default Device',
      });
    }

    var max = Math.max(b0.strips.length, c0.strips.length);
    for (var i = 0; i < max; i++) {
      var b = b0.strips[i];
      var c = c0.strips[i];
      if (!c) {
        changes.push({ type: 'removed', index: i, label: stripLabel(b, i), from: tokenOf(b), to: null });
        continue;
      }
      if (!b) {
        changes.push({ type: 'added', index: i, label: stripLabel(c, i), from: null, to: tokenOf(c) });
        continue;
      }
      if (b.kind !== c.kind) {
        changes.push({ type: 'kind', index: i, label: stripLabel(c, i), from: b.kind, to: c.kind });
      } else if (tokenOf(b) !== tokenOf(c)) {
        changes.push({ type: 'channel', index: i, label: stripLabel(c, i), from: tokenOf(b), to: tokenOf(c) });
      }
      if (b.label !== c.label) {
        changes.push({ type: 'label', index: i, label: stripLabel(c, i), from: b.label, to: c.label });
      }
    }
    return changes;
  }

  /** A short human summary of the first few non-label drift items. */
  function summarizeDrift(drift) {
    var hard = drift.filter(function (d) { return d.type !== 'label'; });
    var shown = hard.slice(0, 3).map(function (d) {
      if (d.type === 'device') return 'Input device changed';
      if (d.type === 'added') return d.label + ' added';
      if (d.type === 'removed') return d.label + ' removed';
      if (d.type === 'kind') return d.label + ' changed from ' + d.from + ' to ' + d.to;
      return d.label + ' reassigned ' + d.from + ' → ' + d.to; // 'channel'
    });
    var more = hard.length - shown.length;
    return shown.join('; ') + (more > 0 ? '; +' + more + ' more' : '');
  }

  /**
   * Turn a baseline/current/device triple into the checklist rows the
   * Preflight panel renders. Warnings (label-only drift, no saved baseline)
   * never block "ready" — only a hard mismatch, a missing device, or an
   * out-of-range channel does.
   */
  function buildChecklist(opts) {
    var input = opts || {};
    var current = input.current && Array.isArray(input.current.strips)
      ? input.current
      : { deviceName: '', strips: [] };
    var device = input.device || { found: false, name: '', channels: 0 };
    var baseline = input.baseline || null;
    var items = [];

    var deviceLabel = device.name || 'Default Device';
    items.push({
      id: 'device-connected',
      label: 'Input device',
      status: device.found ? 'ok' : 'fail',
      detail: device.found
        ? deviceLabel + ' is connected'
        : deviceLabel + ' is not connected — plug it in or pick another input',
    });

    var maxChannels = Number.isFinite(device.channels) && device.channels >= 1 ? device.channels : null;
    var outOfRange = [];
    if (maxChannels != null) {
      current.strips.forEach(function (s, i) {
        var legs = s.kind === 'stereo' ? [s.a, s.b] : [s.a];
        if (legs.some(function (ch) { return ch >= maxChannels; })) outOfRange.push(i);
      });
    }
    items.push({
      id: 'channels-in-range',
      label: 'Channel routing',
      status: outOfRange.length > 0 ? 'fail' : 'ok',
      detail: outOfRange.length > 0
        ? outOfRange.map(function (i) {
          var s = current.strips[i];
          var badChannel = s.kind === 'stereo' && s.b >= maxChannels ? s.b : s.a;
          return 'Strip ' + (i + 1) + ' uses channel ' + (badChannel + 1) + ' but the device only has ' + maxChannels;
        }).join('; ')
        : 'All ' + current.strips.length + ' strips map to a valid input channel',
    });

    var noBaseline = !baseline || !Array.isArray(baseline.strips) || baseline.strips.length === 0;
    var matches = { id: 'matches-baseline', label: 'Matches saved baseline', status: 'ok', detail: '' };
    if (noBaseline) {
      matches.status = 'warn';
      matches.detail = 'No saved baseline yet — save one to catch drift before the next service';
    } else {
      var drift = detectDrift(baseline, current);
      if (drift.length === 0) {
        matches.detail = 'Setup matches your saved baseline';
      } else if (drift.every(function (d) { return d.type === 'label'; })) {
        matches.status = 'warn';
        matches.detail = 'Only channel labels changed';
      } else {
        matches.status = 'fail';
        matches.detail = summarizeDrift(drift) + ' — update routing or re-save the baseline';
      }
    }
    items.push(matches);

    return items;
  }

  /** Tally checklist statuses. Warnings don't block readiness — only a fail does. */
  function checklistSummary(items) {
    var list = Array.isArray(items) ? items : [];
    var counts = { ok: 0, warn: 0, fail: 0 };
    list.forEach(function (item) {
      if (Object.prototype.hasOwnProperty.call(counts, item.status)) counts[item.status]++;
    });
    return { counts: counts, ready: counts.fail === 0 };
  }

  var api = {
    snapshotRig: snapshotRig,
    detectDrift: detectDrift,
    buildChecklist: buildChecklist,
    checklistSummary: checklistSummary,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.preflight = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
