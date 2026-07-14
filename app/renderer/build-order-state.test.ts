import { describe, it, expect } from 'vitest';

// build-order-state is a plain classic script (window.buildOrderState in the
// browser, module.exports under Node) so the pure guide/progress logic is
// exercised without a DOM, mirroring recent-services.test.ts.
interface Presets {
  eq: string[];
  comp: string | null;
  gate: string | null;
  note?: string;
}
interface Step {
  id: string;
  label: string;
  presets: Presets | null;
  note?: string;
}
interface Progress {
  completed: string[];
}
interface FakeStorage {
  store: Record<string, string>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const {
  STORAGE_KEY,
  STEPS,
  emptyProgress,
  stepIds,
  totalSteps,
  isComplete,
  toggle,
  completedCount,
  isAllComplete,
  loadProgress,
  saveProgress,
  presetLines,
  stepRowHtml,
  WATCH_FOR,
  summaryLine,
  completeMomentHtml,
} = require('./build-order-state.js') as {
  STORAGE_KEY: string;
  STEPS: Step[];
  emptyProgress: () => Progress;
  stepIds: () => string[];
  totalSteps: () => number;
  isComplete: (progress: Progress, id: string) => boolean;
  toggle: (progress: Progress, id: string) => Progress;
  completedCount: (progress: Progress) => number;
  isAllComplete: (progress: Progress) => boolean;
  loadProgress: (storage: unknown) => Progress;
  saveProgress: (storage: unknown, progress: Progress) => void;
  presetLines: (step: Step) => string[];
  stepRowHtml: (
    step: Step,
    index: number,
    progress: Progress,
    escapeHtml: (s: unknown) => string
  ) => string;
  WATCH_FOR: string[];
  summaryLine: (progress: Progress) => string;
  completeMomentHtml: (progress: Progress, escapeHtml: (s: unknown) => string) => string;
};

function escapeHtml(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}

function makeStorage(): FakeStorage {
  const store: Record<string, string> = {};
  return {
    store,
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => { store[key] = value; },
  };
}

const EXPECTED_STEP_IDS = [
  'kick', 'snare-top', 'snare-bottom', 'hats', 'toms', 'overheads',
  'tracks', 'bass', 'keys', 'guitars', 'acoustic', 'lead-vocal', 'unmute-all',
];

describe('STORAGE_KEY', () => {
  it('is the versioned build-order key', () => {
    expect(STORAGE_KEY).toBe('sb-build-order-v1');
  });
});

describe('STEPS order', () => {
  it('matches the exact 13-item id sequence', () => {
    expect(stepIds()).toEqual(EXPECTED_STEP_IDS);
  });

  it('has 13 total steps', () => {
    expect(totalSteps()).toBe(13);
    expect(STEPS).toHaveLength(13);
  });

  it('ends with unmute-all, preceded by lead-vocal as the last channel step', () => {
    expect(STEPS[STEPS.length - 1].id).toBe('unmute-all');
    expect(STEPS[STEPS.length - 2].id).toBe('lead-vocal');
  });
});

describe('STEPS content', () => {
  const instrumentSteps = STEPS.slice(0, 11);

  it('every instrument step has a non-empty eq array', () => {
    instrumentSteps.forEach((step) => {
      expect(Array.isArray(step.presets?.eq)).toBe(true);
      expect(step.presets!.eq.length).toBeGreaterThan(0);
    });
  });

  it('kick, snare-top, toms, bass, lead-vocal have a non-null comp', () => {
    ['kick', 'snare-top', 'toms', 'bass', 'lead-vocal'].forEach((id) => {
      const step = STEPS.find((s) => s.id === id)!;
      expect(step.presets!.comp).not.toBeNull();
    });
  });

  it('kick and toms have a non-null gate', () => {
    ['kick', 'toms'].forEach((id) => {
      const step = STEPS.find((s) => s.id === id)!;
      expect(step.presets!.gate).not.toBeNull();
    });
  });

  it('unmute-all has null presets and a non-empty note', () => {
    const step = STEPS.find((s) => s.id === 'unmute-all')!;
    expect(step.presets).toBeNull();
    expect(step.note).toBeTruthy();
  });
});

describe('toggle', () => {
  it('adds an id, and toggling again removes it', () => {
    const p1 = toggle(emptyProgress(), 'kick');
    expect(isComplete(p1, 'kick')).toBe(true);
    const p2 = toggle(p1, 'kick');
    expect(isComplete(p2, 'kick')).toBe(false);
  });

  it('does not mutate the original progress object', () => {
    const original = emptyProgress();
    const originalCopy = { completed: original.completed.slice() };
    toggle(original, 'kick');
    expect(original).toEqual(originalCopy);
  });

  it('ignores an unknown id — not stored, isComplete stays false', () => {
    const next = toggle(emptyProgress(), 'nope');
    expect(isComplete(next, 'nope')).toBe(false);
    expect(next.completed).not.toContain('nope');
  });
});

describe('completedCount / isAllComplete', () => {
  it('counts only valid completed ids', () => {
    const progress: Progress = { completed: ['kick', 'hats', 'nope'] };
    expect(completedCount(progress)).toBe(2);
  });

  it('isAllComplete is false until all 13 are toggled, true after', () => {
    let progress = emptyProgress();
    EXPECTED_STEP_IDS.forEach((id, i) => {
      expect(isAllComplete(progress)).toBe(false);
      progress = toggle(progress, id);
      if (i < EXPECTED_STEP_IDS.length - 1) expect(isAllComplete(progress)).toBe(false);
    });
    expect(isAllComplete(progress)).toBe(true);
  });

  it('ignores stray/unknown ids when checking isAllComplete', () => {
    const progress: Progress = { completed: [...EXPECTED_STEP_IDS, 'nope'] };
    expect(isAllComplete(progress)).toBe(true);
    expect(completedCount(progress)).toBe(13);
  });
});

describe('loadProgress / saveProgress round-trip', () => {
  it('round-trips through a fake Storage', () => {
    const storage = makeStorage();
    saveProgress(storage, { completed: ['kick', 'hats'] });
    const loaded = loadProgress(storage);
    expect(loaded).toEqual({ completed: ['kick', 'hats'] });
  });

  it('returns emptyProgress() for malformed JSON in storage', () => {
    const storage = makeStorage();
    storage.store[STORAGE_KEY] = '{not json';
    expect(loadProgress(storage)).toEqual(emptyProgress());
  });

  it('returns emptyProgress() when storage is missing', () => {
    expect(loadProgress(undefined)).toEqual(emptyProgress());
  });

  it('loadProgress returns emptyProgress() when getItem throws (private mode)', () => {
    const storage = {
      getItem: () => { throw new Error('private mode'); },
      setItem: () => { throw new Error('private mode'); },
    };
    expect(loadProgress(storage)).toEqual(emptyProgress());
  });

  it('saveProgress does not throw when setItem throws (private mode)', () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new Error('private mode'); },
    };
    expect(() => saveProgress(storage, { completed: ['kick'] })).not.toThrow();
  });

  it('filters unknown ids present in stored JSON on load', () => {
    const storage = makeStorage();
    storage.store[STORAGE_KEY] = JSON.stringify({ completed: ['kick', 'nope', 'hats'] });
    expect(loadProgress(storage)).toEqual({ completed: ['kick', 'hats'] });
  });
});

describe('presetLines', () => {
  it('includes an EQ: line and omits Comp/Gate lines when null', () => {
    const step = STEPS.find((s) => s.id === 'hats')!;
    const lines = presetLines(step);
    expect(lines.some((l) => l.startsWith('EQ:'))).toBe(true);
    expect(lines.some((l) => l.startsWith('Comp:'))).toBe(false);
    expect(lines.some((l) => l.startsWith('Gate:'))).toBe(false);
  });

  it('includes Comp/Gate lines when present', () => {
    const step = STEPS.find((s) => s.id === 'kick')!;
    const lines = presetLines(step);
    expect(lines.some((l) => l.startsWith('Comp:'))).toBe(true);
    expect(lines.some((l) => l.startsWith('Gate:'))).toBe(true);
  });

  it('includes a Note: line for unmute-all (null presets, top-level note)', () => {
    const step = STEPS.find((s) => s.id === 'unmute-all')!;
    const lines = presetLines(step);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Note: /);
  });
});

describe('stepRowHtml', () => {
  it('includes the step label and data-step-id, reflecting completion state', () => {
    const step = STEPS.find((s) => s.id === 'kick')!;
    const notDone = stepRowHtml(step, 0, emptyProgress(), escapeHtml);
    expect(notDone).toContain('Kick');
    expect(notDone).toContain('data-step-id="kick"');
    expect(notDone).not.toContain('bg-done');

    const done = stepRowHtml(step, 0, { completed: ['kick'] }, escapeHtml);
    expect(done).toContain('bg-done');
  });

  it('escapes hostile fields via the injected escapeHtml', () => {
    const hostileStep: Step = {
      id: 'kick',
      label: '<img src=x onerror=1>',
      presets: { eq: ['<script>'], comp: null, gate: null },
    };
    const html = stepRowHtml(hostileStep, 0, emptyProgress(), escapeHtml);
    expect(html).not.toContain('<img src=x onerror=1>');
    expect(html).not.toContain('<script>');
  });
});

describe('Build Complete closing moment (#374)', () => {
  const completeProgress: Progress = EXPECTED_STEP_IDS.reduce(
    (progress, id) => toggle(progress, id),
    emptyProgress()
  );

  it('WATCH_FOR is 5 non-empty tip strings', () => {
    expect(WATCH_FOR).toHaveLength(5);
    WATCH_FOR.forEach((t) => {
      expect(typeof t).toBe('string');
      expect(t.length).toBeGreaterThan(0);
    });
  });

  it('summaryLine reports the completed/total counts', () => {
    expect(summaryLine(emptyProgress())).toContain('0 of 13');
    expect(summaryLine(completeProgress)).toContain('13 of 13');
  });

  it('completeMomentHtml returns empty until complete', () => {
    expect(completeMomentHtml(emptyProgress(), escapeHtml)).toBe('');
    const partial = toggle(emptyProgress(), 'kick');
    expect(completeMomentHtml(partial, escapeHtml)).toBe('');
  });

  it('renders the closing moment once complete', () => {
    const html = completeMomentHtml(completeProgress, escapeHtml);
    expect(html).toContain('You’re done.');
    expect(html).toContain('13 of 13');
    expect(html).toContain('id="build-complete-share"');
    WATCH_FOR.forEach((tip) => expect(html).toContain(tip));
  });

  it('routes text through the injected escapeHtml', () => {
    let called = 0;
    const spy = (s: unknown) => {
      called += 1;
      return escapeHtml(s);
    };
    const html = completeMomentHtml(completeProgress, spy);
    expect(called).toBeGreaterThan(0);
    expect(html).not.toContain('<script>');
  });
});
