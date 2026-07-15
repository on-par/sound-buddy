// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import LicensePanel, { LicensePanelView, type LicensePanelViewProps } from './LicensePanel';

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

function renderView(props: LicensePanelViewProps): string {
  return renderToString(createElement(LicensePanelView, props));
}

const NOOP = () => {};

function baseProps(overrides: Partial<LicensePanelViewProps> = {}): LicensePanelViewProps {
  return {
    open: false,
    statusLine: 'Free tier — full report card included.',
    error: null,
    showRemove: false,
    showRefresh: false,
    onActivate: NOOP,
    onRemove: NOOP,
    onRefresh: NOOP,
    onClose: NOOP,
    ...overrides,
  };
}

describe('LicensePanelView', () => {
  it('renders closed (display:none) with the free-tier status line', () => {
    const html = renderView(baseProps());

    expect(html).toContain('id="license-dialog"');
    expect(html).toContain('style="display:none"');
    expect(html).toContain('Free tier — full report card included.');
    expect(html).toContain('data-react-island="license"');
  });

  it('renders open with no remove/refresh buttons for a free user', () => {
    const html = renderView(baseProps({ open: true }));

    expect(html).toContain('style="display:flex"');
    expect(html).toMatch(/id="license-refresh-btn"[^>]*style="display:none"/);
    expect(html).toMatch(/id="license-remove-btn"[^>]*style="display:none"/);
  });

  it('renders remove visible but refresh hidden for a lifetime license', () => {
    const html = renderView(
      baseProps({ open: true, statusLine: 'Pro — lifetime license.', showRemove: true, showRefresh: false })
    );

    expect(html).toMatch(/id="license-remove-btn"[^>]*style="display:inline-flex"/);
    expect(html).toMatch(/id="license-refresh-btn"[^>]*style="display:none"/);
    expect(html).toContain('Pro — lifetime license.');
  });

  it('renders both remove and refresh visible for a subscription license', () => {
    const html = renderView(
      baseProps({ open: true, statusLine: 'Pro — active.', showRemove: true, showRefresh: true })
    );

    expect(html).toMatch(/id="license-remove-btn"[^>]*style="display:inline-flex"/);
    expect(html).toMatch(/id="license-refresh-btn"[^>]*style="display:inline-flex"/);
  });

  it('shows the error banner with role="alert" when an error is present', () => {
    const html = renderView(baseProps({ open: true, error: 'Could not save the license: boom' }));

    expect(html).toMatch(/id="license-dialog-error"[^>]*style="display:block"[^>]*role="alert"/);
    expect(html).toContain('Could not save the license: boom');
  });

  it('hides the error banner when there is no error', () => {
    const html = renderView(baseProps({ open: true, error: null }));

    expect(html).toMatch(/id="license-dialog-error"[^>]*style="display:none"/);
  });

  it('includes every stable id the e2e suite locates by', () => {
    const html = renderView(baseProps({ open: true }));

    for (const id of [
      'license-dialog',
      'license-dialog-title',
      'license-dialog-status',
      'license-key-input',
      'license-dialog-error',
      'license-refresh-btn',
      'license-remove-btn',
      'license-close-btn',
      'license-activate-btn',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });
});

describe('LicensePanel (connected)', () => {
  it('renders once from the store default state', () => {
    const html = renderToString(createElement(LicensePanel));

    expect(html).toContain('id="license-dialog"');
    expect(html).toContain('Free tier — full report card included.');
  });
});
