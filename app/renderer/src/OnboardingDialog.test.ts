// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import OnboardingDialog from './OnboardingDialog';
import { useOnboardingStore } from './stores/onboardingStore';
import { useSettingsStore } from './stores/settingsStore';
import type { AppSettings } from '../../electron/ipc/api';

function renderMarkup(): string {
  return renderToString(createElement(OnboardingDialog));
}

const DEFAULT_STATE = {
  dialogOpen: false,
  phase: 'actions' as const,
  copyOverride: null as string | null,
  runButtonLabel: 'Run your first analysis',
};
const DEFAULT_COPY_PREFIX = 'Sound Buddy scores your mix';
const SIMPLE_COPY = 'Drop last Sunday&#x27;s recording on the Report Card panel - or click Analyze - and Sound Buddy hands back a report card telling you what to fix.';

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    advancedFeaturesEnabled: true,
    ...overrides,
  } as AppSettings;
}

describe('OnboardingDialog', () => {
  afterEach(() => {
    useOnboardingStore.setState(DEFAULT_STATE);
    useSettingsStore.setState({ settings: null, settingsError: null });
  });

  it('is hidden (display:none) when the dialog is closed', () => {
    useOnboardingStore.setState({ ...DEFAULT_STATE, dialogOpen: false });

    const html = renderMarkup();

    expect(html).toContain('id="onboarding-dialog"');
    expect(html).toContain('display:none');
  });

  it('is visible (display:flex) with the default welcome copy when open', () => {
    useOnboardingStore.setState({ ...DEFAULT_STATE, dialogOpen: true });

    const html = renderMarkup();

    expect(html).toContain('display:flex');
    expect(html).toContain('Welcome to Sound Buddy');
    expect(html).toContain(DEFAULT_COPY_PREFIX);
    expect(html).toContain('Run your first analysis');
  });

  it('uses the one-sentence Simple mode copy when advanced features are off', () => {
    useOnboardingStore.setState({ ...DEFAULT_STATE, dialogOpen: true });
    useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: false }) });

    const html = renderMarkup();

    expect(html).toContain(SIMPLE_COPY);
    expect(html).not.toContain(DEFAULT_COPY_PREFIX);
    expect(html).toContain('id="onboarding-skip"');
    expect(html).toContain('id="onboarding-run"');
  });

  it('keeps the default copy in Advanced mode', () => {
    useOnboardingStore.setState({ ...DEFAULT_STATE, dialogOpen: true });
    useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: true }) });

    const html = renderMarkup();

    expect(html).toContain(DEFAULT_COPY_PREFIX);
    expect(html).not.toContain(SIMPLE_COPY);
    expect(html).toContain('id="onboarding-skip"');
    expect(html).toContain('id="onboarding-run"');
  });

  it('shows the copyOverride and "Try again" label after a failed analysis in Advanced mode', () => {
    useOnboardingStore.setState({
      ...DEFAULT_STATE,
      dialogOpen: true,
      copyOverride: 'That didn’t work — try again.',
      runButtonLabel: 'Try again',
    });
    useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: true }) });

    const html = renderMarkup();

    expect(html).toContain('That didn’t work — try again.');
    expect(html).not.toContain(DEFAULT_COPY_PREFIX);
    expect(html).toContain('Try again');
  });

  it('lets copyOverride win over the Simple mode copy after a failed analysis', () => {
    useOnboardingStore.setState({
      ...DEFAULT_STATE,
      dialogOpen: true,
      copyOverride: 'That didn’t work — try again.',
      runButtonLabel: 'Try again',
    });
    useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: false }) });

    const html = renderMarkup();

    expect(html).toContain('That didn’t work — try again.');
    expect(html).not.toContain(SIMPLE_COPY);
    expect(html).not.toContain(DEFAULT_COPY_PREFIX);
    expect(html).toContain('Try again');
  });

  it('shows the progress row and hides actions styling only via phase, not unmount', () => {
    useOnboardingStore.setState({ ...DEFAULT_STATE, dialogOpen: true, phase: 'progress' });

    const html = renderMarkup();

    expect(html).toMatch(/id="onboarding-progress"[^>]*style="display:flex"/);
  });

  it('hides the progress row while in the actions phase', () => {
    useOnboardingStore.setState({ ...DEFAULT_STATE, dialogOpen: true, phase: 'actions' });

    const html = renderMarkup();

    expect(html).toMatch(/id="onboarding-progress"[^>]*style="display:none"/);
  });

  it('renders icons inline rather than via data-icon', () => {
    useOnboardingStore.setState({ ...DEFAULT_STATE, dialogOpen: true });

    const html = renderMarkup();

    expect(html).not.toContain('data-icon="waveform"');
  });
});
