// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import UpdateBanner from './UpdateBanner';
import { createMockSoundBuddy } from './mock-sound-buddy';

function renderMarkup(): string {
  return renderToString(createElement(UpdateBanner));
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { soundBuddy: createMockSoundBuddy().api };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('UpdateBanner', () => {
  it('renders hidden with no update event yet (renderToString never fires effects)', () => {
    const html = renderMarkup();
    expect(html).toMatch(/id="update-toast" role="status" class=""/);
    expect(html).toMatch(/id="update-dialog"[^>]*style="display:none"/);
    expect(html).toMatch(/id="update-download-btn"[^>]*hidden=""/);
    expect(html).toMatch(/id="update-progress"[^>]*hidden=""/);
  });

  it('renders the cancel button, changelog region, and summary node', () => {
    const html = renderMarkup();
    expect(html).toContain('id="update-cancel-btn"');
    expect(html).toContain('id="update-dialog-notes"');
    expect(html).toContain('id="update-dialog-summary"');
  });
});
