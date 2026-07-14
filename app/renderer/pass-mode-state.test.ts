import { describe, it, expect } from 'vitest';

// pass-mode-state is a plain classic script (window.passModeState in the
// browser, module.exports under Node) so the pure phase/toggle logic is
// exercised without a DOM, mirroring build-order-state.test.ts.
interface Phase {
  id: string;
  label: string;
  tagline: string;
  reminders: string[];
}
interface FakeStorage {
  store: Record<string, string>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const {
  STORAGE_KEY,
  DEFAULT_PHASE,
  PHASES,
  phaseIds,
  isValidPhase,
  getPhase,
  loadPhase,
  savePhase,
  toggleHtml,
  reminderHtml,
} = require('./pass-mode-state.js') as {
  STORAGE_KEY: string;
  DEFAULT_PHASE: string;
  PHASES: Phase[];
  phaseIds: () => string[];
  isValidPhase: (id: unknown) => boolean;
  getPhase: (id: unknown) => Phase;
  loadPhase: (storage: unknown) => string;
  savePhase: (storage: unknown, id: string) => void;
  toggleHtml: (activeId: string, escapeHtml: (s: unknown) => string) => string;
  reminderHtml: (phase: Phase, escapeHtml: (s: unknown) => string) => string;
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

describe('STORAGE_KEY / DEFAULT_PHASE', () => {
  it('is the versioned pass-mode key', () => {
    expect(STORAGE_KEY).toBe('sb-pass-mode-v1');
  });

  it('defaults to rough', () => {
    expect(DEFAULT_PHASE).toBe('rough');
  });
});

describe('PHASES', () => {
  it('has exactly 2 entries, rough first then contextual', () => {
    expect(PHASES).toHaveLength(2);
    expect(phaseIds()).toEqual(['rough', 'contextual']);
  });

  it('every phase has a non-empty label, tagline, and reminders array', () => {
    PHASES.forEach((phase) => {
      expect(phase.label).toBeTruthy();
      expect(phase.tagline).toBeTruthy();
      expect(Array.isArray(phase.reminders)).toBe(true);
      expect(phase.reminders.length).toBeGreaterThan(0);
    });
  });

  it('the contextual phase has a reminder mentioning context', () => {
    const contextual = PHASES.find((p) => p.id === 'contextual')!;
    expect(contextual.reminders.some((r) => /context/i.test(r))).toBe(true);
  });

  it('the rough phase has a reminder mentioning gain structure', () => {
    const rough = PHASES.find((p) => p.id === 'rough')!;
    expect(rough.reminders.some((r) => /gain structure/i.test(r))).toBe(true);
  });
});

describe('isValidPhase', () => {
  it('is true for known phase ids', () => {
    expect(isValidPhase('rough')).toBe(true);
    expect(isValidPhase('contextual')).toBe(true);
  });

  it('is false for unknown/empty/undefined ids', () => {
    expect(isValidPhase('nope')).toBe(false);
    expect(isValidPhase('')).toBe(false);
    expect(isValidPhase(undefined)).toBe(false);
  });
});

describe('getPhase', () => {
  it('returns the matching phase object', () => {
    expect(getPhase('contextual').id).toBe('contextual');
  });

  it('falls back to the default phase for an unknown id', () => {
    expect(getPhase('bogus').id).toBe('rough');
  });

  it('falls back to the default phase for undefined', () => {
    expect(getPhase(undefined).id).toBe('rough');
  });
});

describe('loadPhase / savePhase round-trip', () => {
  it('round-trips through a fake Storage', () => {
    const storage = makeStorage();
    savePhase(storage, 'contextual');
    expect(loadPhase(storage)).toBe('contextual');
  });

  it('returns the default phase when storage is empty', () => {
    const storage = makeStorage();
    expect(loadPhase(storage)).toBe('rough');
  });

  it('returns the default phase for a stored invalid value', () => {
    const storage = makeStorage();
    storage.store[STORAGE_KEY] = 'garbage';
    expect(loadPhase(storage)).toBe('rough');
  });

  it('does not persist an invalid phase id', () => {
    const storage = makeStorage();
    savePhase(storage, 'contextual');
    savePhase(storage, 'bogus');
    expect(loadPhase(storage)).toBe('contextual');
    expect(storage.getItem(STORAGE_KEY)).toBe('contextual');
  });

  it('loadPhase returns the default phase when getItem throws (private mode)', () => {
    const storage = {
      getItem: () => { throw new Error('private mode'); },
      setItem: () => { throw new Error('private mode'); },
    };
    expect(loadPhase(storage)).toBe('rough');
  });

  it('savePhase does not throw when setItem throws (private mode)', () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new Error('private mode'); },
    };
    expect(() => savePhase(storage, 'contextual')).not.toThrow();
  });

  it('returns the default phase when storage is missing', () => {
    expect(loadPhase(undefined)).toBe('rough');
  });
});

describe('toggleHtml', () => {
  it('contains both labels and both data-phase attributes', () => {
    const html = toggleHtml('rough', escapeHtml);
    expect(html).toContain('Rough Pass');
    expect(html).toContain('Contextual Pass');
    expect(html).toContain('data-phase="rough"');
    expect(html).toContain('data-phase="contextual"');
  });

  it('marks the active phase button active, not the other one', () => {
    const html = toggleHtml('contextual', escapeHtml);
    const contextualBtn = html.match(/<button[^>]*data-phase="contextual"[^>]*>/)![0];
    const roughBtn = html.match(/<button[^>]*data-phase="rough"[^>]*>/)![0];
    expect(contextualBtn).toContain('active');
    expect(roughBtn).not.toContain('active');
  });

  it('falls back to the default phase when activeId is invalid', () => {
    const html = toggleHtml('bogus', escapeHtml);
    const roughBtn = html.match(/<button[^>]*data-phase="rough"[^>]*>/)![0];
    expect(roughBtn).toContain('active');
  });
});

describe('reminderHtml', () => {
  it('contains the tagline and each reminder for the given phase', () => {
    const rough = getPhase('rough');
    const html = reminderHtml(rough, escapeHtml);
    expect(html).toContain(escapeHtml(rough.tagline));
    rough.reminders.forEach((r) => expect(html).toContain(escapeHtml(r)));
  });

  it('falls back to the default phase when no phase object is given', () => {
    const html = reminderHtml(undefined as unknown as Phase, escapeHtml);
    const rough = getPhase('rough');
    expect(html).toContain(escapeHtml(rough.tagline));
  });

  it('escapes hostile tagline/reminder content via the injected escapeHtml', () => {
    const hostile: Phase = {
      id: 'rough',
      label: 'Rough Pass',
      tagline: '<img src=x onerror=1>',
      reminders: ['<script>alert(1)</script>'],
    };
    const html = reminderHtml(hostile, escapeHtml);
    expect(html).not.toContain('<img src=x onerror=1>');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
