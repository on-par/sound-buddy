// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// #861 seam test: importing each rule-renderers/<type> adapter registers that
// type's renderer in the store as an import side effect — self-registration
// keyed by rule type, with no per-template global wiring file listing the
// types. The bare side-effect imports below ARE the registration under test.
import { describe, it, expect } from 'vitest';
import type { RuleType, RuleNarrativeData } from '@sound-buddy/audio-engine/dist/analyze/rule-narrative.js';
import { getRuleRenderer, registerRuleRenderer } from './rule-renderer-store';
import './rule-renderers/harshness';
import './rule-renderers/gate';
import './rule-renderers/phase';
import './rule-renderers/gain';

const RULE_TYPES: RuleType[] = ['harshness', 'gate', 'phase', 'gain'];

describe('rule renderer store (#861)', () => {
  it('self-registers the harshness renderer on import and renders flat data', () => {
    const renderer = getRuleRenderer('harshness');
    expect(renderer).toBeTypeOf('function');

    const data: RuleNarrativeData = {
      symptom: 'Quacky/harsh',
      excessDb: 10,
      band: '2–4 kHz',
      reference: '500 Hz–2 kHz',
      thresholdDb: 6,
      instruction: 'Cut 2–4 kHz',
    };
    expect(renderer!(data)).toBe(
      'The mix reads as Quacky/harsh: the 2–4 kHz region sits 10 dB above the ' +
        '500 Hz–2 kHz body (threshold 6 dB). Cut 2–4 kHz to tame it.',
    );
  });

  it('registers a renderer for every rule type, each independent via its own template', () => {
    for (const type of RULE_TYPES) {
      expect(getRuleRenderer(type), `${type} renderer missing`).toBeTypeOf('function');
    }

    const gateRenderer = getRuleRenderer('gate')!;
    expect(
      gateRenderer({
        behavior: 'closes over the first syllable of every word',
        timingMs: 45,
        thresholdDb: -40,
        instruction: 'Lower the threshold to -40 dB and shorten the attack time',
      }),
    ).toBe(
      'The gate closes over the first syllable of every word: it responds 45 ms ' +
        'after the signal onset at the -40 dB threshold. ' +
        'Lower the threshold to -40 dB and shorten the attack time.',
    );

    const phaseRenderer = getRuleRenderer('phase')!;
    expect(
      phaseRenderer({
        band: '60–100 Hz',
        channelA: '3',
        channelB: '4',
        polarity: 'polarity-inverted',
        instruction: 'Flip the polarity of channel 4',
      }),
    ).toBe(
      'In the 60–100 Hz range, channels 3 and 4 are polarity-inverted, causing ' +
        'audible phase cancellation. Flip the polarity of channel 4.',
    );

    const gainRenderer = getRuleRenderer('gain')!;
    expect(
      gainRenderer({
        channel: 'Kick',
        status: 'hot',
        levelDbfs: -8.2,
        distanceDb: 9.8,
        direction: 'above',
        targetDbfs: -18,
        instruction: 'Reduce gain at the preamp for channel Kick',
      }),
    ).toBe(
      'Channel Kick is running hot: its recorded level of -8.2 dBFS sits 9.8 dB ' +
        'above the -18 dBFS target. Reduce gain at the preamp for channel Kick.',
    );

    const outputs = RULE_TYPES.map((type) => getRuleRenderer(type)!({ instruction: 'x' }));
    expect(new Set(outputs).size).toBe(RULE_TYPES.length);
  });

  it('returns a miss value (null) — not a throw — for an unknown rule type', () => {
    // The RuleType union is closed, so an unknown string cannot be expressed
    // statically; the cast exercises the runtime miss path the acceptance
    // criterion demands (a future engine type that no renderer covers yet).
    const renderer = getRuleRenderer('bogus' as RuleType);
    expect(renderer).toBeNull();
  });

  it('upserts: registering a new renderer overwrites the import-time one', () => {
    const sentinel = (): string => 'overridden renderer';
    registerRuleRenderer('harshness', sentinel);
    expect(getRuleRenderer('harshness')).toBe(sentinel);
  });
});