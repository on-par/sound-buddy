// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Opt-in local weekly reminder (#268). A volunteer's first analysis is fast,
// but nothing bridges them from "first win" to "come back next Sunday" — this
// module schedules a local OS notification the evening before the user's
// chosen service day. No server, no telemetry, no calendar integration: a
// persisted flag + day index (settings.ts) drive a pure "when does it next
// fire" function and a self-rescheduling main-process timer.
//
// Backlog/no-spam AC: nothing about a missed fire is persisted, and
// `nextReminderAt` always returns a time strictly greater than `now`. A
// launch after a missed Saturday simply arms the *next* Saturday — the "no
// backlog of missed notifications" property holds by construction, not by
// bookkeeping.

import { Notification } from 'electron';
import { logWarn } from './logger';
import { getSettings } from './settings';

/** Fire the reminder at 18:00 local time on the day before the service. */
export const REMINDER_HOUR = 18;
export const DAYS_PER_WEEK = 7;
export const NOTIFICATION_TITLE = 'Time to grade your next service';
export const NOTIFICATION_BODY =
  'Record your service tomorrow, then drop the file into Sound Buddy for a report card.';

/** Pure: epoch-ms of the next reminder, strictly after `nowMs`. */
export function nextReminderAt(nowMs: number, serviceDay: number, hour: number = REMINDER_HOUR): number {
  const reminderDay = (serviceDay + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK;
  const now = new Date(nowMs);
  const delta = (reminderDay - now.getDay() + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + delta, hour, 0, 0, 0);
  if (at.getTime() <= nowMs) at.setDate(at.getDate() + DAYS_PER_WEEK);
  return at.getTime();
}

export interface ReminderDeps {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearTimer: (t: NodeJS.Timeout) => void;
  notify: () => void;
  getSettings: () => { weeklyReminderEnabled: boolean; weeklyReminderServiceDay: number };
}

/** The only Electron-touching function — unit-testable against a mocked `electron`. */
export function showReminderNotification(): void {
  if (!Notification.isSupported()) {
    logWarn(
      'weekly reminder: OS notifications are unavailable — turn the reminder off in Settings ▸ Storage to stop trying.',
    );
    return;
  }
  new Notification({ title: NOTIFICATION_TITLE, body: NOTIFICATION_BODY }).show();
}

const DEFAULT_DEPS: ReminderDeps = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (t) => clearTimeout(t),
  notify: showReminderNotification,
  getSettings,
};

let timer: NodeJS.Timeout | null = null;

/** Cancel any pending reminder timer. Idempotent — safe to call when none is armed. */
export function cancelWeeklyReminder(deps?: Partial<ReminderDeps>): void {
  if (timer) {
    const d = { ...DEFAULT_DEPS, ...deps };
    d.clearTimer(timer);
    timer = null;
  }
}

/**
 * (Re)arm the reminder from current settings. Cancels any existing timer first,
 * then schedules only when the setting is on. Self-rescheduling: after firing it
 * computes the next occurrence and arms again.
 */
export function scheduleWeeklyReminder(deps?: Partial<ReminderDeps>): void {
  const d = { ...DEFAULT_DEPS, ...deps };
  cancelWeeklyReminder(d);
  const s = d.getSettings();
  if (!s.weeklyReminderEnabled) return;
  const at = nextReminderAt(d.now(), s.weeklyReminderServiceDay);
  // A week (604,800,000ms) is well under setTimeout's 2^31-1 ceiling, so no
  // chunking is needed.
  timer = d.setTimer(() => {
    d.notify();
    scheduleWeeklyReminder(deps);
  }, at - d.now());
}
