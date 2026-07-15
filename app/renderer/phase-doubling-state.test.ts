import { describe, it, expect } from 'vitest';

// phase-doubling-state is a plain classic script (window.phaseDoublingState in
// the browser, module.exports under Node) so the pure checklist/detection
// logic is exercised without a DOM, mirroring pass-mode-state.test.ts.
interface Step {
  id: string;
  title: string;
  explanation: string;
  resolution: string;
}

const {
  STEPS,
  stepCount,
  clampIndex,
  isLastStep,
  getStep,
  stepHtml,
  progressDotsHtml,
  detectPhaseSignal,
} = require('./phase-doubling-state.js') as {
  STEPS: Step[];
  stepCount: () => number;
  clampIndex: (i: unknown) => number;
  isLastStep: (i: unknown) => boolean;
  getStep: (i: unknown) => Step;
  stepHtml: (step: Step, index: number, total: number, escapeHtml: (s: unknown) => string) => string;
  progressDotsHtml: (index: number, total: number) => string;
  detectPhaseSignal: (input: { deviation?: number[] } | undefined) => boolean;
};

function escapeHtml(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}

describe('STEPS integrity', () => {
  it('has exactly 6 steps', () => {
    expect(stepCount()).toBe(6);
    expect(STEPS).toHaveLength(6);
  });

  it('every step has a non-empty id, title, explanation, and resolution', () => {
    STEPS.forEach((step) => {
      expect(step.id).toBeTruthy();
      expect(step.title).toBeTruthy();
      expect(step.explanation).toBeTruthy();
      expect(step.resolution).toBeTruthy();
    });
  });

  it('every step id is unique', () => {
    const ids = STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('clampIndex / isLastStep / getStep', () => {
  it('clamps a negative index to 0', () => {
    expect(clampIndex(-1)).toBe(0);
  });

  it('clamps an out-of-range index to the last step', () => {
    expect(clampIndex(999)).toBe(5);
  });

  it('clamps NaN to 0', () => {
    expect(clampIndex(NaN)).toBe(0);
  });

  it('truncates a fractional index', () => {
    expect(clampIndex(2.7)).toBe(2);
  });

  it('isLastStep is true only for the final index', () => {
    expect(isLastStep(5)).toBe(true);
    expect(isLastStep(0)).toBe(false);
  });

  it('getStep clamps out-of-range indices to the resolved step', () => {
    expect(getStep(999).id).toBe('resolved');
  });
});

describe('detectPhaseSignal', () => {
  it('detects a regularly alternating deviation pattern', () => {
    expect(detectPhaseSignal({ deviation: [-3, 3, -3, 3, -3, 3] })).toBe(true);
  });

  it('returns false for a monotonic deviation pattern', () => {
    expect(detectPhaseSignal({ deviation: [1, 2, 3, 4, 5, 6] })).toBe(false);
  });

  it('returns false for a flat deviation pattern', () => {
    expect(detectPhaseSignal({ deviation: [0, 0, 0, 0, 0, 0] })).toBe(false);
  });

  it('returns false when there are too few bands', () => {
    expect(detectPhaseSignal({ deviation: [-3, 3, -3] })).toBe(false);
  });

  it('returns false for low-amplitude alternation below the significance threshold', () => {
    expect(detectPhaseSignal({ deviation: [-0.5, 0.5, -0.5, 0.5, -0.5, 0.5] })).toBe(false);
  });

  it('returns false and never throws for missing/undefined/empty input', () => {
    expect(detectPhaseSignal(undefined)).toBe(false);
    expect(detectPhaseSignal({})).toBe(false);
    expect(() => detectPhaseSignal(undefined)).not.toThrow();
  });
});

describe('stepHtml', () => {
  it('routes title/explanation/resolution through the injected escapeHtml', () => {
    const sentinelEscape = (s: unknown) => `⟦${String(s)}⟧`;
    const step = getStep(0);
    const html = stepHtml(step, 0, 6, sentinelEscape);
    expect(html).toContain(`⟦${step.title}⟧`);
    expect(html).toContain(`⟦${step.explanation}⟧`);
    expect(html).toContain(`⟦${step.resolution}⟧`);
  });

  it('shows a 1-indexed step counter', () => {
    const html = stepHtml(getStep(0), 0, 6, escapeHtml);
    expect(html).toContain('Step 1 of 6');
  });
});

describe('progressDotsHtml', () => {
  it('renders exactly `total` dots and marks the active index', () => {
    const html = progressDotsHtml(2, 6);
    const dots = html.match(/class="pd-dot[^"]*"/g) || [];
    expect(dots).toHaveLength(6);
    expect(dots[2]).toContain('active');
    expect(dots.filter((d) => d.includes('active'))).toHaveLength(1);
  });
});
