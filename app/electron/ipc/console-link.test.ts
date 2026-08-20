// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { reduceConsoleLink, INITIAL_CONSOLE_LINK_STATE, type ConsoleLinkState } from './console-link';

describe('INITIAL_CONSOLE_LINK_STATE', () => {
  it('starts unknown with meters not degraded', () => {
    expect(INITIAL_CONSOLE_LINK_STATE).toEqual({ status: 'unknown', metersDegraded: false });
  });
});

describe('reduceConsoleLink', () => {
  it('a heartbeat offline from initial flips status to offline', () => {
    const next = reduceConsoleLink(INITIAL_CONSOLE_LINK_STATE, { type: 'heartbeat', status: 'offline' });

    expect(next).toEqual({ status: 'offline', metersDegraded: false });
  });

  it('a heartbeat online after offline flips status back to online', () => {
    const offline: ConsoleLinkState = { status: 'offline', metersDegraded: false };

    const next = reduceConsoleLink(offline, { type: 'heartbeat', status: 'online' });

    expect(next).toEqual({ status: 'online', metersDegraded: false });
  });

  it('a repeated identical heartbeat returns the same object reference', () => {
    const offline: ConsoleLinkState = { status: 'offline', metersDegraded: false };

    const next = reduceConsoleLink(offline, { type: 'heartbeat', status: 'offline' });

    expect(next).toBe(offline);
  });

  it('a degraded-to-polling subscription event sets metersDegraded', () => {
    const next = reduceConsoleLink(INITIAL_CONSOLE_LINK_STATE, {
      type: 'subscription',
      event: { type: 'degraded-to-polling' },
    });

    expect(next).toEqual({ status: 'unknown', metersDegraded: true });
  });

  it('a reconnect subscription event sets metersDegraded', () => {
    const next = reduceConsoleLink(INITIAL_CONSOLE_LINK_STATE, {
      type: 'subscription',
      event: { type: 'reconnect' },
    });

    expect(next).toEqual({ status: 'unknown', metersDegraded: true });
  });

  it('a second subscription event while already degraded returns the same reference', () => {
    const degraded: ConsoleLinkState = { status: 'unknown', metersDegraded: true };

    const next = reduceConsoleLink(degraded, { type: 'subscription', event: { type: 'reconnect' } });

    expect(next).toBe(degraded);
  });

  it('a meter frame while degraded clears metersDegraded (recovery)', () => {
    const degraded: ConsoleLinkState = { status: 'online', metersDegraded: true };

    const next = reduceConsoleLink(degraded, { type: 'meter-frame' });

    expect(next).toEqual({ status: 'online', metersDegraded: false });
  });

  it('a meter frame while healthy returns the same reference', () => {
    const healthy: ConsoleLinkState = { status: 'online', metersDegraded: false };

    const next = reduceConsoleLink(healthy, { type: 'meter-frame' });

    expect(next).toBe(healthy);
  });

  it('an offline heartbeat does not clear metersDegraded — the two fields are independent', () => {
    const degraded: ConsoleLinkState = { status: 'online', metersDegraded: true };

    const next = reduceConsoleLink(degraded, { type: 'heartbeat', status: 'offline' });

    expect(next).toEqual({ status: 'offline', metersDegraded: true });
  });

  it('a meter frame does not clear offline status — the two fields are independent', () => {
    const offline: ConsoleLinkState = { status: 'offline', metersDegraded: true };

    const next = reduceConsoleLink(offline, { type: 'meter-frame' });

    expect(next).toEqual({ status: 'offline', metersDegraded: false });
  });
});
