// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import OnboardingDialog from './OnboardingDialog';
import { useOnboardingStore } from './stores/onboardingStore';

function renderMarkup(): string {
  return renderToString(createElement(OnboardingDialog));
}

const DEFAULT_STATE = {
  dialogOpen: false,
  phase: 'actions' as const,
  copyOverride: null as string | null,
  runButtonLabel: 'Run your first analysis',
};

describe('OnboardingDialog', () => {
  afterEach(() => {
    useOnboardingStore.setState(DEFAULT_STATE);
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
    expect(html).toContain('Sound Buddy scores your mix');
    expect(html).toContain('Run your first analysis');
  });

  it('shows the copyOverride and "Try again" label after a failed analysis', () => {
    useOnboardingStore.setState({
      ...DEFAULT_STATE,
      dialogOpen: true,
      copyOverride: 'That didn’t work — try again.',
      runButtonLabel: 'Try again',
    });

    const html = renderMarkup();

    expect(html).toContain('That didn’t work — try again.');
    expect(html).not.toContain('Sound Buddy scores your mix');
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
