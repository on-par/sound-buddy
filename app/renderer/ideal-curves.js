// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure helpers for user-authored ideal EQ curves. Custom curves use the same
// 48-point, relative dB target shape as the built-in PRD 05 profiles so the
// existing overlay, scoring, and report-card comparison paths can consume them.
(function (root) {
  'use strict';

  var MAX_CUSTOM_PROFILES = 24;
  var BAND_KEYS = ['subBass', 'bass', 'lowMid', 'mid', 'highMid', 'presence', 'brilliance'];
  var BAND_CENTERS = [40, 125, 375, 1000, 3000, 5000, 12000];

  function finiteMean(xs) {
    var sum = 0, n = 0;
    for (var i = 0; i < (xs || []).length; i++) {
      var x = Number(xs[i]);
      if (Number.isFinite(x)) { sum += x; n += 1; }
    }
    return n ? sum / n : 0;
  }

  function slugLabel(label) {
    return String(label || 'Custom curve')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36) || 'custom-curve';
  }

  function clampDb(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(-18, Math.min(18, Math.round(n * 2) / 2));
  }

  function safeId(id, fallbackLabel) {
    var clean = String(id || '').trim().replace(/^custom:/, '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (clean) return clean.slice(0, 64);
    return slugLabel(fallbackLabel) + '-' + Date.now().toString(36);
  }

  function normalizeProfile(raw, freqs) {
    if (!raw || typeof raw !== 'object') return null;
    var label = String(raw.label || raw.name || '').trim().slice(0, 60);
    if (!label) return null;
    var dbOffsets = Array.isArray(raw.dbOffsets) ? raw.dbOffsets.map(clampDb) : [];
    if (dbOffsets.length !== freqs.length) return null;
    return {
      id: safeId(raw.id, label),
      label: label,
      description: String(raw.description || 'Custom ideal curve').trim().slice(0, 140),
      freqs: freqs.slice(),
      dbOffsets: dbOffsets,
      source: raw.source === 'analysis' ? 'analysis' : 'manual',
      createdAt: String(raw.createdAt || new Date().toISOString()),
      updatedAt: String(raw.updatedAt || raw.createdAt || new Date().toISOString()),
    };
  }

  function normalizeProfiles(raw, freqs) {
    var out = [];
    var seen = Object.create(null);
    var list = Array.isArray(raw) ? raw : [];
    for (var i = 0; i < list.length && out.length < MAX_CUSTOM_PROFILES; i++) {
      var p = normalizeProfile(list[i], freqs);
      if (!p || seen[p.id]) continue;
      seen[p.id] = true;
      out.push(p);
    }
    return out;
  }

  function bandOffsetsFromProfile(profile, freqs) {
    if (!profile || !Array.isArray(profile.dbOffsets) || profile.dbOffsets.length !== freqs.length) {
      return BAND_KEYS.map(function () { return 0; });
    }
    return BAND_CENTERS.map(function (center) {
      var best = 0, dist = Infinity;
      for (var i = 0; i < freqs.length; i++) {
        var d = Math.abs(Math.log2(freqs[i] / center));
        if (d < dist) { dist = d; best = i; }
      }
      return clampDb(profile.dbOffsets[best]);
    });
  }

  function profileFromBands(input, freqs, meta) {
    var bands = (input || []).map(clampDb);
    while (bands.length < BAND_CENTERS.length) bands.push(0);
    var dbOffsets = freqs.map(function (f) {
      var lf = Math.log10(f);
      if (f <= BAND_CENTERS[0]) return bands[0];
      if (f >= BAND_CENTERS[BAND_CENTERS.length - 1]) return bands[BAND_CENTERS.length - 1];
      for (var i = 0; i < BAND_CENTERS.length - 1; i++) {
        var a = BAND_CENTERS[i], b = BAND_CENTERS[i + 1];
        if (f >= a && f <= b) {
          var t = (lf - Math.log10(a)) / (Math.log10(b) - Math.log10(a));
          return Math.round((bands[i] + (bands[i + 1] - bands[i]) * t) * 100) / 100;
        }
      }
      return 0;
    });
    return normalizeProfile({
      id: meta && meta.id,
      label: meta && meta.label,
      description: meta && meta.description,
      dbOffsets: dbOffsets,
      source: 'manual',
      createdAt: meta && meta.createdAt,
      updatedAt: new Date().toISOString(),
    }, freqs);
  }

  function profileFromMeasuredCurve(curve, freqs, meta) {
    if (!curve || !Array.isArray(curve.db) || curve.db.length !== freqs.length) return null;
    var mean = finiteMean(curve.db);
    var dbOffsets = curve.db.map(function (db) {
      return Number.isFinite(db) ? clampDb(db - mean) : 0;
    });
    return normalizeProfile({
      id: meta && meta.id,
      label: meta && meta.label,
      description: meta && meta.description || 'Captured from the current analysis',
      dbOffsets: dbOffsets,
      source: 'analysis',
      createdAt: meta && meta.createdAt,
      updatedAt: new Date().toISOString(),
    }, freqs);
  }

  function upsertProfile(profiles, profile) {
    if (!profile) return normalizeProfiles(profiles, profile && profile.freqs || []);
    var next = (profiles || []).filter(function (p) { return p && p.id !== profile.id; });
    next.push(profile);
    return next.slice(-MAX_CUSTOM_PROFILES);
  }

  function deleteProfile(profiles, id) {
    var clean = String(id || '').replace(/^custom:/, '');
    return (profiles || []).filter(function (p) { return p && p.id !== clean; });
  }

  var api = {
    BAND_KEYS: BAND_KEYS,
    BAND_CENTERS: BAND_CENTERS,
    clampDb: clampDb,
    normalizeProfiles: normalizeProfiles,
    bandOffsetsFromProfile: bandOffsetsFromProfile,
    profileFromBands: profileFromBands,
    profileFromMeasuredCurve: profileFromMeasuredCurve,
    upsertProfile: upsertProfile,
    deleteProfile: deleteProfile,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.idealCurves = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
