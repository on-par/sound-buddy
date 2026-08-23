// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import UpdateBanner, { releaseNoteLines, UpdatePrimaryAction } from './UpdateBanner';
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
    expect(html).not.toContain('id="update-download-btn"');
    expect(html).toMatch(/id="update-progress"[^>]*hidden=""/);
  });

  it('renders the cancel button, changelog region, and summary node', () => {
    const html = renderMarkup();
    expect(html).toContain('id="update-cancel-btn"');
    expect(html).toContain('id="update-dialog-notes"');
    expect(html).toContain('id="update-dialog-summary"');
  });

  it('normalizes GitHub HTML release notes for the changelog list', () => {
    expect(releaseNoteLines(`
      <h2>What's new in 0.8.23</h2>
      <ul>
        <li><strong>Post-update notes are a snackbar</strong>: the top &quot;What's new&quot; bar fades.</li>
        <li><strong>Update checks use a modal</strong>: available updates show the changelog.</li>
      </ul>
    `)).toEqual([
      "What's new in 0.8.23",
      'Post-update notes are a snackbar: the top "What\'s new" bar fades.',
      'Update checks use a modal: available updates show the changelog.',
    ]);
  });

  it('does not decode encoded tags or ampersands while normalizing release notes', () => {
    expect(releaseNoteLines('<p>Safe &amp; sound &lt;script&gt;alert(1)&lt;/script&gt;</p>')).toEqual([
      'Safe &amp; sound &lt;script&gt;alert(1)&lt;/script&gt;',
    ]);
  });
});

describe('UpdatePrimaryAction', () => {
  it('omits the primary action while an update is downloading', () => {
    const html = renderToString(createElement(UpdatePrimaryAction, {
      primary: null,
      onAction: () => {},
    }));

    expect(html).not.toContain('id="update-download-btn"');
  });

  it('renders the offered update action with its visible label', () => {
    const html = renderToString(createElement(UpdatePrimaryAction, {
      primary: { label: 'Update', action: 'download' },
      onAction: () => {},
    }));

    expect(html).toContain('id="update-download-btn"');
    expect(html).toContain('>Update</button>');
  });

  it('renders the retry update action with its visible label', () => {
    const html = renderToString(createElement(UpdatePrimaryAction, {
      primary: { label: 'Retry', action: 'retry' },
      onAction: () => {},
    }));

    expect(html).toContain('id="update-download-btn"');
    expect(html).toContain('>Retry</button>');
  });

  it('renders the downloaded update action with its visible label', () => {
    const html = renderToString(createElement(UpdatePrimaryAction, {
      primary: { label: 'Restart to Update', action: 'install' },
      onAction: () => {},
    }));

    expect(html).toContain('id="update-download-btn"');
    expect(html).toContain('>Restart to Update</button>');
  });

  it('forwards the supplied primary action when clicked', () => {
    const actions: string[] = [];
    const button = UpdatePrimaryAction({
      primary: { label: 'Retry', action: 'retry' },
      onAction: (action) => actions.push(action),
    });

    expect(button).not.toBeNull();
    if (button === null) throw new Error('Expected a primary action button');
    button.props.onClick();

    expect(actions).toEqual(['retry']);
  });
});
