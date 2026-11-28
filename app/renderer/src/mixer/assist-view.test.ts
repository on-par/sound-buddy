// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import type { ConsoleChannelStateDto, MixerAssistStatusDto } from '../../../electron/ipc/api';
import type { MixerIssue } from './attention';
import {
  ASSIST_CHIPS,
  ASSIST_CLOUD_SOURCE_LABEL,
  BUSY_LINE,
  CLAUDE_MISSING_LINE,
  CLAUDE_SIGNED_OUT_LINE,
  COMPOSER_OFF_PLACEHOLDER,
  COMPOSER_READY_PLACEHOLDER,
  COMPOSER_UNAVAILABLE_PLACEHOLDER,
  FALLBACK_COPY,
  RULES_FALLBACK_LINE,
  STORED_TOKEN_LINE,
  assistChannels,
  newlyVisibleIssues,
  questionChannelIndexes,
  railAssistView,
  runtimeHealth,
  settingsStatusLines,
  type AssistRailInput,
} from './assist-view';

const OFF: MixerAssistStatusDto = {
  cloud: { enabled: false, binaryFound: false, tokenSaved: false, encryptionAvailable: true, lastFailure: null },
  local: { enabled: false, endpoint: 'unset', modelSet: false, lastFailure: null },
  inFlight: false,
};

const CLOUD_READY: MixerAssistStatusDto = { ...OFF, cloud: { enabled: true, binaryFound: true, tokenSaved: true, encryptionAvailable: true, lastFailure: null } };
const LOCAL_READY: MixerAssistStatusDto = { ...OFF, local: { enabled: true, endpoint: 'ok', modelSet: true, lastFailure: null } };

function rail(status: MixerAssistStatusDto | null, over: Partial<AssistRailInput> = {}) {
  return railAssistView({ status, pending: null, answers: [], lastFailure: null, localModel: 'qwen2.5', ...over });
}

const CH = (index: number, name: string, faderDb = -5): ConsoleChannelStateDto => ({
  index,
  name,
  faderDb,
  on: true,
  color: { base: 'red', inverted: false },
  icon: 1,
  dynamics: { on: true, mode: 'COMP', thr: -20, ratio: 4, knee: 2, mgain: 0 },
});

const ISSUE = (channel: number | null, severity: MixerIssue['severity'] = 'issue', kind: MixerIssue['kind'] = 'clipping'): MixerIssue => ({
  key: `${kind}:${channel ?? 'room'}`,
  kind,
  channel,
  severity,
  magnitude: 1,
  activeSince: 0,
  diagnosis: `Diagnosis ${channel}`,
});

describe('runtimeHealth', () => {
  it('reports off, ready, or the static and last-call reasons for each runtime', () => {
    expect(runtimeHealth(OFF)).toEqual({ cloud: { state: 'off', reasons: [] }, local: { state: 'off', reasons: [] } });
    expect(runtimeHealth(CLOUD_READY).cloud).toEqual({ state: 'ready', reasons: [] });
    expect(runtimeHealth({ ...OFF, cloud: { enabled: true, binaryFound: false, tokenSaved: false, encryptionAvailable: false, lastFailure: null } }).cloud).toEqual({
      state: 'unavailable',
      reasons: ['no-binary', 'no-encryption', 'no-token'],
    });
    expect(runtimeHealth({ ...OFF, local: { enabled: true, endpoint: 'invalid', modelSet: false, lastFailure: null } }).local).toEqual({ state: 'unavailable', reasons: ['bad-endpoint', 'no-model'] });
    expect(runtimeHealth({ ...OFF, local: { enabled: true, endpoint: 'unset', modelSet: true, lastFailure: null } }).local.reasons).toEqual(['no-endpoint']);
  });

  it('an availability failure from the last call makes a configured runtime unavailable; a transient one keeps it ready with a line', () => {
    expect(runtimeHealth({ ...LOCAL_READY, local: { ...LOCAL_READY.local, lastFailure: 'endpoint-down' } }).local).toEqual({ state: 'unavailable', reasons: ['endpoint-down'] });
    expect(runtimeHealth({ ...CLOUD_READY, cloud: { ...CLOUD_READY.cloud, lastFailure: 'timeout' } }).cloud).toEqual({ state: 'ready', reasons: ['timeout'] });
  });
});

describe('railAssistView', () => {
  it('both off: rules only, composer disabled, no chips, no Cloud or Local wording', () => {
    const view = rail(OFF);
    expect(view).toMatchObject({ mode: 'off', composerEnabled: false, composerPlaceholder: COMPOSER_OFF_PLACEHOLDER, chips: [], fallbackLines: [] });
    expect(JSON.stringify(view)).not.toMatch(/Cloud|Local/);
    expect(COMPOSER_OFF_PLACEHOLDER).toMatch(/^Rules only\. .*\bSettings$/);
    expect(rail(null).mode).toBe('off');
  });

  it('healthy: composer enabled with quick chips', () => {
    expect(rail(CLOUD_READY)).toMatchObject({ mode: 'ready', composerEnabled: true, composerPlaceholder: COMPOSER_READY_PLACEHOLDER, chips: ASSIST_CHIPS });
    expect(rail(LOCAL_READY).composerEnabled).toBe(true);
  });

  it('enabled but unavailable: composer disabled, no chips, one line per reason, then the rules line', () => {
    const view = rail({ ...OFF, cloud: { enabled: true, binaryFound: false, tokenSaved: false, encryptionAvailable: true, lastFailure: null }, local: { enabled: true, endpoint: 'ok', modelSet: true, lastFailure: 'endpoint-down' } });
    expect(view).toMatchObject({ mode: 'unavailable', composerEnabled: false, composerPlaceholder: COMPOSER_UNAVAILABLE_PLACEHOLDER, chips: [] });
    expect(view.fallbackLines.map((l) => l.text)).toEqual([FALLBACK_COPY.cloud['no-binary'], FALLBACK_COPY.cloud['no-token'], FALLBACK_COPY.local['endpoint-down'], RULES_FALLBACK_LINE]);
    expect(view.fallbackLines.map((l) => l.key)).toEqual(['cloud:no-binary', 'cloud:no-token', 'local:endpoint-down', 'rules']);
  });

  it('a ready runtime with a transient failure on the other keeps the composer and still shows the line', () => {
    const view = rail({ ...CLOUD_READY, local: { enabled: true, endpoint: 'ok', modelSet: true, lastFailure: 'endpoint-down' } });
    expect(view.composerEnabled).toBe(true);
    expect(view.fallbackLines.map((l) => l.key)).toEqual(['local:endpoint-down']);
  });

  it('in flight: shows the pending line so Cancel can render', () => {
    expect(rail(CLOUD_READY, { pending: { trigger: 'question', label: 'Why is 02 flagged?' } }).pending).toBe('Asking: Why is 02 flagged?');
    expect(rail(CLOUD_READY, { pending: { trigger: 'anomaly', label: '02 Vox 1' } }).pending).toBe('Explaining the new card on 02 Vox 1…');
  });

  it('busy: a second question gets its own line', () => {
    expect(rail(CLOUD_READY, { lastFailure: { reason: 'busy', attempts: [], trigger: 'question' } }).busyLine).toBe(BUSY_LINE);
    expect(rail(CLOUD_READY, { lastFailure: { reason: 'exit', attempts: [{ source: 'cloud', reason: 'exit' }], trigger: 'question' } }).busyLine).toBeNull();
  });

  it('the failed attempts of the last question show as lines even when status has not caught up', () => {
    const view = rail(CLOUD_READY, { lastFailure: { reason: 'timeout', attempts: [{ source: 'cloud', reason: 'timeout' }], trigger: 'question' } });
    expect(view.fallbackLines.map((l) => l.key)).toEqual(['cloud:timeout']);
  });

  it('falls back to a generic line for a reason with no specific copy, and never repeats or shows silent reasons', () => {
    const view = rail(
      { ...CLOUD_READY, local: { enabled: true, endpoint: 'ok', modelSet: true, lastFailure: 'endpoint-down' } },
      {
        lastFailure: {
          reason: 'bad-response',
          attempts: [
            { source: 'cloud', reason: 'bad-response' },
            { source: 'local', reason: 'endpoint-down' },
            { source: 'cloud', reason: 'cancelled' },
          ],
          trigger: 'question',
        },
      }
    );
    expect(view.fallbackLines).toEqual([
      { key: 'local:endpoint-down', text: FALLBACK_COPY.local['endpoint-down'] },
      { key: 'cloud:bad-response', text: "Cloud assist couldn't answer. Ask again." },
    ]);
  });

  it('answers are labelled with their source and keep their plain text', () => {
    const view = rail(LOCAL_READY, {
      answers: [
        { id: 2, source: 'local', text: '<b>Check</b> the trim.', about: 'Why is 02 flagged?' },
        { id: 1, source: 'cloud', text: 'Lower 02.', about: 'About 02 Vox 1' },
      ],
    });
    expect(view.answers).toEqual([
      { id: 2, sourceLabel: 'Local · qwen2.5', text: '<b>Check</b> the trim.', about: 'Why is 02 flagged?' },
      { id: 1, sourceLabel: ASSIST_CLOUD_SOURCE_LABEL, text: 'Lower 02.', about: 'About 02 Vox 1' },
    ]);
    expect(rail(LOCAL_READY, { localModel: '', answers: [{ id: 3, source: 'local', text: 't', about: 'q' }] }).answers[0].sourceLabel).toBe('Local model');
  });
});

describe('settingsStatusLines', () => {
  it('says off, ready, or exactly what is missing for each runtime', () => {
    expect(settingsStatusLines(OFF, '')).toEqual({ cloud: 'Cloud assist is off.', local: 'Local assist is off.', token: 'Not set', binary: 'Claude Code not found' });
    expect(settingsStatusLines(CLOUD_READY, '')).toMatchObject({ cloud: 'Cloud assist is ready: Claude Code found, token saved.', token: 'Token saved', binary: 'Claude Code found' });
    expect(settingsStatusLines(LOCAL_READY, 'http://127.0.0.1:11434/v1').local).toBe('Local assist is ready: http://127.0.0.1:11434/v1.');
    expect(settingsStatusLines({ ...OFF, cloud: { ...CLOUD_READY.cloud, tokenSaved: false } }, '').cloud).toBe(`Cloud assist can't run yet. ${FALLBACK_COPY.cloud['no-token']}`);
    expect(settingsStatusLines({ ...OFF, local: { enabled: true, endpoint: 'invalid', modelSet: false, lastFailure: null } }, 'x').local).toBe(
      `Local assist can't run yet. ${FALLBACK_COPY.local['bad-endpoint']} ${FALLBACK_COPY.local['no-model']}`
    );
    expect(settingsStatusLines(null, '')).toEqual({ cloud: 'Checking Cloud assist…', local: 'Checking Local assist…', token: 'Not set', binary: 'Checking…' });
  });
});

describe('login path (flag mixerCloudAssistLogin): Claude Code\'s own login', () => {
  const LOGIN_READY: MixerAssistStatusDto = { ...OFF, cloud: { enabled: true, binaryFound: true, tokenSaved: false, encryptionAvailable: null, lastFailure: null, auth: 'login', storedToken: false } };
  const MISSING: MixerAssistStatusDto = { ...LOGIN_READY, cloud: { ...LOGIN_READY.cloud, binaryFound: false } };
  const SIGNED_OUT: MixerAssistStatusDto = { ...LOGIN_READY, cloud: { ...LOGIN_READY.cloud, lastFailure: 'not-signed-in' } };
  const FORBIDDEN = /Paste token|write-only token|Token saved|setup-token|token isn't set|encrypt/i;

  it('no token and no keychain are needed: an installed claude is ready', () => {
    expect(runtimeHealth(LOGIN_READY).cloud).toEqual({ state: 'ready', reasons: [] });
    expect(rail(LOGIN_READY)).toMatchObject({ mode: 'ready', composerEnabled: true, chips: ASSIST_CHIPS, fallbackLines: [] });
  });

  it('missing binary and signed out are distinct, honest lines that fall back to rules', () => {
    const missing = rail(MISSING);
    const signedOut = rail(SIGNED_OUT);
    expect(missing).toMatchObject({ mode: 'unavailable', composerEnabled: false, chips: [] });
    expect(signedOut).toMatchObject({ mode: 'unavailable', composerEnabled: false, chips: [] });
    expect(missing.fallbackLines).toEqual([{ key: 'cloud:no-binary', text: CLAUDE_MISSING_LINE }, { key: 'rules', text: RULES_FALLBACK_LINE }]);
    expect(signedOut.fallbackLines).toEqual([{ key: 'cloud:not-signed-in', text: CLAUDE_SIGNED_OUT_LINE }, { key: 'rules', text: RULES_FALLBACK_LINE }]);
    expect(CLAUDE_MISSING_LINE).toMatch(/^Claude Code isn't installed on this Mac\./);
    expect(CLAUDE_SIGNED_OUT_LINE).toMatch(/^Claude Code isn't signed in\. Run claude in Terminal and sign in/);
    expect(CLAUDE_MISSING_LINE).not.toBe(CLAUDE_SIGNED_OUT_LINE);
    expect(JSON.stringify([missing, signedOut])).not.toMatch(FORBIDDEN);
  });

  it('a signed-out failure from the last question shows its line even before status catches up', () => {
    const view = rail(LOGIN_READY, { lastFailure: { reason: 'not-signed-in', attempts: [{ source: 'cloud', reason: 'not-signed-in' }], trigger: 'question' } });
    expect(view.fallbackLines.map((l) => l.text)).toEqual([CLAUDE_SIGNED_OUT_LINE]);
  });

  it('a stored token from before shows a one-line notice pointing to Settings, whatever the runtimes are doing', () => {
    const stored = (s: MixerAssistStatusDto): MixerAssistStatusDto => ({ ...s, cloud: { ...s.cloud, storedToken: true } });
    expect(rail(stored(LOGIN_READY)).fallbackLines).toEqual([{ key: 'cloud:stored-token', text: STORED_TOKEN_LINE }]);
    expect(rail(stored(LOGIN_READY)).composerEnabled).toBe(true);
    expect(rail(stored({ ...LOGIN_READY, cloud: { ...LOGIN_READY.cloud, enabled: false } })).fallbackLines).toEqual([{ key: 'cloud:stored-token', text: STORED_TOKEN_LINE }]);
    expect(rail(stored(MISSING)).fallbackLines.map((l) => l.key)).toEqual(['cloud:stored-token', 'cloud:no-binary', 'rules']);
    expect(STORED_TOKEN_LINE).toContain('no longer stores');
  });

  it('Settings status lines name the login, not a token', () => {
    expect(settingsStatusLines(LOGIN_READY, '').cloud).toBe('Cloud assist is ready: Claude Code found, using your Claude Code login.');
    expect(settingsStatusLines(MISSING, '').cloud).toBe(`Cloud assist can't run yet. ${CLAUDE_MISSING_LINE}`);
    expect(settingsStatusLines(SIGNED_OUT, '').cloud).toBe(`Cloud assist can't run yet. ${CLAUDE_SIGNED_OUT_LINE}`);
    expect(JSON.stringify([LOGIN_READY, MISSING, SIGNED_OUT].map((s) => settingsStatusLines(s, '').cloud))).not.toMatch(FORBIDDEN);
  });

  it('the token path keeps its original missing-binary copy', () => {
    expect(rail({ ...CLOUD_READY, cloud: { ...CLOUD_READY.cloud, binaryFound: false } }).fallbackLines[0]).toEqual({ key: 'cloud:no-binary', text: FALLBACK_COPY.cloud['no-binary'] });
    expect(FALLBACK_COPY.cloud['no-binary']).not.toBe(CLAUDE_MISSING_LINE);
  });
});

describe('assist context builders', () => {
  it('builds typed channel context from the console poll, meters and the rule notes only', () => {
    const channels = [CH(2, 'Vox 1'), CH(3, '', -Infinity)];
    expect(assistChannels([2, 3, 9], channels, [1, 0.5, 0], [ISSUE(2)])).toEqual([
      { channel: 2, name: 'Vox 1', faderDb: -5, levelDbfs: expect.closeTo(-6.02, 2), gainReductionDb: null, dynamics: { on: true, thresholdDb: -20, ratio: 4 }, diagnosis: 'Diagnosis 2' },
      { channel: 3, name: '', faderDb: null, levelDbfs: null, gainReductionDb: null, dynamics: { on: true, thresholdDb: -20, ratio: 4 }, diagnosis: null },
    ]);
  });

  it('a channel with no meter reading yet has no level', () => {
    expect(assistChannels([2], [CH(2, 'Vox 1')], [], [])[0].levelDbfs).toBeNull();
  });

  it('a question carries the visible card channels then the inspected channel, deduplicated and capped', () => {
    expect(questionChannelIndexes([ISSUE(5), ISSUE(null), ISSUE(2)], 5)).toEqual([5, 2]);
    expect(questionChannelIndexes([ISSUE(5)], 7)).toEqual([5, 7]);
    expect(questionChannelIndexes([], null)).toEqual([]);
    expect(questionChannelIndexes(Array.from({ length: 12 }, (_, i) => ISSUE(i + 1)), 20)).toHaveLength(8);
  });

  it('newlyVisibleIssues returns only Issue-severity cards that were not visible before', () => {
    const prev = new Set(['clipping:2']);
    expect(newlyVisibleIssues(prev, [ISSUE(2), ISSUE(3), ISSUE(4, 'check'), ISSUE(null, 'issue', 'feedback-risk')]).map((i) => i.key)).toEqual(['clipping:3', 'feedback-risk:room']);
  });
});
