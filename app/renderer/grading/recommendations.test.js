import { describe, it, expect } from 'vitest';

const grading = require('../grading.js');
const { flatBands, makeSrc, makeChannels } = require('./fixtures.js');

describe('computeRecommendations', () => {
  it('leads with the critical clipping warning', () => {
    const recs = grading.computeRecommendations(makeSrc({ clipping: true }));
    expect(recs[0]).toBe('CRITICAL: Clipping detected. Reduce input gain immediately.');
  });

  it('surfaces the recording-type note for a low-gain take', () => {
    const src = makeSrc({ peak: -10, rms: -33, dynamicRange: 20, contentType: 'speech' });
    const note = grading.analyzeRecordingType(src).note;
    expect(grading.computeRecommendations(src)).toContain(note);
  });

  it('warns when the recording is too hot', () => {
    const recs = grading.computeRecommendations(makeSrc({ rms: -8, peak: -10 }));
    expect(recs).toContain('Your recording is too hot. Reduce gain to avoid clipping.');
  });

  it('warns when the recording is too quiet', () => {
    const recs = grading.computeRecommendations(makeSrc({ rms: -30, peak: -10 }));
    expect(recs).toContain('Your recording is too quiet. Increase input gain or fader levels.');
  });

  it('warns about a compressed dynamic range', () => {
    const recs = grading.computeRecommendations(makeSrc({ dynamicRange: 2 }));
    expect(recs).toContain('Dynamic range is very compressed. Mix may sound lifeless.');
  });

  it('warns about excess sub-bass energy', () => {
    const recs = grading.computeRecommendations(makeSrc({ bands: { ...flatBands(-30), subBass: -5 } }));
    expect(recs).toContain('Too much sub-bass energy. Apply a high-pass filter below 80Hz.');
  });

  it('names the over-hot band and caps the suggested cut at 10 dB', () => {
    const recs = grading.computeRecommendations(makeSrc({ bands: { ...flatBands(-30), mid: -8 } }));
    expect(recs).toContain('Too much energy in Mid (500Hz-2kHz). Cut 10.0 dB around this range.');
  });

  it('warns about a dull mix lacking brilliance', () => {
    const recs = grading.computeRecommendations(makeSrc({ bands: { ...flatBands(-30), brilliance: -45 } }));
    expect(recs).toContain('Mix lacks air and brightness. Boost 2-3 dB above 8kHz.');
  });

  it('congratulates a clean recording when nothing is wrong', () => {
    expect(grading.computeRecommendations(makeSrc())).toEqual([
      'Great job! No major issues detected — levels and balance are solid.',
    ]);
  });

  it('never returns more than five recommendations', () => {
    // Pile on every rule at once: clipping, quiet, compressed DR, sub-bass, and
    // multiple imbalanced bands — the raw list exceeds five and is sliced.
    const bands = { ...flatBands(-30), subBass: -5, mid: -8, highMid: -8, presence: -8 };
    const recs = grading.computeRecommendations(
      makeSrc({ clipping: true, rms: -30, peak: -10, dynamicRange: 2, bands }),
    );
    expect(recs.length).toBeLessThanOrEqual(5);
  });
});

describe('band-balance channel attribution (#262)', () => {
  it('names the loudest contributing channel by its saved label', () => {
    const channels = makeChannels([
      { label: 'Acoustic Guitar', bands: { ...flatBands(-30), mid: -8 } },
      { bands: flatBands(-30) },
    ]);
    const recs = grading.computeRecommendations(
      makeSrc({ bands: { ...flatBands(-30), mid: -8 }, channels }),
    );
    expect(recs).toContain(
      'Too much energy in Mid (500Hz-2kHz). Cut 10.0 dB around this range. Mostly coming from "Acoustic Guitar".',
    );
  });

  it('falls back to the engine-supplied name when no label is saved', () => {
    const channels = makeChannels([
      { name: 'Kick Mic', bands: { ...flatBands(-30), mid: -8 } },
    ]);
    const recs = grading.computeRecommendations(
      makeSrc({ bands: { ...flatBands(-30), mid: -8 }, channels }),
    );
    expect(recs).toContain(
      'Too much energy in Mid (500Hz-2kHz). Cut 10.0 dB around this range. Mostly coming from "Kick Mic".',
    );
  });

  it('falls back to a generic "Channel N" when there is neither a label nor a name', () => {
    const channels = [
      { bands: flatBands(-30) },
      { bands: flatBands(-30) },
      { bands: { ...flatBands(-30), mid: -8 } },
    ];
    const recs = grading.computeRecommendations(
      makeSrc({ bands: { ...flatBands(-30), mid: -8 }, channels }),
    );
    expect(recs).toContain(
      'Too much energy in Mid (500Hz-2kHz). Cut 10.0 dB around this range. Mostly coming from "Channel 3".',
    );
  });

  it('treats a whitespace-only label as absent and falls back to the name', () => {
    const channels = makeChannels([
      { label: '   ', name: 'Overhead L', bands: { ...flatBands(-30), mid: -8 } },
    ]);
    const recs = grading.computeRecommendations(
      makeSrc({ bands: { ...flatBands(-30), mid: -8 }, channels }),
    );
    expect(recs).toContain(
      'Too much energy in Mid (500Hz-2kHz). Cut 10.0 dB around this range. Mostly coming from "Overhead L".',
    );
  });

  it('breaks ties between equally loud channels toward the lowest index', () => {
    const channels = makeChannels([
      { label: 'First', bands: { ...flatBands(-30), mid: -8 } },
      { label: 'Second', bands: { ...flatBands(-30), mid: -8 } },
    ]);
    const recs = grading.computeRecommendations(
      makeSrc({ bands: { ...flatBands(-30), mid: -8 }, channels }),
    );
    expect(recs).toContain(
      'Too much energy in Mid (500Hz-2kHz). Cut 10.0 dB around this range. Mostly coming from "First".',
    );
  });

  it('emits the exact band-only text with no attribution when the source has no channels field', () => {
    const recs = grading.computeRecommendations(makeSrc({ bands: { ...flatBands(-30), mid: -8 } }));
    expect(recs).toContain('Too much energy in Mid (500Hz-2kHz). Cut 10.0 dB around this range.');
    expect(recs.some(r => r.includes('Mostly coming from'))).toBe(false);
  });

  it('falls back to band-only text for an empty channels array or unusable channel data', () => {
    const emptyRecs = grading.computeRecommendations(
      makeSrc({ bands: { ...flatBands(-30), mid: -8 }, channels: [] }),
    );
    expect(emptyRecs).toContain('Too much energy in Mid (500Hz-2kHz). Cut 10.0 dB around this range.');

    const unusableChannels = [
      { label: 'No Bands' },
      { label: 'NaN Mid', bands: { ...flatBands(-30), mid: NaN } },
    ];
    const unusableRecs = grading.computeRecommendations(
      makeSrc({ bands: { ...flatBands(-30), mid: -8 }, channels: unusableChannels }),
    );
    expect(unusableRecs).toContain('Too much energy in Mid (500Hz-2kHz). Cut 10.0 dB around this range.');
    expect(unusableRecs.some(r => r.includes('Mostly coming from'))).toBe(false);
  });
});

describe('grading.loudestBandContributor', () => {
  it('returns null for undefined channels', () => {
    expect(grading.loudestBandContributor(undefined, 'mid')).toBeNull();
  });

  it('returns null for an empty channel list', () => {
    expect(grading.loudestBandContributor([], 'mid')).toBeNull();
  });

  it('returns null when no channel has usable data for the band', () => {
    const channels = [
      { label: 'A' },
      { label: 'B', bands: { mid: NaN } },
      { label: 'C', bands: { mid: -Infinity } },
    ];
    expect(grading.loudestBandContributor(channels, 'mid')).toBeNull();
  });

  it('returns the index and label of the loudest channel', () => {
    const channels = makeChannels([
      { label: 'Quiet', bands: { ...flatBands(-30), mid: -30 } },
      { label: 'Loud', bands: { ...flatBands(-30), mid: -5 } },
    ]);
    expect(grading.loudestBandContributor(channels, 'mid')).toEqual({ index: 1, label: 'Loud' });
  });

  it('resolves ties to the lowest index', () => {
    const channels = makeChannels([
      { label: 'First', bands: { ...flatBands(-30), mid: -5 } },
      { label: 'Second', bands: { ...flatBands(-30), mid: -5 } },
    ]);
    expect(grading.loudestBandContributor(channels, 'mid')).toEqual({ index: 0, label: 'First' });
  });
});
