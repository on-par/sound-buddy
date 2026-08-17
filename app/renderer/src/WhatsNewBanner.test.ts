// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import WhatsNewBanner from './WhatsNewBanner';
import { createMockSoundBuddy } from './mock-sound-buddy';

function renderMarkup(): string {
  return renderToString(createElement(WhatsNewBanner));
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    soundBuddy: createMockSoundBuddy().api,
    whatsNewState: { parseNote: () => null, hasSeen: () => false, markSeen: () => {} },
    onboardingState: { hasSeenOnboarding: () => true },
  };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('WhatsNewBanner', () => {
  it('renders hidden with no what\'s-new event yet (renderToString never fires effects)', () => {
    const html = renderMarkup();
    expect(html).toMatch(/id="whats-new-banner" role="status" class=""/);
  });

  it('renders the dismiss button and text node', () => {
    const html = renderMarkup();
    expect(html).toContain('id="whats-new-dismiss"');
    expect(html).toContain('id="whats-new-text"');
  });
});
