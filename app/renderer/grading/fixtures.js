// Shared test fixtures for the grading.js test suite (split from grading.test.js
// per #225 — the original file exceeded the 500-line guideline). Pure data
// builders only, no assertions — every grading/*.test.js file requires this
// instead of duplicating the fixture shape.

// Seven-band table, all equal → every band's diff-from-others is 0. Overriding
// one band is how we inject an imbalance without disturbing the others' verdict.
const flatBands = (db = -30) => ({
  subBass: db, bass: db, lowMid: db, mid: db, highMid: db, presence: db, brilliance: db,
});

// A clean, healthy source: not clipping, RMS in band, DR comfortable, balanced.
// Individual tests override only the field under test (behaviour is a pure
// function of these fields, so nothing else can leak in).
const makeSrc = (over = {}) => ({
  rms: -17,
  peak: -6,
  dynamicRange: 10,
  clipping: false,
  centroid: 2000,
  contentType: null,
  bands: flatBands(),
  ...over,
});

// Per-channel live-capture contributors: n channels of flat bands, with the
// caller overriding individual channels to inject a hot band and labels.
const makeChannels = (overrides = []) =>
  overrides.map((o, i) => ({ name: `CH${i + 1}`, bands: flatBands(), ...o }));

module.exports = { flatBands, makeSrc, makeChannels };
