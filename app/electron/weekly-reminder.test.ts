import { describe, it, expect, vi, beforeEach } from 'vitest';

const notificationState = vi.hoisted(() => ({
  isSupported: true,
  instances: [] as Array<{ title: string; body: string; show: () => void }>,
}));

vi.mock('electron', () => ({
  Notification: Object.assign(
    class {
      title: string;
      body: string;
      show = vi.fn();
      constructor(opts: { title: string; body: string }) {
        this.title = opts.title;
        this.body = opts.body;
        notificationState.instances.push(this);
      }
    },
    { isSupported: () => notificationState.isSupported },
  ),
}));

vi.mock('./logger', () => ({ logWarn: vi.fn() }));
vi.mock('./settings', () => ({ getSettings: vi.fn() }));

import {
  nextReminderAt,
  scheduleWeeklyReminder,
  cancelWeeklyReminder,
  showReminderNotification,
  REMINDER_HOUR,
  DAYS_PER_WEEK,
  NOTIFICATION_TITLE,
  NOTIFICATION_BODY,
  type ReminderDeps,
} from './weekly-reminder';
import { logWarn } from './logger';
import { getSettings } from './settings';

beforeEach(() => {
  notificationState.isSupported = true;
  notificationState.instances = [];
  vi.mocked(logWarn).mockClear();
  // The module keeps a single top-level timer handle across tests in this
  // file — clear any timer left armed by the previous test so its state
  // can't leak into the next one's assertions.
  cancelWeeklyReminder({ clearTimer: () => {} });
});

describe('nextReminderAt', () => {
  it('Sunday service (0) from a Wednesday resolves to the next Saturday 18:00 local', () => {
    // Wed 2026-07-15
    const wed = new Date(2026, 6, 15, 9, 0, 0, 0).getTime();
    const expected = new Date(2026, 6, 18, 18, 0, 0, 0).getTime();
    expect(nextReminderAt(wed, 0)).toBe(expected);
  });

  it('Sunday service from a Saturday at 17:00 fires that same Saturday at 18:00', () => {
    const sat1700 = new Date(2026, 6, 18, 17, 0, 0, 0).getTime();
    const expected = new Date(2026, 6, 18, 18, 0, 0, 0).getTime();
    expect(nextReminderAt(sat1700, 0)).toBe(expected);
  });

  it('Sunday service from a Saturday at 18:00 exactly rolls to +7 days (strictly-after boundary)', () => {
    const sat1800 = new Date(2026, 6, 18, 18, 0, 0, 0).getTime();
    const expected = new Date(2026, 6, 25, 18, 0, 0, 0).getTime();
    expect(nextReminderAt(sat1800, 0)).toBe(expected);
  });

  it('Sunday service from a Saturday at 19:00 resolves to the next Saturday, 7 days out', () => {
    const sat1900 = new Date(2026, 6, 18, 19, 0, 0, 0).getTime();
    const expected = new Date(2026, 6, 25, 18, 0, 0, 0).getTime();
    expect(nextReminderAt(sat1900, 0)).toBe(expected);
  });

  it('Monday service (1) resolves to a Sunday reminder', () => {
    // Wed 2026-07-15 -> next Sunday is 2026-07-19
    const wed = new Date(2026, 6, 15, 9, 0, 0, 0).getTime();
    const expected = new Date(2026, 6, 19, 18, 0, 0, 0).getTime();
    expect(nextReminderAt(wed, 1)).toBe(expected);
  });

  it('is always strictly after nowMs for every service-day value (no backlog of missed notifications)', () => {
    const now = new Date(2026, 6, 15, 12, 0, 0, 0).getTime();
    for (let day = 0; day < DAYS_PER_WEEK; day++) {
      expect(nextReminderAt(now, day)).toBeGreaterThan(now);
    }
  });

  it('honors an explicit hour argument', () => {
    const wed = new Date(2026, 6, 15, 9, 0, 0, 0).getTime();
    expect(nextReminderAt(wed, 0, 9)).toBe(new Date(2026, 6, 18, 9, 0, 0, 0).getTime());
  });

  it('defaults the hour argument to REMINDER_HOUR when omitted', () => {
    const wed = new Date(2026, 6, 15, 9, 0, 0, 0).getTime();
    expect(nextReminderAt(wed, 0)).toBe(new Date(2026, 6, 18, REMINDER_HOUR, 0, 0, 0).getTime());
  });
});

function makeDeps(overrides: Partial<ReminderDeps> = {}): ReminderDeps {
  return {
    now: () => 0,
    setTimer: vi.fn(),
    clearTimer: vi.fn(),
    notify: vi.fn(),
    getSettings: () => ({ weeklyReminderEnabled: false, weeklyReminderServiceDay: 0 }),
    ...overrides,
  };
}

describe('scheduleWeeklyReminder / cancelWeeklyReminder', () => {
  it('does not call setTimer when the reminder is disabled', () => {
    const deps = makeDeps({
      getSettings: () => ({ weeklyReminderEnabled: false, weeklyReminderServiceDay: 0 }),
    });
    scheduleWeeklyReminder(deps);
    expect(deps.setTimer).not.toHaveBeenCalled();
  });

  it('calls setTimer once with the delay to the next reminder when enabled', () => {
    const now = new Date(2026, 6, 15, 9, 0, 0, 0).getTime();
    const deps = makeDeps({
      now: () => now,
      getSettings: () => ({ weeklyReminderEnabled: true, weeklyReminderServiceDay: 0 }),
    });
    scheduleWeeklyReminder(deps);
    expect(deps.setTimer).toHaveBeenCalledTimes(1);
    const [, ms] = vi.mocked(deps.setTimer).mock.calls[0];
    expect(ms).toBe(nextReminderAt(now, 0) - now);
  });

  it('firing the callback calls notify() exactly once and re-arms with a delay of about one week', () => {
    // Fri 18:00 -> Sunday(0) service -> reminder fires that same-week Saturday.
    let current = new Date(2026, 6, 17, 18, 0, 0, 0).getTime();
    const deps = makeDeps({
      now: () => current,
      getSettings: () => ({ weeklyReminderEnabled: true, weeklyReminderServiceDay: 0 }),
    });
    scheduleWeeklyReminder(deps);
    expect(deps.setTimer).toHaveBeenCalledTimes(1);
    const [firstCallback, firstMs] = vi.mocked(deps.setTimer).mock.calls[0];

    // Simulate the real clock advancing by the scheduled delay before the timer fires.
    current += firstMs;
    firstCallback();

    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.setTimer).toHaveBeenCalledTimes(2);
    const secondMs = vi.mocked(deps.setTimer).mock.calls[1][1];
    expect(secondMs).toBe(DAYS_PER_WEEK * 24 * 60 * 60 * 1000);
  });

  it('calling scheduleWeeklyReminder twice cancels the first timer before arming the second', () => {
    const now = new Date(2026, 6, 15, 9, 0, 0, 0).getTime();
    const firstHandle = {} as NodeJS.Timeout;
    const secondHandle = {} as NodeJS.Timeout;
    const setTimer = vi.fn().mockReturnValueOnce(firstHandle).mockReturnValueOnce(secondHandle);
    const deps = makeDeps({
      now: () => now,
      setTimer,
      getSettings: () => ({ weeklyReminderEnabled: true, weeklyReminderServiceDay: 0 }),
    });

    scheduleWeeklyReminder(deps);
    scheduleWeeklyReminder(deps);

    expect(deps.clearTimer).toHaveBeenCalledTimes(1);
    expect(deps.clearTimer).toHaveBeenCalledWith(firstHandle);
    expect(setTimer).toHaveBeenCalledTimes(2);
  });

  it('cancelWeeklyReminder clears an armed timer and is idempotent when called again', () => {
    const now = new Date(2026, 6, 15, 9, 0, 0, 0).getTime();
    const handle = {} as NodeJS.Timeout;
    const deps = makeDeps({
      now: () => now,
      setTimer: vi.fn().mockReturnValue(handle),
      getSettings: () => ({ weeklyReminderEnabled: true, weeklyReminderServiceDay: 0 }),
    });

    scheduleWeeklyReminder(deps);
    cancelWeeklyReminder(deps);
    expect(deps.clearTimer).toHaveBeenCalledTimes(1);
    expect(deps.clearTimer).toHaveBeenCalledWith(handle);

    cancelWeeklyReminder(deps);
    expect(deps.clearTimer).toHaveBeenCalledTimes(1);
  });

  it('toggling to disabled and re-scheduling clears the pending timer and arms nothing', () => {
    const now = new Date(2026, 6, 15, 9, 0, 0, 0).getTime();
    const handle = {} as NodeJS.Timeout;
    let enabled = true;
    const setTimer = vi.fn().mockReturnValue(handle);
    const deps = makeDeps({
      now: () => now,
      setTimer,
      getSettings: () => ({ weeklyReminderEnabled: enabled, weeklyReminderServiceDay: 0 }),
    });

    scheduleWeeklyReminder(deps);
    expect(setTimer).toHaveBeenCalledTimes(1);

    enabled = false;
    scheduleWeeklyReminder(deps);

    expect(deps.clearTimer).toHaveBeenCalledWith(handle);
    expect(setTimer).toHaveBeenCalledTimes(1);
  });
});

describe('showReminderNotification', () => {
  it('constructs a Notification with the title/body and calls .show() once when supported', () => {
    notificationState.isSupported = true;
    showReminderNotification();
    expect(notificationState.instances).toHaveLength(1);
    expect(notificationState.instances[0].title).toBe(NOTIFICATION_TITLE);
    expect(notificationState.instances[0].body).toBe(NOTIFICATION_BODY);
    expect(notificationState.instances[0].show).toHaveBeenCalledTimes(1);
  });

  it('logs a warning and constructs no Notification when unsupported', () => {
    notificationState.isSupported = false;
    showReminderNotification();
    expect(notificationState.instances).toHaveLength(0);
    expect(logWarn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logWarn).mock.calls[0][0]).toMatch(/weekly reminder/i);
  });
});

describe('DEFAULT_DEPS (real Date.now/setTimeout/clearTimeout wiring)', () => {
  it('arms and cancels a real timer when called with no dependency overrides', () => {
    vi.useFakeTimers();
    try {
      vi.mocked(getSettings).mockReturnValue({
        weeklyReminderEnabled: true,
        weeklyReminderServiceDay: 0,
      } as ReturnType<typeof getSettings>);

      scheduleWeeklyReminder();
      expect(vi.getTimerCount()).toBe(1);

      cancelWeeklyReminder();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
