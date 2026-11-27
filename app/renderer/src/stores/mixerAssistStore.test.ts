// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { create } from 'zustand';
import type {
  ConsoleChannelStateDto,
  MixerAssistAnswer,
  MixerAssistApi,
  MixerAssistRequest,
  MixerAssistStatusDto,
  SetMixerAssistTokenResult,
} from '../../../electron/ipc/api';
import type { MixerIssue } from '../mixer/attention';
import {
  bindAssistNarration,
  bindAssistStatusRefresh,
  createMixerAssistStore,
  type AssistContextSnapshot,
  type NarrationSource,
  type StatusRefreshSources,
} from './mixerAssistStore';
import { MAX_ASSIST_ANSWERS } from '../mixer/assist-view';
import { useMixerAssistStore } from './mixerAssistStore';
import { useSettingsStore } from './settingsStore';
import { useLiveCaptureStore } from './liveCaptureStore';
import { useConsoleStore } from './consoleStore';
import { useMixerStore } from './mixerStore';
import { createMockSoundBuddy, DEFAULT_MIXER_ASSIST_STATUS } from '../mock-sound-buddy';

const FAKE_TOKEN = 'fake-renderer-token-0000';

const OFF: MixerAssistStatusDto = {
  cloud: { enabled: false, binaryFound: false, tokenSaved: false, encryptionAvailable: true, lastFailure: null },
  local: { enabled: false, endpoint: 'unset', modelSet: false, lastFailure: null },
  inFlight: false,
};
const READY: MixerAssistStatusDto = { ...OFF, cloud: { enabled: true, binaryFound: true, tokenSaved: true, encryptionAvailable: true, lastFailure: null } };

const CH: ConsoleChannelStateDto = {
  index: 2,
  name: 'Vox 1',
  faderDb: -5,
  on: true,
  color: { base: 'red', inverted: false },
  icon: 1,
  dynamics: { on: false, mode: 'COMP', thr: -10, ratio: 3, knee: 0, mgain: 0 },
};

const ISSUE: MixerIssue = { key: 'clipping:2', kind: 'clipping', channel: 2, severity: 'issue', magnitude: 2, activeSince: 0, diagnosis: 'Input is clipping.' };

const CONTEXT: AssistContextSnapshot = { channels: [CH], meters: [0, 1], visible: [ISSUE], issues: [ISSUE], inspected: 2, sermonQuiet: false };

function fakeApi(over: Partial<MixerAssistApi> = {}) {
  const asked: MixerAssistRequest[] = [];
  const tokens: string[] = [];
  const statusCalls: Array<boolean | undefined> = [];
  let cancels = 0;
  let status: MixerAssistStatusDto = READY;
  let answer: (req: MixerAssistRequest) => Promise<MixerAssistAnswer> = (req) =>
    Promise.resolve({ ok: true, trigger: req.trigger, issueKey: req.trigger === 'anomaly' ? req.issue.key : null, source: 'cloud', text: 'Lower the trim.', attempts: [] });
  const api: MixerAssistApi = {
    getMixerAssistStatus: (recheck) => {
      statusCalls.push(recheck);
      return Promise.resolve(status);
    },
    setMixerAssistToken: (token) => {
      tokens.push(token);
      return Promise.resolve({ ok: true, status: { ...status, cloud: { ...status.cloud, tokenSaved: true } } } as SetMixerAssistTokenResult);
    },
    clearMixerAssistToken: () => Promise.resolve({ ...status, cloud: { ...status.cloud, tokenSaved: false } }),
    askMixerAssist: (req) => {
      asked.push(req);
      return answer(req);
    },
    cancelMixerAssist: () => {
      cancels += 1;
      return Promise.resolve({ success: true });
    },
    ...over,
  };
  return {
    api,
    asked,
    tokens,
    statusCalls,
    cancels: () => cancels,
    setStatus: (s: MixerAssistStatusDto) => (status = s),
    setAnswer: (fn: typeof answer) => (answer = fn),
  };
}

function makeStore(f = fakeApi(), context: AssistContextSnapshot = CONTEXT) {
  return createMixerAssistStore({ getApi: () => f.api, context: () => context, labelFor: (issue) => `0${issue.channel} Vox 1` });
}

describe('mixerAssistStore', () => {
  it('refreshStatus loads the status, passing recheck through', async () => {
    const f = fakeApi();
    const store = makeStore(f);
    await store.getState().refreshStatus(true);
    expect(store.getState().status).toEqual(READY);
    expect(f.statusCalls).toEqual([true]);
  });

  it('refreshStatus keeps the last status when the bridge fails', async () => {
    const store = makeStore(fakeApi({ getMixerAssistStatus: () => Promise.reject(new Error('no bridge')) }));
    await store.getState().refreshStatus();
    expect(store.getState().status).toBeNull();
  });

  it('saveToken passes the token through once and keeps only the returned status, never the token', async () => {
    const f = fakeApi();
    const store = makeStore(f);
    await store.getState().saveToken(FAKE_TOKEN);
    expect(f.tokens).toEqual([FAKE_TOKEN]);
    expect(store.getState().status?.cloud.tokenSaved).toBe(true);
    expect(JSON.stringify(store.getState())).not.toContain(FAKE_TOKEN);
  });

  it('a refused save shows the main-process message', async () => {
    const store = makeStore(
      fakeApi({ setMixerAssistToken: () => Promise.resolve({ ok: false, reason: 'no-encryption', message: 'Unlock your keychain, then try again.', status: OFF }) })
    );
    await store.getState().saveToken(FAKE_TOKEN);
    expect(store.getState().tokenMessage).toBe('Unlock your keychain, then try again.');
    expect(JSON.stringify(store.getState())).not.toContain(FAKE_TOKEN);
  });

  it('clearToken updates the status', async () => {
    const store = makeStore();
    await store.getState().clearToken();
    expect(store.getState().status?.cloud.tokenSaved).toBe(false);
    expect(store.getState().tokenMessage).toBeNull();
  });

  it('ask sends a typed question with the visible-card and inspected channel context and records the labelled answer', async () => {
    const f = fakeApi();
    const store = makeStore(f);
    await store.getState().ask('  Why is Vox 1 flagged?  ');
    expect(f.asked).toEqual([
      {
        trigger: 'question',
        question: 'Why is Vox 1 flagged?',
        channels: [{ channel: 2, name: 'Vox 1', faderDb: -5, levelDbfs: 0, gainReductionDb: null, dynamics: { on: false, thresholdDb: -10, ratio: 3 }, diagnosis: 'Input is clipping.' }],
      },
    ]);
    expect(store.getState().answers).toEqual([{ id: 1, source: 'cloud', text: 'Lower the trim.', about: 'Why is Vox 1 flagged?' }]);
    expect(store.getState().pending).toBeNull();
    expect(f.statusCalls).toEqual([undefined]);
  });

  it('ignores a blank question', async () => {
    const f = fakeApi();
    await makeStore(f).getState().ask('   ');
    expect(f.asked).toEqual([]);
  });

  it('shows the pending question while in flight, and Cancel asks main to cancel', async () => {
    let resolve: (a: MixerAssistAnswer) => void = () => undefined;
    const f = fakeApi();
    f.setAnswer(() => new Promise((r) => (resolve = r)));
    const store = makeStore(f);
    const done = store.getState().ask('What next?');
    expect(store.getState().pending).toEqual({ seq: 1, trigger: 'question', label: 'What next?' });
    await store.getState().cancel();
    expect(f.cancels()).toBe(1);
    resolve({ ok: false, trigger: 'question', issueKey: null, reason: 'cancelled', attempts: [{ source: 'cloud', reason: 'cancelled' }] });
    await done;
    expect(store.getState().pending).toBeNull();
    expect(store.getState().lastFailure).toBeNull();
  });

  it('a second question while one is pending keeps the first pending line (and its Cancel) and shows busy', async () => {
    const f = fakeApi();
    let first = true;
    f.setAnswer(() => {
      if (first) {
        first = false;
        return new Promise(() => undefined);
      }
      return Promise.resolve({ ok: false, trigger: 'question', issueKey: null, reason: 'busy', attempts: [] });
    });
    const store = makeStore(f);
    void store.getState().ask('First?');
    await store.getState().ask('Second?');
    expect(store.getState().pending).toEqual({ seq: 1, trigger: 'question', label: 'First?' });
    expect(store.getState().lastFailure?.reason).toBe('busy');
  });

  it('a question that preempts an in-flight narration takes over the pending line and keeps it after the narration is cancelled', async () => {
    const f = fakeApi();
    let release: (a: MixerAssistAnswer) => void = () => undefined;
    f.setAnswer((req) =>
      req.trigger === 'anomaly'
        ? new Promise((r) => (release = r))
        : new Promise(() => undefined)
    );
    const store = makeStore(f);
    const narration = store.getState().narrate(ISSUE);
    void store.getState().ask('Override?');
    expect(store.getState().pending).toEqual({ seq: 2, trigger: 'question', label: 'Override?' });
    release({ ok: false, trigger: 'anomaly', issueKey: 'clipping:2', reason: 'cancelled', attempts: [] });
    await narration;
    expect(store.getState().pending).toEqual({ seq: 2, trigger: 'question', label: 'Override?' });
  });

  it('a failed question keeps its reason and attempts; busy is kept too', async () => {
    const f = fakeApi();
    f.setAnswer(() => Promise.resolve({ ok: false, trigger: 'question', issueKey: null, reason: 'no-binary', attempts: [{ source: 'cloud', reason: 'no-binary' }] }));
    const store = makeStore(f);
    await store.getState().ask('Hi?');
    expect(store.getState().lastFailure).toEqual({ reason: 'no-binary', attempts: [{ source: 'cloud', reason: 'no-binary' }], trigger: 'question' });
    f.setAnswer(() => Promise.resolve({ ok: false, trigger: 'question', issueKey: null, reason: 'busy', attempts: [] }));
    await store.getState().ask('Again?');
    expect(store.getState().lastFailure?.reason).toBe('busy');
  });

  it('a bridge failure clears the pending line without inventing an answer', async () => {
    const store = makeStore(fakeApi({ askMixerAssist: () => Promise.reject(new Error('gone')) }));
    await store.getState().ask('Hi?');
    expect(store.getState().pending).toBeNull();
    expect(store.getState().answers).toEqual([]);
  });

  it('keeps only the newest answers', async () => {
    const store = makeStore();
    for (let i = 0; i < MAX_ASSIST_ANSWERS + 2; i++) await store.getState().ask(`q${i}`);
    expect(store.getState().answers.map((a) => a.about)).toEqual(['q5', 'q4', 'q3', 'q2']);
  });

  it('narrate sends a typed anomaly for the card with its channel and Sermon Quiet state, and labels the answer', async () => {
    const f = fakeApi();
    const store = makeStore(f, { ...CONTEXT, sermonQuiet: true });
    await store.getState().narrate(ISSUE);
    expect(f.asked[0]).toMatchObject({
      trigger: 'anomaly',
      issue: { key: 'clipping:2', kind: 'clipping', severity: 'issue', channel: 2, diagnosis: 'Input is clipping.' },
      sermonQuiet: true,
      channels: [{ channel: 2 }],
    });
    expect(store.getState().answers[0]).toMatchObject({ about: 'About 02 Vox 1', text: 'Lower the trim.' });
  });

  it('narrate is skipped while another request is pending, and a budget refusal stays silent', async () => {
    const f = fakeApi();
    f.setAnswer(() => new Promise(() => undefined));
    const store = makeStore(f);
    void store.getState().ask('Pending?');
    await store.getState().narrate(ISSUE);
    expect(f.asked.map((r) => r.trigger)).toEqual(['question']);
    const g = fakeApi();
    g.setAnswer(() => Promise.resolve({ ok: false, trigger: 'anomaly', issueKey: 'clipping:2', reason: 'cooldown', attempts: [] }));
    const quiet = makeStore(g);
    await quiet.getState().narrate(ISSUE);
    expect(quiet.getState().lastFailure).toBeNull();
    g.setAnswer(() => Promise.resolve({ ok: false, trigger: 'anomaly', issueKey: 'clipping:2', reason: 'endpoint-down', attempts: [{ source: 'local', reason: 'endpoint-down' }] }));
    await quiet.getState().narrate({ ...ISSUE, channel: null, key: 'feedback-risk:room', kind: 'feedback-risk' });
    expect(quiet.getState().lastFailure?.reason).toBe('endpoint-down');
  });

  it('model text never reaches anything but the answers list', async () => {
    const f = fakeApi();
    f.setAnswer(() => Promise.resolve({ ok: true, trigger: 'question', issueKey: null, source: 'cloud', text: 'Set ratio 2:1 on channel 2 now.', attempts: [] }));
    const store = makeStore(f);
    await store.getState().ask('Fix it');
    const { answers, ...rest } = store.getState();
    expect(answers[0].text).toBe('Set ratio 2:1 on channel 2 now.');
    expect(JSON.stringify(rest)).not.toContain('ratio 2:1');
  });
});

describe('bindAssistStatusRefresh', () => {
  function sources() {
    const settings = create<{ settings: Record<string, unknown> | null; dialogOpen: boolean; featureFlags: Record<string, boolean> }>()(() => ({
      settings: { mixerCloudAssistEnabled: false, mixerAttentionCap: 3 },
      dialogOpen: false,
      featureFlags: { mixer: false },
    }));
    const live = create<{ appMode: string }>()(() => ({ appMode: 'analyze' }));
    return { settings, live };
  }

  it('refreshes when an assist setting changes, when Settings opens, when the flags load, and when the Mixer tab opens — and not otherwise', () => {
    const s = sources();
    let refreshes = 0;
    const off = bindAssistStatusRefresh(() => (refreshes += 1), { settings: s.settings, live: s.live } as unknown as StatusRefreshSources);
    s.settings.setState({ settings: { mixerCloudAssistEnabled: false, mixerAttentionCap: 2 } });
    expect(refreshes).toBe(0);
    s.settings.setState({ settings: { mixerCloudAssistEnabled: true, mixerAttentionCap: 2 } });
    expect(refreshes).toBe(1);
    s.settings.setState({ dialogOpen: true });
    expect(refreshes).toBe(2);
    s.settings.setState({ dialogOpen: false });
    s.settings.setState({ featureFlags: { mixer: true } });
    expect(refreshes).toBe(3);
    s.live.setState({ appMode: 'mixer' });
    expect(refreshes).toBe(4);
    s.live.setState({ appMode: 'mixer' });
    s.live.setState({ appMode: 'console' });
    expect(refreshes).toBe(4);
    off();
    s.settings.setState({ settings: { mixerCloudAssistEnabled: false, mixerAttentionCap: 2 } });
    s.live.setState({ appMode: 'mixer' });
    expect(refreshes).toBe(4);
  });
});

describe('bindAssistNarration', () => {
  function mixer(issues: MixerIssue[], over: Record<string, unknown> = {}) {
    return create<Record<string, unknown>>()(() => ({ issues, dismissals: {}, sermonQuiet: false, frozenIssues: null, ...over }));
  }

  function source(m: ReturnType<typeof mixer>, ready = true, open = true): NarrationSource {
    return { mixer: m as unknown as NarrationSource['mixer'], cap: () => 3 as const, ready: () => ready, mixerOpen: () => open, now: () => 1000 };
  }

  it('narrates only an Issue card that newly becomes visible, once, while assist is ready and the Mixer is open', () => {
    const m = mixer([]);
    const narrated: string[] = [];
    bindAssistNarration((issue) => narrated.push(issue.key), source(m));
    m.setState({ issues: [{ ...ISSUE, severity: 'check' }] });
    m.setState({ issues: [ISSUE] });
    m.setState({ issues: [ISSUE] });
    expect(narrated).toEqual(['clipping:2']);
  });

  it('does nothing when assist is not ready, the Mixer is closed, or the link is frozen', () => {
    for (const [ready, open, frozen] of [
      [false, true, null],
      [true, false, null],
      [true, true, [ISSUE]],
    ] as const) {
      const m = mixer([]);
      const narrated: string[] = [];
      bindAssistNarration((issue) => narrated.push(issue.key), source(m, ready, open));
      m.setState({ issues: [ISSUE], frozenIssues: frozen });
      expect(narrated).toEqual([]);
    }
  });

  it('during Sermon Quiet only the visible feedback-risk card can be narrated', () => {
    const ring: MixerIssue = { ...ISSUE, key: 'feedback-risk:room', kind: 'feedback-risk', channel: null };
    const m = mixer([], { sermonQuiet: true });
    const narrated: string[] = [];
    bindAssistNarration((issue) => narrated.push(issue.key), source(m));
    m.setState({ issues: [ISSUE, ring] });
    expect(narrated).toEqual(['feedback-risk:room']);
  });
});

describe('the app-wide assist store wiring', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('refreshes status from the bridge when an assist setting changes', async () => {
    const bridge = createMockSoundBuddy();
    vi.stubGlobal('window', { soundBuddy: bridge.api });
    const before = useSettingsStore.getState().settings;
    useSettingsStore.setState({ settings: { ...(before as NonNullable<typeof before>), mixerLocalAssistModel: 'changed' } as NonNullable<typeof before> });
    await flush();
    expect(bridge.calls.map((c) => c.method)).toContain('getMixerAssistStatus');
    expect(useMixerAssistStore.getState().status).toEqual(DEFAULT_MIXER_ASSIST_STATUS);
  });

  it('narrates a newly visible Issue card with its desk label while the Mixer is open and an assist is ready, using live console context', async () => {
    const bridge = createMockSoundBuddy();
    vi.stubGlobal('window', { soundBuddy: bridge.api });
    useMixerAssistStore.setState({ status: READY, pending: null });
    useLiveCaptureStore.setState({ appMode: 'mixer' });
    useConsoleStore.setState({ liveChannels: [CH], liveMeters: [0, 0.5] });
    useMixerStore.setState({ issues: [ISSUE], frozenIssues: null, dismissals: {}, sermonQuiet: false });
    await flush();
    const asked = bridge.calls.filter((c) => c.method === 'askMixerAssist').map((c) => c.args[0] as MixerAssistRequest);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ trigger: 'anomaly', issue: { key: 'clipping:2' }, channels: [{ channel: 2, name: 'Vox 1' }] });
    useMixerAssistStore.setState({ status: READY });
    useMixerStore.setState({ issues: [{ ...ISSUE, key: 'clipping:room', channel: null }] });
    await flush();
    expect(useMixerAssistStore.getState().pending).toBeNull();
    expect(bridge.calls.filter((c) => c.method === 'askMixerAssist').map((c) => (c.args[0] as MixerAssistRequest).channels)).toEqual([[expect.objectContaining({ channel: 2 })], []]);
    await useMixerAssistStore.getState().ask('What now?');
    const questions = bridge.calls.filter((c) => c.method === 'askMixerAssist').map((c) => c.args[0] as MixerAssistRequest);
    expect(questions.at(-1)).toMatchObject({ trigger: 'question', question: 'What now?' });
    useMixerAssistStore.setState({ status: null });
    useMixerStore.setState({ issues: [{ ...ISSUE, key: 'clipping:9', channel: 9 }] });
    await flush();
    expect(bridge.calls.filter((c) => c.method === 'askMixerAssist')).toHaveLength(3);
  });
});
