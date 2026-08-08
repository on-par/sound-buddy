// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import GradeOwnGuideDialog from './GradeOwnGuideDialog';
import { useGradeOwnGuideStore } from './stores/gradeOwnGuideStore';
import { createMockSoundBuddy } from './mock-sound-buddy';

function renderMarkup(): string {
  return renderToString(createElement(GradeOwnGuideDialog));
}

let pathsHtml: ReturnType<typeof vi.fn>;

beforeEach(() => {
  pathsHtml = vi.fn(() => '<div class="guide-item" data-guide-path="usb"></div>');
  (globalThis as { window?: unknown }).window = {
    gradeOwnState: { pathsHtml },
    soundBuddy: createMockSoundBuddy().api,
  };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useGradeOwnGuideStore.setState({ dialogOpen: false });
});

describe('GradeOwnGuideDialog', () => {
  it('is hidden (display:none) when the dialog is closed', () => {
    useGradeOwnGuideStore.setState({ dialogOpen: false });

    const html = renderMarkup();

    expect(html).toContain('id="guide-dialog"');
    expect(html).toContain('display:none');
  });

  it('is visible (display:flex) when open', () => {
    useGradeOwnGuideStore.setState({ dialogOpen: true });

    const html = renderMarkup();

    expect(html).toContain('display:flex');
  });

  it('renders window.gradeOwnState.pathsHtml into #guide-paths', () => {
    const html = renderMarkup();

    expect(pathsHtml).toHaveBeenCalled();
    expect(html).toContain('data-guide-path="usb"');
  });

  it('renders icons inline rather than via data-icon', () => {
    const html = renderMarkup();

    expect(html).not.toContain('data-icon="file-audio"');
    expect(html).not.toContain('data-icon="external-link"');
  });
});
