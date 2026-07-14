// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure logic for the Rough Pass / Contextual Pass workflow toggle (#365):
// two coaching phases for the existing Build Guide tab (#367) — rough (build
// gain structure per channel, solo/near-solo) then contextual (full-band
// listening pass, retune in context). Phase state is a plain string
// persisted via an injected Storage (sessionStorage in the renderer — this
// is transient per-session workflow state, deliberately distinct from the
// Build Guide's cross-session localStorage progress). Nothing here touches
// the DOM or IPC. Loaded via <script src> and read off window.passModeState.
(function (root) {
  'use strict';

  var STORAGE_KEY = 'sb-pass-mode-v1';
  var DEFAULT_PHASE = 'rough';

  var PHASES = [
    {
      id: 'rough',
      label: 'Rough Pass',
      tagline: 'Build gain structure per channel — solo or near-solo.',
      reminders: [
        'Set input trim first — aim for ~ -18 dBFS average with peaks well short of clip.',
        'Get gain structure right before you touch EQ or dynamics.',
        'Work one channel at a time, soloed or near-soloed.',
        'Rough in level, HPF, and obvious tone — don\'t chase perfection yet.',
      ],
    },
    {
      id: 'contextual',
      label: 'Contextual Pass',
      tagline: 'Full-band listening pass — retune every channel in context.',
      reminders: [
        'Solo-perfect ≠ mix-perfect — retune each channel in the context of the full mix.',
        'Unmute everything and balance channels against each other, not in isolation.',
        'Carve overlapping instruments (kick vs bass, vocal vs guitars) so each has space.',
        'Trust the full-band picture over the soloed sound.',
      ],
    },
  ];

  var VALID_IDS = PHASES.map(function (p) { return p.id; });

  function phaseIds() {
    return VALID_IDS.slice();
  }

  function isValidPhase(id) {
    return VALID_IDS.indexOf(id) !== -1;
  }

  function getPhase(id) {
    var phase = null;
    PHASES.forEach(function (p) { if (p.id === id) phase = p; });
    if (phase) return phase;
    return getPhase(DEFAULT_PHASE);
  }

  // Never throws: missing/malformed/throwing storage all fall back to
  // DEFAULT_PHASE, mirroring onboarding-state's resilience.
  function loadPhase(storage) {
    try {
      if (!storage || typeof storage.getItem !== 'function') return DEFAULT_PHASE;
      var raw = storage.getItem(STORAGE_KEY);
      return isValidPhase(raw) ? raw : DEFAULT_PHASE;
    } catch {
      return DEFAULT_PHASE;
    }
  }

  // Best-effort persist; swallows errors (private-mode / disabled storage).
  // An invalid id is never persisted, so a corrupt id can't get stuck in
  // storage.
  function savePhase(storage, id) {
    try {
      if (storage && typeof storage.setItem === 'function' && isValidPhase(id)) {
        storage.setItem(STORAGE_KEY, id);
      }
    } catch {
      /* private-mode / disabled storage — nothing we can persist, so no-op */
    }
  }

  // Segmented two-button toggle. escapeHtml is injected — the renderer
  // passes its existing shared escapeHtml so there is one escape
  // implementation, not a duplicate (mirrors build-order-state.stepRowHtml).
  function toggleHtml(activeId, escapeHtml) {
    var active = isValidPhase(activeId) ? activeId : DEFAULT_PHASE;
    return PHASES.map(function (p) {
      var isActive = p.id === active;
      return '<button type="button" class="pass-seg' + (isActive ? ' active' : '') +
        '" data-phase="' + escapeHtml(p.id) + '">' + escapeHtml(p.label) + '</button>';
    }).join('');
  }

  // Reminder banner for a phase object: tagline followed by a <ul> of <li>
  // reminders.
  function reminderHtml(phase, escapeHtml) {
    var p = phase || getPhase(DEFAULT_PHASE);
    var items = (p.reminders || []).map(function (r) {
      return '<li>' + escapeHtml(r) + '</li>';
    }).join('');
    return '<p class="pass-tagline">' + escapeHtml(p.tagline) + '</p>' +
      '<ul class="pass-reminder-list">' + items + '</ul>';
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_PHASE: DEFAULT_PHASE,
    PHASES: PHASES,
    phaseIds: phaseIds,
    isValidPhase: isValidPhase,
    getPhase: getPhase,
    loadPhase: loadPhase,
    savePhase: savePhase,
    toggleHtml: toggleHtml,
    reminderHtml: reminderHtml,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.passModeState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
