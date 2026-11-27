// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type {
  ConsoleChannelStateDto,
  MixerAssistAttempt,
  MixerAssistChannelContext,
  MixerAssistReason,
  MixerAssistSource,
  MixerAssistStatusDto,
  MixerAssistTrigger,
} from '../../../electron/ipc/api';
import type { MixerIssue } from './attention';
import { linearToDbfs } from './rules';

export const MAX_QUESTION_CHANNELS = 8;
export const MAX_ASSIST_ANSWERS = 4;

export const COMPOSER_OFF_PLACEHOLDER = 'Rules only. Turn on an assist in Settings to ask questions.';
export const COMPOSER_UNAVAILABLE_PLACEHOLDER = 'Rules only until an assist is ready';
export const COMPOSER_READY_PLACEHOLDER = 'Ask about the mix…';
export const RULES_FALLBACK_LINE = 'Using rules for now. The Mixer works the same without an assist.';
export const BUSY_LINE = 'Still answering the last question. Wait for it, or choose Cancel.';
export const ASSIST_CLOUD_SOURCE_LABEL = 'Cloud · Claude Code';
export const ASSIST_LOCAL_SOURCE_LABEL = 'Local';
export const ASSIST_LOCAL_FALLBACK_LABEL = 'Local model';
export const ASSIST_CHIPS = ['What needs attention first?', 'Explain the top card in plain words', 'What should I check on the inspected channel?'];

export const FALLBACK_COPY: Record<MixerAssistSource, Partial<Record<MixerAssistReason, string>>> = {
  cloud: {
    'no-binary': "Claude Code isn't installed. Install it, or set its path in Settings ▸ Console.",
    'no-token': "The Claude Code token isn't set. Paste it in Settings ▸ Console.",
    'no-encryption': "This Mac can't encrypt the Claude Code token, so Cloud assist is off. Unlock your login keychain, then choose Check again.",
    'spawn-error': "Claude Code couldn't start. Check its path in Settings ▸ Console.",
    exit: 'Claude Code stopped with an error. Run claude in Terminal to check your login, then ask again.',
    timeout: 'Claude Code took longer than 45 seconds. Ask again.',
    overflow: 'Claude Code sent too long an answer, so it was dropped. Ask a narrower question.',
  },
  local: {
    'no-endpoint': 'No Local endpoint URL is set. Add it in Settings ▸ Console.',
    'bad-endpoint': 'The Local endpoint must be on this Mac or your local network (127.x, 10.x, 172.16–31.x or 192.168.x). Fix it in Settings ▸ Console.',
    'no-model': 'No Local model name is set. Add it in Settings ▸ Console.',
    'endpoint-down': "The Local model server isn't answering. Start it, then choose Check again.",
    'endpoint-status': 'The Local model server returned an error. Check the model name, then ask again.',
    'bad-response': 'The Local model server sent a reply that is not a chat answer. Check that it serves /chat/completions.',
    timeout: 'The Local model took longer than 45 seconds. Ask again.',
    overflow: 'The Local model sent too long an answer, so it was dropped. Ask a narrower question.',
  },
};

const UNAVAILABLE_FAILURES: ReadonlySet<MixerAssistReason> = new Set([
  'no-binary',
  'no-token',
  'no-encryption',
  'spawn-error',
  'no-endpoint',
  'bad-endpoint',
  'no-model',
  'endpoint-down',
  'endpoint-status',
]);
const SILENT_FAILURES: ReadonlySet<MixerAssistReason> = new Set(['cancelled', 'busy', 'disabled', 'cooldown', 'hourly-cap', 'not-issue', 'sermon-quiet']);
const SOURCE_NAMES: Record<MixerAssistSource, string> = { cloud: 'Cloud', local: 'Local' };

export type RuntimeState = 'off' | 'ready' | 'unavailable';

export interface RuntimeHealth {
  state: RuntimeState;
  reasons: MixerAssistReason[];
}

export interface AssistAnswer {
  id: number;
  source: MixerAssistSource;
  text: string;
  about: string;
}

export interface AssistPending {
  trigger: MixerAssistTrigger;
  label: string;
}

export interface AssistFailure {
  reason: MixerAssistReason;
  attempts: MixerAssistAttempt[];
  trigger: MixerAssistTrigger;
}

export interface AssistRailInput {
  status: MixerAssistStatusDto | null;
  pending: AssistPending | null;
  answers: readonly AssistAnswer[];
  lastFailure: AssistFailure | null;
  localModel: string;
}

export interface RailAssistView {
  mode: RuntimeState;
  composerEnabled: boolean;
  composerPlaceholder: string;
  chips: string[];
  pending: string | null;
  fallbackLines: Array<{ key: string; text: string }>;
  busyLine: string | null;
  answers: Array<{ id: number; sourceLabel: string; text: string; about: string }>;
}

function health(enabled: boolean, staticReasons: MixerAssistReason[], lastFailure: MixerAssistReason | null): RuntimeHealth {
  if (!enabled) return { state: 'off', reasons: [] };
  const reasons = lastFailure === null ? staticReasons : [...staticReasons, lastFailure];
  const ready = staticReasons.length === 0 && (lastFailure === null || !UNAVAILABLE_FAILURES.has(lastFailure));
  return { state: ready ? 'ready' : 'unavailable', reasons };
}

export function runtimeHealth(status: MixerAssistStatusDto): Record<MixerAssistSource, RuntimeHealth> {
  const c = status.cloud;
  const l = status.local;
  const cloudStatic: MixerAssistReason[] = [];
  if (!c.binaryFound) cloudStatic.push('no-binary');
  if (c.encryptionAvailable === false) cloudStatic.push('no-encryption');
  if (!c.tokenSaved) cloudStatic.push('no-token');
  const localStatic: MixerAssistReason[] = [];
  if (l.endpoint === 'unset') localStatic.push('no-endpoint');
  if (l.endpoint === 'invalid') localStatic.push('bad-endpoint');
  if (!l.modelSet) localStatic.push('no-model');
  return { cloud: health(c.enabled, cloudStatic, c.lastFailure), local: health(l.enabled, localStatic, l.lastFailure) };
}

function copyFor(source: MixerAssistSource, reason: MixerAssistReason): string {
  return FALLBACK_COPY[source][reason] ?? `${SOURCE_NAMES[source]} assist couldn't answer. Ask again.`;
}

function sourceLabel(source: MixerAssistSource, localModel: string): string {
  if (source === 'cloud') return ASSIST_CLOUD_SOURCE_LABEL;
  return localModel === '' ? ASSIST_LOCAL_FALLBACK_LABEL : `${ASSIST_LOCAL_SOURCE_LABEL} · ${localModel}`;
}

function pendingText(pending: AssistPending | null): string | null {
  if (pending === null) return null;
  return pending.trigger === 'question' ? `Asking: ${pending.label}` : `Explaining the new card on ${pending.label}…`;
}

export function railAssistView(input: AssistRailInput): RailAssistView {
  const answers = input.answers.map((a) => ({ id: a.id, sourceLabel: sourceLabel(a.source, input.localModel), text: a.text, about: a.about }));
  const busyLine = input.lastFailure?.reason === 'busy' ? BUSY_LINE : null;
  const pending = pendingText(input.pending);
  if (input.status === null || (!input.status.cloud.enabled && !input.status.local.enabled)) {
    return { mode: 'off', composerEnabled: false, composerPlaceholder: COMPOSER_OFF_PLACEHOLDER, chips: [], pending, fallbackLines: [], busyLine, answers };
  }
  const h = runtimeHealth(input.status);
  const ready = h.cloud.state === 'ready' || h.local.state === 'ready';
  const lines: Array<{ key: string; text: string }> = [];
  const seen = new Set<string>();
  const add = (source: MixerAssistSource, reason: MixerAssistReason) => {
    const key = `${source}:${reason}`;
    if (SILENT_FAILURES.has(reason) || seen.has(key)) return;
    seen.add(key);
    lines.push({ key, text: copyFor(source, reason) });
  };
  for (const source of ['cloud', 'local'] as const) for (const reason of h[source].reasons) add(source, reason);
  for (const attempt of input.lastFailure?.attempts ?? []) add(attempt.source, attempt.reason);
  if (!ready) lines.push({ key: 'rules', text: RULES_FALLBACK_LINE });
  return {
    mode: ready ? 'ready' : 'unavailable',
    composerEnabled: ready,
    composerPlaceholder: ready ? COMPOSER_READY_PLACEHOLDER : COMPOSER_UNAVAILABLE_PLACEHOLDER,
    chips: ready ? ASSIST_CHIPS : [],
    pending,
    fallbackLines: lines,
    busyLine,
    answers,
  };
}

export interface SettingsStatusLines {
  cloud: string;
  local: string;
  token: string;
  binary: string;
}

export function settingsStatusLines(status: MixerAssistStatusDto | null, endpoint: string): SettingsStatusLines {
  if (status === null) return { cloud: 'Checking Cloud assist…', local: 'Checking Local assist…', token: 'Not set', binary: 'Checking…' };
  const h = runtimeHealth(status);
  const line = (source: MixerAssistSource, readyText: string) => {
    const r = h[source];
    if (r.state === 'off') return `${SOURCE_NAMES[source]} assist is off.`;
    if (r.state === 'ready') return `${SOURCE_NAMES[source]} assist is ready: ${readyText}.`;
    return `${SOURCE_NAMES[source]} assist can't run yet. ${r.reasons.map((reason) => copyFor(source, reason)).join(' ')}`;
  };
  return {
    cloud: line('cloud', 'Claude Code found, token saved'),
    local: line('local', endpoint),
    token: status.cloud.tokenSaved ? 'Token saved' : 'Not set',
    binary: status.cloud.binaryFound ? 'Claude Code found' : 'Claude Code not found',
  };
}

export function assistChannels(
  indexes: readonly number[],
  channels: readonly ConsoleChannelStateDto[],
  meters: readonly number[],
  issues: readonly MixerIssue[]
): MixerAssistChannelContext[] {
  return indexes.flatMap((index) => {
    const ch = channels.find((c) => c.index === index);
    if (ch === undefined) return [];
    const meter = meters[index - 1];
    const level = meter === undefined ? -Infinity : linearToDbfs(meter);
    return [
      {
        channel: index,
        name: ch.name,
        faderDb: Number.isFinite(ch.faderDb) ? ch.faderDb : null,
        levelDbfs: Number.isFinite(level) ? level : null,
        gainReductionDb: null,
        dynamics: { on: ch.dynamics.on, thresholdDb: ch.dynamics.thr, ratio: ch.dynamics.ratio },
        diagnosis: issues.find((i) => i.channel === index)?.diagnosis ?? null,
      },
    ];
  });
}

export function questionChannelIndexes(visible: readonly MixerIssue[], inspected: number | null): number[] {
  const indexes = [...visible.map((i) => i.channel), inspected].filter((c): c is number => c !== null);
  return [...new Set(indexes)].slice(0, MAX_QUESTION_CHANNELS);
}

export function newlyVisibleIssues(previousKeys: ReadonlySet<string>, visible: readonly MixerIssue[]): MixerIssue[] {
  return visible.filter((i) => i.severity === 'issue' && !previousKeys.has(i.key));
}
