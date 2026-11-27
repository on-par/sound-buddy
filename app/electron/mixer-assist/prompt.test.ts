// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  ASSIST_SYSTEM_PROMPT,
  MAX_ANSWER_CHARS,
  MAX_CONTEXT_CHANNELS,
  MAX_PROMPT_CHARS,
  MAX_QUESTION_CHARS,
  buildPrompt,
  capAnswer,
  parseAssistRequest,
} from './prompt';
import type { MixerAssistChannelContext } from '../ipc/api';

const VOX: MixerAssistChannelContext = {
  channel: 2,
  name: 'Vox 1',
  faderDb: -5,
  levelDbfs: -0.2,
  gainReductionDb: null,
  dynamics: { on: true, thresholdDb: -20, ratio: 4 },
  diagnosis: 'Input is clipping at the preamp.',
};

describe('parseAssistRequest', () => {
  it('accepts a typed question and keeps only the typed fields', () => {
    const parsed = parseAssistRequest({
      trigger: 'question',
      question: '  Why is Vox 1 flagged?  ',
      channels: [{ ...VOX, filePath: '/Users/op/Music/take.wav', notes: 'pastor mic is flaky', sceneName: 'Sunday AM' }],
      churchName: 'Grace Chapel',
      licenseKey: 'SB-LICENSE-1234',
      audio: [0.1, 0.2],
    });
    expect(parsed).toEqual({ trigger: 'question', question: 'Why is Vox 1 flagged?', channels: [VOX] });
  });

  it('accepts a typed anomaly with its issue and Sermon Quiet flag', () => {
    const issue = { key: 'clipping:2', kind: 'clipping', severity: 'issue', channel: 2, diagnosis: 'Input is clipping.' };
    expect(parseAssistRequest({ trigger: 'anomaly', issue, sermonQuiet: true, channels: [VOX] })).toEqual({
      trigger: 'anomaly',
      issue,
      sermonQuiet: true,
      channels: [VOX],
    });
  });

  it.each([
    null,
    'question',
    { trigger: 'poll' },
    { trigger: 'question', question: '   ', channels: [] },
    { trigger: 'question', question: 42, channels: [] },
    { trigger: 'anomaly', issue: { key: 'x', kind: 'mud', severity: 'issue', channel: 1, diagnosis: '' }, sermonQuiet: false, channels: [] },
    { trigger: 'anomaly', issue: { key: 'x', kind: 'clipping', severity: 'urgent', channel: 1, diagnosis: '' }, sermonQuiet: false, channels: [] },
    { trigger: 'anomaly', issue: null, sermonQuiet: false, channels: [] },
  ])('rejects the malformed request %p', (raw) => {
    expect(parseAssistRequest(raw)).toBeNull();
  });

  it('caps the question, the channel list and every string, and drops channels without a valid number', () => {
    const many = Array.from({ length: MAX_CONTEXT_CHANNELS + 4 }, (_, i) => ({ ...VOX, channel: i + 1, name: `N${'x'.repeat(40)}` }));
    const parsed = parseAssistRequest({
      trigger: 'question',
      question: 'q'.repeat(MAX_QUESTION_CHARS + 50),
      channels: [{ ...VOX, channel: 0 }, { ...VOX, channel: 2.5 }, 'junk', ...many],
    });
    expect(parsed?.trigger).toBe('question');
    expect(parsed && parsed.trigger === 'question' && parsed.question.length).toBe(MAX_QUESTION_CHARS);
    expect(parsed?.channels).toHaveLength(MAX_CONTEXT_CHANNELS);
    expect(parsed?.channels[0].name.length).toBeLessThanOrEqual(16);
  });

  it('turns non-finite or out-of-range numbers into null and strips control characters from text', () => {
    const parsed = parseAssistRequest({
      trigger: 'question',
      question: 'line one\nline two\u0007',
      channels: [{ ...VOX, name: 'Vo\u0000x', faderDb: Number.NaN, levelDbfs: 999, gainReductionDb: -3, dynamics: { on: 'yes', thresholdDb: 0, ratio: 4 }, diagnosis: 7 }],
    });
    expect(parsed).toEqual({
      trigger: 'question',
      question: 'line one line two',
      channels: [{ channel: 2, name: 'Vox', faderDb: null, levelDbfs: null, gainReductionDb: null, dynamics: null, diagnosis: null }],
    });
  });

  it('drops dynamics with an out-of-range threshold or ratio, and blanks a missing name or issue key', () => {
    const parsed = parseAssistRequest({
      trigger: 'anomaly',
      issue: { kind: 'clipping', severity: 'issue', channel: 2 },
      sermonQuiet: false,
      channels: [
        { ...VOX, name: undefined, dynamics: { on: true, thresholdDb: -500, ratio: 4 } },
        { ...VOX, channel: 3, dynamics: { on: true, thresholdDb: -10, ratio: 0.5 } },
      ],
    });
    expect(parsed?.channels.map((c) => [c.name, c.dynamics])).toEqual([
      ['', null],
      ['Vox 1', null],
    ]);
    expect(parsed?.trigger === 'anomaly' && parsed.issue).toEqual({ key: '', kind: 'clipping', severity: 'issue', channel: 2, diagnosis: '' });
  });

  it('treats a missing channel list as empty', () => {
    expect(parseAssistRequest({ trigger: 'question', question: 'hi' })).toEqual({ trigger: 'question', question: 'hi', channels: [] });
  });
});

describe('buildPrompt', () => {
  it('puts the instructions, the console readings and the question in one capped stdin prompt', () => {
    const prompt = buildPrompt({ trigger: 'question', question: 'Why is Vox 1 flagged?', channels: [VOX] });
    expect(prompt.system).toBe(ASSIST_SYSTEM_PROMPT);
    expect(prompt.user).toContain('Ch 02 "Vox 1": fader -5.0 dB, input peak -0.2 dBFS, compressor gain reduction unavailable, compressor on, threshold -20.0 dB, ratio 4.0:1');
    expect(prompt.user).toContain('Rule note: Input is clipping at the preamp.');
    expect(prompt.user).toContain('Operator question: Why is Vox 1 flagged?');
    expect(prompt.combined.startsWith(ASSIST_SYSTEM_PROMPT)).toBe(true);
    expect(prompt.combined).toContain(prompt.user);
  });

  it('frames an anomaly as a rule alert to explain, with unread values marked unavailable', () => {
    const prompt = buildPrompt({
      trigger: 'anomaly',
      issue: { key: 'clipping:2', kind: 'clipping', severity: 'issue', channel: 2, diagnosis: 'Input is clipping.' },
      sermonQuiet: false,
      channels: [{ ...VOX, faderDb: null, levelDbfs: null, gainReductionDb: 6, dynamics: { on: false, thresholdDb: -10, ratio: 2 }, diagnosis: null }],
    });
    expect(prompt.user).toContain('Rule alert (Issue): clipping on Ch 02 — Input is clipping.');
    expect(prompt.user).toContain('fader unavailable, input peak unavailable, compressor gain reduction 6.0 dB, compressor off');
    expect(prompt.user).not.toContain('Operator question');
  });

  it('names a room-level alert as the room and handles no channel readings', () => {
    const prompt = buildPrompt({
      trigger: 'anomaly',
      issue: { key: 'feedback-risk:room', kind: 'feedback-risk', severity: 'issue', channel: null, diagnosis: 'Room ring near 2.5 kHz.' },
      sermonQuiet: true,
      channels: [{ ...VOX, dynamics: null }],
    });
    expect(prompt.user).toContain('feedback-risk in the room');
    expect(prompt.user).toContain('dynamics not read');
    expect(buildPrompt({ trigger: 'question', question: 'hello', channels: [] }).user).toContain('No channel readings were included.');
  });

  it('never exceeds the prompt cap', () => {
    const channels = Array.from({ length: MAX_CONTEXT_CHANNELS }, (_, i) => ({ ...VOX, channel: i + 1, diagnosis: 'd'.repeat(240) }));
    const prompt = buildPrompt({ trigger: 'question', question: 'q'.repeat(MAX_QUESTION_CHARS), channels });
    expect(prompt.combined.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
  });

  it('never carries audio, file paths, scene names, notes, church name or licence data', () => {
    const parsed = parseAssistRequest({
      trigger: 'question',
      question: 'What next?',
      channels: [{ ...VOX, filePath: '/Users/op/x.wav', sceneName: 'Easter', notes: 'secret note' }],
      churchName: 'Grace Chapel',
      license: 'SB-KEY',
      samples: [1, 2, 3],
    });
    const text = buildPrompt(parsed!).combined;
    for (const leaked of ['/Users/op', 'Easter', 'secret note', 'Grace Chapel', 'SB-KEY', '1,2,3']) expect(text).not.toContain(leaked);
  });
});

describe('capAnswer', () => {
  it('trims and caps the answer text', () => {
    expect(capAnswer('  short  ')).toBe('short');
    expect(capAnswer('a'.repeat(MAX_ANSWER_CHARS + 10))).toHaveLength(MAX_ANSWER_CHARS + 1);
  });
});
