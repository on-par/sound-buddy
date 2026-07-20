// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import SceneChanges, { type SceneChangesProps } from './SceneChanges';

function renderMarkup(props: SceneChangesProps): string {
  return renderToString(createElement(SceneChanges, props));
}

const BASE: SceneChangesProps = {
  status: 'idle',
  changes: [],
  totalChanges: 0,
  nameA: null,
  nameB: null,
  sceneError: null,
};

describe('SceneChanges', () => {
  it('renders nothing when idle', () => {
    const html = renderMarkup({ ...BASE, status: 'idle' });
    expect(html).toBe('');
  });

  it('shows the non-error "nothing to compare yet" hint when one-loaded', () => {
    const html = renderMarkup({ ...BASE, status: 'one-loaded' });
    expect(html).toContain('Nothing to compare yet');
    expect(html).not.toContain('--issue-text');
  });

  it('shows a comparing message while diffing', () => {
    const html = renderMarkup({ ...BASE, status: 'diffing' });
    expect(html).toContain('Comparing scenes');
  });

  it('shows the actionable error message, styled with the app-wide error convention', () => {
    const html = renderMarkup({
      ...BASE,
      status: 'error',
      sceneError: 'after.scn is not a valid M32R scene file. Export a fresh scene and try again.',
    });
    expect(html).toContain('after.scn is not a valid M32R scene file. Export a fresh scene and try again.');
    expect(html).toContain('var(--issue-text)');
  });

  it('shows the no-differences message when done with zero changes', () => {
    const html = renderMarkup({ ...BASE, status: 'done', totalChanges: 0, nameA: 'Before', nameB: 'After' });
    expect(html).toContain('No console changes between these two scenes.');
  });

  it('renders up to 3 change rows plus a heading and scene names when done with changes', () => {
    const html = renderMarkup({
      ...BASE,
      status: 'done',
      totalChanges: 5,
      nameA: 'Sunday AM (before)',
      nameB: 'Sunday AM (after)',
      changes: [
        { label: 'Kick — mute', from: 'on', to: 'off' },
        { label: 'Kick — fader', from: '-3.0', to: '2.5' },
        { label: 'Vocal — gain', from: '10.0', to: '12.0' },
      ],
    });

    expect(html).toContain('Console changes');
    expect(html).toContain('Sunday AM (before)');
    expect(html).toContain('Sunday AM (after)');
    expect((html.match(/class="rc-scene-change"/g) ?? []).length).toBe(3);
    expect(html).toContain('Kick — mute');
    expect(html).toContain('Kick — fader');
    expect(html).toContain('Vocal — gain');
    expect(html).toMatch(/-3\.0.*→.*2\.5/);
    expect(html).toMatch(/\+.*2.*more/);
  });

  it('does not show a "+more" line when there are 3 or fewer total changes', () => {
    const html = renderMarkup({
      ...BASE,
      status: 'done',
      totalChanges: 2,
      changes: [
        { label: 'Kick — mute', from: 'on', to: 'off' },
        { label: 'Kick — fader', from: '-3.0', to: '2.5' },
      ],
    });

    expect(html).not.toContain('more');
  });
});
