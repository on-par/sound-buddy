// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Single source of truth for Settings row help copy (#1007, epic #999 story
// 1). The Settings redesign collapses the per-row `.ai-dialog-note`
// paragraphs into a single footer help strip, but the guidance itself must
// survive: SettingsPanel.tsx renders both the always-in-DOM, visually-hidden
// note element and the footer strip from this same table, so the two
// surfaces can never drift apart. Any future Settings row that needs
// guidance adds an entry here — it does not add a prose paragraph to the
// JSX.

import type { SettingsControl, SettingsSection } from './SettingsPanel';

export interface SettingsHelpEntry {
  readonly control: SettingsControl;
  readonly noteId: string;
  readonly text: string;
}

export interface SettingsHelpHandlers {
  readonly onMouseEnter: () => void;
  readonly onMouseLeave: () => void;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
}

export const SETTINGS_HELP_ENTRIES: readonly SettingsHelpEntry[] = [
  {
    control: 'gradingProfile',
    noteId: 'grading-profile-note',
    text: "Casual / volunteer grades against today's thresholds. Broadcast-ready tightens every level, dynamic-range, and balance target — the same recording may grade lower. The report card always shows which profile graded it.",
  },
  {
    control: 'weeklyReminder',
    noteId: 'weekly-reminder-note',
    text: 'Off unless you turn it on. Sound Buddy shows a local notification on this Mac the evening before your service day, reminding you to record and grade it. Nothing leaves your machine — no account, no email, no server.',
  },
  {
    control: 'shareChurchName',
    noteId: 'share-church-name-note',
    text: 'Optional. Leave blank (default) and shared images contain no identifying information.',
  },
  {
    control: 'storageDir',
    noteId: 'storage-note',
    text: "Record and analyze as much as you want — no limits on any tier. New recordings are saved here; anything you've already recorded stays in its current folder.",
  },
  {
    control: 'usageSignal',
    noteId: 'usage-signal-note',
    text: 'Off unless you turn it on. When enabled, Sound Buddy sends only anonymous usage counts — which features get used (app opened, analysis run, report viewed or exported, feedback sent) plus app version, macOS version, platform, an anonymous install/session id, and the hour it happened — never audio, recordings, church or file names, file paths, prompts, or report text. Your audio never leaves your machine.',
  },
  {
    control: 'crashReporting',
    noteId: 'crash-reporting-note',
    text: 'Off unless you turn it on. When enabled, a crash sends only: app version, macOS version, the error message and stack trace (emails, license keys, and folder paths removed — file names are reduced to their base name), which screen you were on, and the names of recent app actions. Never recordings, audio, full file paths, or anything you typed.',
  },
  {
    control: 'liveAdjustments',
    noteId: 'live-adjustments-note',
    text: 'Off unless you turn it on. An early, experimental area for mix suggestions while you monitor or record in Live Capture. Nothing is analyzed or sent anywhere — turn this off anytime to hide it.',
  },
  {
    control: 'consoleNetworkConsent',
    noteId: 'console-network-consent-note',
    text: 'Granted only when you explicitly allow it from the prompt shown the first time a live-console feature is turned on — there is no toggle here to turn it on. Revoking takes effect immediately and blocks further console reads until you grant it again.',
  },
];

export const SETTINGS_SECTION_HELP: Record<SettingsSection, string> = {
  general: 'Grading strictness, weekly reminders, and what appears on shared images.',
  audio: 'Rig, input device, measurement source, and meter cadence for live capture.',
  console: 'Read-only network access to your Midas M32R console.',
  storage: 'Where recordings and reports are saved on this Mac.',
  privacy: 'What Sound Buddy sends off this machine. Everything here is off unless you turn it on.',
  labs: 'Experimental features. Off by default — turn any of them off again anytime.',
  about: 'Version and license information for this copy of Sound Buddy.',
};

export function settingsHelpNoteId(control: SettingsControl): string {
  const entry = SETTINGS_HELP_ENTRIES.find((e) => e.control === control);
  if (!entry) throw new Error(`No Settings help entry for ${control} — add one to SETTINGS_HELP_ENTRIES`);
  return entry.noteId;
}

export function resolveSettingsHelp(active: SettingsControl | null, section: SettingsSection): string {
  const entry = active ? SETTINGS_HELP_ENTRIES.find((e) => e.control === active) : undefined;
  return entry ? entry.text : SETTINGS_SECTION_HELP[section];
}

export function settingsHelpHandlers(
  control: SettingsControl,
  setActive: (control: SettingsControl | null) => void
): SettingsHelpHandlers {
  const activate = () => setActive(control);
  const clear = () => setActive(null);
  // onFocus/onBlur are deferred a tick: React flushes focus/blur as discrete
  // (synchronous) events, so calling setActive directly re-renders the
  // control mid-click, before the browser's own native checked-toggle has
  // landed — Playwright (and real users) then see "clicking the checkbox
  // did not change its state". Deferring past the click's native event
  // dispatch avoids the race; onMouseEnter/onMouseLeave aren't part of that
  // dispatch sequence and don't need it.
  return {
    onMouseEnter: activate,
    onMouseLeave: clear,
    onFocus: () => setTimeout(activate, 0),
    onBlur: () => setTimeout(clear, 0),
  };
}
