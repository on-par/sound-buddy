// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type { MixerAssistChannelContext, MixerAssistDynamicsContext, MixerAssistIssueContext, MixerAssistRequest } from '../ipc/api';

export const MAX_PROMPT_CHARS = 6000;
export const MAX_QUESTION_CHARS = 500;
export const MAX_CONTEXT_CHANNELS = 8;
export const MAX_CHANNEL_NAME_CHARS = 16;
export const MAX_DIAGNOSIS_CHARS = 240;
export const MAX_ISSUE_KEY_CHARS = 64;
export const MAX_ANSWER_CHARS = 2000;
const MAX_CHANNEL_NUMBER = 64;
const LEVEL_RANGE_DB = { min: -200, max: 20 } as const;
const GR_RANGE_DB = { min: 0, max: 100 } as const;
const THRESHOLD_RANGE_DB = { min: -100, max: 20 } as const;
const RATIO_RANGE = { min: 1, max: 100 } as const;
const CHANNEL_DIGITS = 2;
const ISSUE_KINDS: ReadonlySet<string> = new Set(['clipping', 'over-compression', 'feedback-risk']);
const SEVERITIES: ReadonlySet<string> = new Set(['issue', 'check', 'info']);
const SEVERITY_LABELS: Record<MixerAssistIssueContext['severity'], string> = { issue: 'Issue', check: 'Check', info: 'Info' };
const ELLIPSIS = '…';
const FIRST_PRINTABLE_CODE = 0x20;
const DELETE_CODE = 0x7f;

export const ASSIST_SYSTEM_PROMPT = [
  'You are helping a volunteer church sound engineer during a live service.',
  'You only see the console readings below. You cannot hear the room and you cannot change the console.',
  'Answer in plain text with no markdown, in at most four short sentences.',
  'Say what to check or try on the desk. Never claim that a change was made.',
].join(' ');

function cleanText(v: unknown, maxLen: number): string | null {
  if (typeof v !== 'string') return null;
  const printable = [...v.replace(/[\r\n\t]/g, ' ')]
    .filter((ch) => ch.charCodeAt(0) >= FIRST_PRINTABLE_CODE && ch.charCodeAt(0) !== DELETE_CODE)
    .join('');
  const cleaned = printable.replace(/\s+/g, ' ').trim();
  return cleaned === '' ? null : cleaned.slice(0, maxLen);
}

function inRange(v: unknown, range: { min: number; max: number }): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= range.min && v <= range.max ? v : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function channelNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_CHANNEL_NUMBER ? v : null;
}

function parseDynamics(v: unknown): MixerAssistDynamicsContext | null {
  if (!isRecord(v) || typeof v.on !== 'boolean') return null;
  const thresholdDb = inRange(v.thresholdDb, THRESHOLD_RANGE_DB);
  const ratio = inRange(v.ratio, RATIO_RANGE);
  return thresholdDb === null || ratio === null ? null : { on: v.on, thresholdDb, ratio };
}

function parseChannel(v: unknown): MixerAssistChannelContext | null {
  if (!isRecord(v)) return null;
  const channel = channelNumber(v.channel);
  if (channel === null) return null;
  return {
    channel,
    name: cleanText(v.name, MAX_CHANNEL_NAME_CHARS) ?? '',
    faderDb: inRange(v.faderDb, LEVEL_RANGE_DB),
    levelDbfs: inRange(v.levelDbfs, LEVEL_RANGE_DB),
    gainReductionDb: inRange(v.gainReductionDb, GR_RANGE_DB),
    dynamics: parseDynamics(v.dynamics),
    diagnosis: cleanText(v.diagnosis, MAX_DIAGNOSIS_CHARS),
  };
}

function parseChannels(v: unknown): MixerAssistChannelContext[] {
  if (!Array.isArray(v)) return [];
  return v
    .map(parseChannel)
    .filter((c): c is MixerAssistChannelContext => c !== null)
    .slice(0, MAX_CONTEXT_CHANNELS);
}

function parseIssue(v: unknown): MixerAssistIssueContext | null {
  if (!isRecord(v) || typeof v.kind !== 'string' || !ISSUE_KINDS.has(v.kind) || typeof v.severity !== 'string' || !SEVERITIES.has(v.severity)) {
    return null;
  }
  return {
    key: cleanText(v.key, MAX_ISSUE_KEY_CHARS) ?? '',
    kind: v.kind as MixerAssistIssueContext['kind'],
    severity: v.severity as MixerAssistIssueContext['severity'],
    channel: channelNumber(v.channel),
    diagnosis: cleanText(v.diagnosis, MAX_DIAGNOSIS_CHARS) ?? '',
  };
}

export function parseAssistRequest(raw: unknown): MixerAssistRequest | null {
  if (!isRecord(raw)) return null;
  const channels = parseChannels(raw.channels);
  if (raw.trigger === 'question') {
    const question = cleanText(raw.question, MAX_QUESTION_CHARS);
    return question === null ? null : { trigger: 'question', question, channels };
  }
  if (raw.trigger === 'anomaly') {
    const issue = parseIssue(raw.issue);
    return issue === null ? null : { trigger: 'anomaly', issue, sermonQuiet: raw.sermonQuiet === true, channels };
  }
  return null;
}

function channelTag(channel: number): string {
  return `Ch ${String(channel).padStart(CHANNEL_DIGITS, '0')}`;
}

function db(v: number | null, unit: string): string {
  return v === null ? 'unavailable' : `${v.toFixed(1)} ${unit}`;
}

function dynamicsText(d: MixerAssistDynamicsContext | null): string {
  if (d === null) return 'dynamics not read';
  if (!d.on) return 'compressor off';
  return `compressor on, threshold ${d.thresholdDb.toFixed(1)} dB, ratio ${d.ratio.toFixed(1)}:1`;
}

function channelLine(c: MixerAssistChannelContext): string {
  const reading = [
    `fader ${db(c.faderDb, 'dB')}`,
    `input peak ${db(c.levelDbfs, 'dBFS')}`,
    `compressor gain reduction ${db(c.gainReductionDb, 'dB')}`,
    dynamicsText(c.dynamics),
  ].join(', ');
  const note = c.diagnosis === null ? '' : ` Rule note: ${c.diagnosis}`;
  return `- ${channelTag(c.channel)} "${c.name}": ${reading}.${note}`;
}

export function buildPrompt(request: MixerAssistRequest): { system: string; user: string; combined: string } {
  const lines: string[] = ['Console readings (read only, from an X32/M32):'];
  lines.push(...(request.channels.length === 0 ? ['No channel readings were included.'] : request.channels.map(channelLine)));
  if (request.trigger === 'anomaly') {
    const where = request.issue.channel === null ? 'in the room' : `on ${channelTag(request.issue.channel)}`;
    lines.push(`Rule alert (${SEVERITY_LABELS[request.issue.severity]}): ${request.issue.kind} ${where} — ${request.issue.diagnosis}`);
    lines.push('Explain in plain words what this likely means and the first thing to check.');
  } else {
    lines.push(`Operator question: ${request.question}`);
  }
  const user = lines.join('\n');
  const combined = `${ASSIST_SYSTEM_PROMPT}\n\n${user}`.slice(0, MAX_PROMPT_CHARS);
  return { system: ASSIST_SYSTEM_PROMPT, user, combined };
}

export function capAnswer(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_ANSWER_CHARS ? `${trimmed.slice(0, MAX_ANSWER_CHARS)}${ELLIPSIS}` : trimmed;
}
