// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import SkillTreeDialog from './SkillTreeDialog';
import { useSkillTreeStore } from './stores/skillTreeStore';
import { createMockSoundBuddy } from './mock-sound-buddy';

// skill-tree-state is a plain classic script (window.skillTreeState /
// module.exports) — install the real api on the fake window, same as the
// running app reads it.
const state = require('../skill-tree-state.js') as {
  KEY: string;
  SKILL_TREE: Array<{ id: string; title: string; summary: string; levels: Array<{ id: string; title: string; body: string; tip: string }> }>;
  LEVEL_COUNT: number;
  BRANCH_COUNT: number;
  loadProgress: (storage: unknown) => { completed: string[] };
};

function renderMarkup(): string {
  return renderToString(createElement(SkillTreeDialog));
}

function branchIdsFromMarkup(html: string): string[] {
  return [...html.matchAll(/data-skill-branch="([^"]+)"/g)].map((m) => m[1]);
}

const DEFAULT_STATE = {
  dialogOpen: false,
  progress: { completed: [] as string[] },
  selectedBranchId: 'fundamentals',
};

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    skillTreeState: state,
    soundBuddy: createMockSoundBuddy().api,
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
  };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useSkillTreeStore.setState(DEFAULT_STATE);
});

describe('SkillTreeDialog', () => {
  it('is hidden (display:none) when the dialog is closed', () => {
    useSkillTreeStore.setState({ ...DEFAULT_STATE, dialogOpen: false });

    const html = renderMarkup();

    expect(html).toContain('id="skill-tree-dialog"');
    expect(html).toContain('display:none');
  });

  it('is visible (display:flex) when open', () => {
    useSkillTreeStore.setState({ ...DEFAULT_STATE, dialogOpen: true });

    const html = renderMarkup();

    expect(html).toContain('display:flex');
  });

  it('renders all nine branches in the MxU teaching order', () => {
    useSkillTreeStore.setState({ ...DEFAULT_STATE, dialogOpen: true });

    const html = renderMarkup();

    expect(branchIdsFromMarkup(html)).toEqual(state.SKILL_TREE.map((b) => b.id));
  });

  it('renders the selected branch\'s three levels with their content', () => {
    useSkillTreeStore.setState({ ...DEFAULT_STATE, dialogOpen: true, selectedBranchId: 'eq' });

    const html = renderMarkup();
    const eq = state.SKILL_TREE.find((b) => b.id === 'eq')!;

    expect(html).toContain(eq.summary);
    for (const level of eq.levels) {
      expect(html).toContain(`data-skill-level="${level.id}"`);
      expect(html).toContain(level.title);
      expect(html).toContain(level.body);
      expect(html).toContain(level.tip);
    }
  });

  it('falls back to the first branch when the selected branch id is stale or bogus', () => {
    useSkillTreeStore.setState({ ...DEFAULT_STATE, dialogOpen: true, selectedBranchId: 'not-a-branch' });

    const html = renderMarkup();

    expect(html).toContain(state.SKILL_TREE[0].summary);
    expect(html).not.toContain('Mark incomplete');
  });

  it('shows the overall counts and a Badge earned chip for a fully completed branch', () => {
    useSkillTreeStore.setState({
      ...DEFAULT_STATE,
      dialogOpen: true,
      progress: { completed: ['fundamentals.1', 'fundamentals.2', 'fundamentals.3'] },
    });

    const html = renderMarkup();

    expect(html).toContain(`3 of ${state.LEVEL_COUNT} levels · 1 of ${state.BRANCH_COUNT} badges`);
    expect(html).toContain('Badge earned');
  });

  it('toggling a level drives the store action and updates the rendered state', () => {
    useSkillTreeStore.setState({ ...DEFAULT_STATE, dialogOpen: true });
    expect(renderMarkup()).toContain('Mark complete');

    useSkillTreeStore.getState().toggleLevelComplete('fundamentals.1');

    expect(useSkillTreeStore.getState().progress.completed).toEqual(['fundamentals.1']);
    const html = renderMarkup();
    expect(html).toContain('Mark incomplete');
    expect(html).toContain(`1 of ${state.LEVEL_COUNT} levels`);
  });

  it('disables Continue when every level is complete', () => {
    const all = state.SKILL_TREE.flatMap((b) => b.levels.map((l) => l.id));
    useSkillTreeStore.setState({ ...DEFAULT_STATE, dialogOpen: true, progress: { completed: all } });

    const html = renderMarkup();

    expect(html).toMatch(/data-skill-continue[^>]*disabled/);
    expect(html).toContain(`of ${state.LEVEL_COUNT} levels`);
  });

  it('does not throw when window.skillTreeState is undefined (pre-boot first render)', () => {
    (globalThis as { window?: unknown }).window = {
      skillTreeState: undefined,
      soundBuddy: createMockSoundBuddy().api,
    };

    expect(() => renderMarkup()).not.toThrow();
    expect(renderMarkup()).toContain('id="skill-tree-dialog"');
    expect(renderMarkup()).toContain('display:none');
  });
});