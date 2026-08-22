// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { recordButtonView, recordButtonAction, sessionTabCaptureHTML } from './record-transport';

describe('recordButtonView', () => {
  it('maps idle and monitoring to enabled Record controls', () => {
    const view = recordButtonView('idle');
    // The record button is a no-text red-circle toggle (#777): the view model
    // no longer carries a visible label, only the a11y label.
    expect(view).toEqual({
      phase: 'idle',
      disabled: false,
      ariaLabel: 'Record — press to start recording',
    });
    expect(recordButtonView('monitoring')).toEqual({
      phase: 'monitoring',
      disabled: false,
      ariaLabel: 'Record — press to start recording',
    });
  });

  it('maps starting-record to a disabled Record control', () => {
    const view = recordButtonView('starting-record');
    expect(view).toEqual({
      phase: 'starting-record',
      disabled: true,
      ariaLabel: 'Starting recording',
    });
  });

  it('maps recording to an enabled Stop control', () => {
    const view = recordButtonView('recording');
    expect(view).toEqual({
      phase: 'recording',
      disabled: false,
      ariaLabel: 'Recording — press to stop',
    });
  });

  it('maps stopping to a disabled pressed control', () => {
    const view = recordButtonView('stopping');
    expect(view).toEqual({
      phase: 'stopping',
      disabled: true,
      ariaLabel: 'Stopping recording',
    });
  });
});

describe('recordButtonAction', () => {
  it('returns record for enabled idle or monitoring phases', () => {
    expect(recordButtonAction('idle')).toBe('record');
    expect(recordButtonAction('monitoring')).toBe('record');
  });

  it('returns stop for recording', () => {
    expect(recordButtonAction('recording')).toBe('stop');
  });

  it('returns null for transitional phases', () => {
    expect(recordButtonAction('starting-record')).toBeNull();
    expect(recordButtonAction('stopping')).toBeNull();
  });
});

describe('sessionTabCaptureHTML', () => {
  it('renders the shared Record view with stable, accessible markup', () => {
    expect(sessionTabCaptureHTML(recordButtonView('monitoring'))).toContain('id="daw-session-record"');
    expect(sessionTabCaptureHTML(recordButtonView('monitoring'))).toContain('aria-label="Record — press to start recording"');
    expect(sessionTabCaptureHTML(recordButtonView('monitoring'))).toContain('aria-pressed="false"');
  });

  it('renders pressed Stop and disabled transition states from the same view', () => {
    expect(sessionTabCaptureHTML(recordButtonView('recording'))).toContain('aria-pressed="true"');
    expect(sessionTabCaptureHTML(recordButtonView('recording'))).toContain('>Stop<');
    const stopping = sessionTabCaptureHTML(recordButtonView('stopping'));
    expect(stopping).toContain('daw-session-record--stopping');
    expect(stopping).toContain('aria-label="Stopping recording"');
    expect(stopping).toContain('aria-pressed="true"');
    expect(stopping).toContain(' disabled');

    const starting = sessionTabCaptureHTML(recordButtonView('starting-record'));
    expect(starting).toContain('daw-session-record--starting-record');
    expect(starting).toContain('aria-label="Starting recording"');
    expect(starting).toContain('aria-pressed="false"');
    expect(starting).toContain(' disabled');
  });
});
