// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import type {
  AppSettings,
  ConsoleChannelStateDto,
  MixerAssistAnswer,
  MixerAssistApi,
  MixerAssistRequest,
  MixerAssistStatusDto,
  MixerAssistTrigger,
} from '../../../electron/ipc/api';
import { DEFAULT_MIXER_ATTENTION_CAP, type MixerAttentionCap } from '../../../electron/ipc/api';
import { selectAttention, type MixerDismissals, type MixerIssue } from '../mixer/attention';
import {
  MAX_ASSIST_ANSWERS,
  assistChannels,
  newlyVisibleIssues,
  questionChannelIndexes,
  runtimeHealth,
  type AssistAnswer,
  type AssistFailure,
} from '../mixer/assist-view';
import { channelLabel } from '../mixer/view-model';
import { useConsoleStore } from './consoleStore';
import { useMixerStore } from './mixerStore';
import { useSettingsStore } from './settingsStore';
import { useLiveCaptureStore } from './liveCaptureStore';

const ASSIST_SETTING_KEYS = [
  'mixerCloudAssistEnabled',
  'mixerLocalAssistEnabled',
  'mixerCloudAssistBinaryPath',
  'mixerLocalAssistEndpoint',
  'mixerLocalAssistModel',
] as const;
const QUIET_ANOMALY_REASONS = new Set(['cancelled', 'busy', 'disabled', 'cooldown', 'hourly-cap', 'not-issue', 'sermon-quiet']);
const ROOM_LABEL = 'the room';

export interface AssistContextSnapshot {
  channels: readonly ConsoleChannelStateDto[];
  meters: readonly number[];
  visible: readonly MixerIssue[];
  issues: readonly MixerIssue[];
  inspected: number | null;
  sermonQuiet: boolean;
}

export interface MixerAssistPending {
  seq: number;
  trigger: MixerAssistTrigger;
  label: string;
}

export interface MixerAssistState {
  status: MixerAssistStatusDto | null;
  answers: AssistAnswer[];
  pending: MixerAssistPending | null;
  lastFailure: AssistFailure | null;
  tokenMessage: string | null;
  seq: number;
  refreshStatus(recheck?: boolean): Promise<void>;
  saveToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
  ask(question: string): Promise<void>;
  narrate(issue: MixerIssue): Promise<void>;
  cancel(): Promise<void>;
}

export interface MixerAssistStoreDeps {
  getApi(): MixerAssistApi;
  context(): AssistContextSnapshot;
  labelFor(issue: MixerIssue): string;
}

export function createMixerAssistStore(deps: MixerAssistStoreDeps): UseBoundStore<StoreApi<MixerAssistState>> {
  return create<MixerAssistState>()((set, get) => {
    async function send(request: MixerAssistRequest, label: string, about: string): Promise<void> {
      const seq = get().seq + 1;
      const held = get().pending;
      set({ seq, pending: held?.trigger === 'question' ? held : { seq, trigger: request.trigger, label } });
      let answer: MixerAssistAnswer | null;
      try {
        answer = await deps.getApi().askMixerAssist(request);
      } catch {
        answer = null;
      }
      if (get().pending?.seq === seq) set({ pending: null });
      if (answer?.ok) {
        set({ answers: [{ id: seq, source: answer.source, text: answer.text, about }, ...get().answers].slice(0, MAX_ASSIST_ANSWERS), lastFailure: null });
      } else if (answer !== null) {
        const quiet = answer.reason === 'cancelled' || (answer.trigger === 'anomaly' && QUIET_ANOMALY_REASONS.has(answer.reason));
        if (!quiet) set({ lastFailure: { reason: answer.reason, attempts: answer.attempts, trigger: answer.trigger } });
        else if (answer.reason === 'cancelled') set({ lastFailure: null });
      }
      await get().refreshStatus();
    }

    return {
      status: null,
      answers: [],
      pending: null,
      lastFailure: null,
      tokenMessage: null,
      seq: 0,
      async refreshStatus(recheck) {
        try {
          set({ status: await deps.getApi().getMixerAssistStatus(recheck) });
        } catch {
          set({ status: get().status });
        }
      },
      async saveToken(token) {
        const result = await deps.getApi().setMixerAssistToken(token);
        set({ status: result.status, tokenMessage: result.ok ? null : result.message });
      },
      async clearToken() {
        set({ status: await deps.getApi().clearMixerAssistToken(), tokenMessage: null });
      },
      async ask(question) {
        const trimmed = question.trim();
        if (trimmed === '') return;
        const ctx = deps.context();
        const channels = assistChannels(questionChannelIndexes(ctx.visible, ctx.inspected), ctx.channels, ctx.meters, ctx.issues);
        await send({ trigger: 'question', question: trimmed, channels }, trimmed, trimmed);
      },
      async narrate(issue) {
        if (get().pending !== null) return;
        const ctx = deps.context();
        const label = deps.labelFor(issue);
        const channels = assistChannels(issue.channel === null ? [] : [issue.channel], ctx.channels, ctx.meters, ctx.issues);
        await send(
          {
            trigger: 'anomaly',
            issue: { key: issue.key, kind: issue.kind, severity: issue.severity, channel: issue.channel, diagnosis: issue.diagnosis },
            sermonQuiet: ctx.sermonQuiet,
            channels,
          },
          label,
          `About ${label}`
        );
      },
      async cancel() {
        await deps.getApi().cancelMixerAssist();
      },
    };
  });
}

interface SubscribableStore<T> {
  getState(): T;
  subscribe(listener: (state: T, previous: T) => void): () => void;
}

export interface StatusRefreshSources {
  settings: SubscribableStore<{ settings: AppSettings | null; dialogOpen: boolean; featureFlags: { mixer: boolean } }>;
  live: SubscribableStore<{ appMode: string }>;
}

export function bindAssistStatusRefresh(refresh: () => void, sources: StatusRefreshSources): () => void {
  const mixerOn = () => sources.settings.getState().featureFlags.mixer;
  const offSettings = sources.settings.subscribe((next, prev) => {
    const assistChanged = ASSIST_SETTING_KEYS.some((key) => next.settings?.[key] !== prev.settings?.[key]);
    const opened = next.dialogOpen && !prev.dialogOpen;
    const flagChanged = next.featureFlags.mixer !== prev.featureFlags.mixer;
    if (mixerOn() && (assistChanged || opened || flagChanged)) refresh();
  });
  const offLive = sources.live.subscribe((next, prev) => {
    if (mixerOn() && next.appMode === 'mixer' && prev.appMode !== 'mixer') refresh();
  });
  return () => {
    offSettings();
    offLive();
  };
}

export interface NarrationSource {
  mixer: SubscribableStore<{ issues: MixerIssue[]; dismissals: MixerDismissals; sermonQuiet: boolean; frozenIssues: MixerIssue[] | null }>;
  cap(): MixerAttentionCap;
  ready(): boolean;
  mixerOpen(): boolean;
  now(): number;
}

export function bindAssistNarration(narrate: (issue: MixerIssue) => void, source: NarrationSource): () => void {
  let previous = new Set<string>();
  return source.mixer.subscribe((state) => {
    if (state.frozenIssues !== null) return;
    const visible = selectAttention({ issues: state.issues, now: source.now(), cap: source.cap(), dismissals: state.dismissals, sermonQuiet: state.sermonQuiet }).visible;
    const fresh = newlyVisibleIssues(previous, visible);
    previous = new Set(visible.filter((i) => i.severity === 'issue').map((i) => i.key));
    if (fresh.length > 0 && source.ready() && source.mixerOpen()) narrate(fresh[0]);
  });
}

function cap(): MixerAttentionCap {
  return useSettingsStore.getState().settings?.mixerAttentionCap ?? DEFAULT_MIXER_ATTENTION_CAP;
}

function liveContext(): AssistContextSnapshot {
  const con = useConsoleStore.getState();
  const mx = useMixerStore.getState();
  const visible = selectAttention({ issues: mx.issues, now: Date.now(), cap: cap(), dismissals: mx.dismissals, sermonQuiet: mx.sermonQuiet }).visible;
  return { channels: con.liveChannels, meters: con.liveMeters, visible, issues: mx.issues, inspected: mx.inspected, sermonQuiet: mx.sermonQuiet };
}

export const useMixerAssistStore = createMixerAssistStore({
  getApi: getSoundBuddy,
  context: liveContext,
  labelFor: (issue) => (issue.channel === null ? ROOM_LABEL : channelLabel(useConsoleStore.getState().liveChannels, issue.channel)),
});

bindAssistStatusRefresh(() => void useMixerAssistStore.getState().refreshStatus(), { settings: useSettingsStore, live: useLiveCaptureStore });
bindAssistNarration((issue) => void useMixerAssistStore.getState().narrate(issue), {
  mixer: useMixerStore,
  cap,
  ready: () => {
    const status = useMixerAssistStore.getState().status;
    if (status === null) return false;
    const h = runtimeHealth(status);
    return h.cloud.state === 'ready' || h.local.state === 'ready';
  },
  mixerOpen: () => useLiveCaptureStore.getState().appMode === 'mixer',
  now: Date.now,
});
