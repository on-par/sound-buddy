// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free helpers for per-strip record arming (#43). A strip is
// "armed" unless its `armed` flag is explicitly false (default-armed), so config
// built before this story still records every strip. Kept as a classic script so
// the token/arm rules are unit-testable without a DOM, mirroring rig-reconcile.js.
// Read off window.armState in the renderer, module.exports under Node.
(function (root) {
  'use strict';

  /** A strip's stream.py channel token: stereo pair "a-b" (distinct legs) else mono "a". */
  function stripToken(s) {
    return s && s.kind === 'stereo' && s.a !== s.b ? s.a + '-' + s.b : '' + (s ? s.a : 0);
  }

  /** True unless the strip is explicitly disarmed (armed === false). */
  function isArmed(s) {
    return !!s && s.armed !== false;
  }

  /** Tokens for every configured strip — the capture channel set. */
  function allTokens(cfg) {
    return (cfg || []).map(stripToken);
  }

  /** Tokens for armed strips only — what Record mode captures as session stems. */
  function armedTokens(cfg) {
    return (cfg || []).filter(isArmed).map(stripToken);
  }

  /** How many strips are currently armed. */
  function armedCount(cfg) {
    return (cfg || []).filter(isArmed).length;
  }

  /** A new config with every strip's armed flag set to `armed` (input untouched). */
  function setAllArmed(cfg, armed) {
    return (cfg || []).map(function (s) {
      return Object.assign({}, s, { armed: armed });
    });
  }

  var api = {
    stripToken: stripToken, isArmed: isArmed, allTokens: allTokens,
    armedTokens: armedTokens, armedCount: armedCount, setAllArmed: setAllArmed,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.armState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
