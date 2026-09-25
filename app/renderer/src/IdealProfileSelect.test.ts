// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import IdealProfileSelect from './IdealProfileSelect';
import { useIdealProfilesStore } from './stores/idealProfilesStore';
import { useLicensingStore } from './stores/licensingStore';
import type { CustomIdealProfile } from '../../electron/ipc/api';

function renderMarkup(): string {
  return renderToString(createElement(IdealProfileSelect));
}

const customProfile: CustomIdealProfile = {
  id: 'sanctuary-ref',
  label: 'Sanctuary reference',
  description: 'Custom ideal curve',
  freqs: [],
  dbOffsets: [],
  source: 'manual',
};

describe('IdealProfileSelect', () => {
  // Base markup tests below are unrelated to licensing — default them to Pro
  // so they exercise the unlabeled option/button text; the Pro-affordance
  // tests further down set their own tier explicitly.
  beforeEach(() => {
    useLicensingStore.setState({ licenseStatus: { tier: 'pro', status: 'valid' } });
  });

  afterEach(() => {
    useIdealProfilesStore.setState({ selectedId: '', customProfiles: [] });
    useLicensingStore.setState({ licenseStatus: null });
  });

  it('renders the built-in profiles plus the Auto and Create-new options, with the current selection reflected', () => {
    useIdealProfilesStore.setState({ selectedId: 'flat', customProfiles: [] });

    const html = renderMarkup();

    expect(html).toContain('id="ideal-profile-select"');
    expect(html).toContain('aria-label="Ideal EQ profile"');
    expect(html).toContain('<option value="">Auto (by content)</option>');
    expect(html).toContain('<option value="flat" selected="">Flat / neutral</option>');
    expect(html).toContain('<option value="music-fullrange">Music (full-range)</option>');
    expect(html).toContain('<option value="__new">Create new curve…</option>');
    expect(html).not.toContain('<optgroup');
  });

  it('wraps custom profiles in an optgroup labeled Custom', () => {
    useIdealProfilesStore.setState({ selectedId: 'custom:sanctuary-ref', customProfiles: [customProfile] });

    const html = renderMarkup();

    expect(html).toContain('<optgroup label="Custom">');
    expect(html).toContain('<option value="custom:sanctuary-ref" selected="">Sanctuary reference</option>');
  });

  it('renders the edit button with its icon and accessible label', () => {
    const html = renderMarkup();

    expect(html).toContain('id="ideal-curve-edit-btn"');
    expect(html).toContain('aria-label="Create or edit ideal curve"');
    expect(html).not.toContain('data-icon="settings"');
  });

  it('renders the select caret icon inline, not via data-icon', () => {
    const html = renderMarkup();

    expect(html).toContain('class="select-caret"');
    expect(html).not.toContain('data-icon="chevron-down"');
  });

  describe('Pro affordance (#1523)', () => {
    it('marks Create-new and the edit button as Pro when not licensed for Pro', () => {
      useLicensingStore.setState({ licenseStatus: { tier: 'free', status: 'none' } });

      const html = renderMarkup();

      expect(html).toContain('<option value="__new">Create new curve… (Pro)</option>');
      expect(html).toContain('title="Create or edit ideal curve (Pro)"');
      expect(html).toContain('aria-label="Create or edit ideal curve (Pro)"');
    });

    it('keeps the original labels when tier is pro (valid)', () => {
      useLicensingStore.setState({ licenseStatus: { tier: 'pro', status: 'valid' } });

      const html = renderMarkup();

      expect(html).toContain('<option value="__new">Create new curve…</option>');
      expect(html).toContain('title="Create or edit ideal curve"');
      expect(html).toContain('aria-label="Create or edit ideal curve"');
      expect(html).not.toContain('(Pro)');
    });

    it('keeps the original labels during an active Pro trial', () => {
      useLicensingStore.setState({ licenseStatus: { tier: 'pro', status: 'trial' } });

      const html = renderMarkup();

      expect(html).toContain('<option value="__new">Create new curve…</option>');
      expect(html).not.toContain('(Pro)');
    });

    it('selection (built-in and custom options) stays present regardless of tier', () => {
      useLicensingStore.setState({ licenseStatus: { tier: 'free', status: 'none' } });
      useIdealProfilesStore.setState({ selectedId: 'custom:sanctuary-ref', customProfiles: [customProfile] });

      const html = renderMarkup();

      expect(html).toContain('<option value="flat">Flat / neutral</option>');
      expect(html).toContain('<option value="custom:sanctuary-ref" selected="">Sanctuary reference</option>');
    });
  });
});
