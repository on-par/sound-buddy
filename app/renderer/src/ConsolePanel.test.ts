// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import ConsolePanel from './ConsolePanel';
import { useConsoleStore } from './stores/consoleStore';
import { useLiveCaptureStore } from './stores/liveCaptureStore';

const CONSOLE_A = { ip: '10.0.0.5', model: 'M32R', firmware: '4.0' };
const CONSOLE_B = { ip: '10.0.0.9', model: 'M32R', firmware: '4.0' };
const IDENTITY_A = { ip: '10.0.0.5', model: 'M32R', firmware: '4.0', name: 'Main Console' };

const CONSOLE_INITIAL_STATE = {
  scanStatus: 'idle' as const,
  found: [],
  scanError: null,
  selectedIp: null,
  identity: null,
  identitySource: null,
  identityStatus: 'idle' as const,
  identityError: null,
  manualIp: '',
};

function renderMarkup(): string {
  return renderToString(createElement(ConsolePanel));
}

afterEach(() => {
  useConsoleStore.setState({ ...CONSOLE_INITIAL_STATE });
  useLiveCaptureStore.setState({ appMode: 'live' });
});

describe('ConsolePanel (#884)', () => {
  it('renders nothing when not on the Live tab', () => {
    useLiveCaptureStore.setState({ appMode: 'reportcard' });

    const html = renderMarkup();

    expect(html).toBe('');
  });

  it('lists every console the scan found, with IP and model', () => {
    useLiveCaptureStore.setState({ appMode: 'live' });
    useConsoleStore.setState({ scanStatus: 'done', found: [CONSOLE_A, CONSOLE_B] });

    const html = renderMarkup();

    expect(html).toContain('id="console-found"');
    expect(html).toContain(CONSOLE_A.ip);
    expect(html).toContain(CONSOLE_A.model);
    expect(html).toContain(CONSOLE_B.ip);
  });

  it('marks the selected console current in the found list', () => {
    useConsoleStore.setState({ scanStatus: 'done', found: [CONSOLE_A, CONSOLE_B], selectedIp: CONSOLE_A.ip });

    const html = renderMarkup();

    expect(html).toMatch(/data-console-ip="10\.0\.0\.5"[^>]*aria-current="true"/);
  });

  it('shows a loading line while the identity read is in flight', () => {
    useConsoleStore.setState({ identityStatus: 'loading' });

    const html = renderMarkup();

    expect(html).toContain('id="console-identity-loading"');
    expect(html).toMatch(/Reading console identity/);
  });

  it('shows the full identity once loaded — name, model, firmware, IP', () => {
    useConsoleStore.setState({ identityStatus: 'loaded', identity: IDENTITY_A, identitySource: 'scan' });

    const html = renderMarkup();

    expect(html).toContain('id="console-identity"');
    expect(html).toContain(IDENTITY_A.name);
    expect(html).toContain(IDENTITY_A.model);
    expect(html).toContain(IDENTITY_A.firmware);
    expect(html).toContain(IDENTITY_A.ip);
  });

  it('renders an em dash for a missing optional name', () => {
    useConsoleStore.setState({
      identityStatus: 'loaded',
      identity: { ip: '10.0.0.5', model: 'M32R', firmware: '4.0' },
      identitySource: 'scan',
    });

    const html = renderMarkup();

    expect(html).toContain('—');
  });

  it('labels a manually-entered identity as the secondary path', () => {
    useConsoleStore.setState({ identityStatus: 'loaded', identity: IDENTITY_A, identitySource: 'manual' });

    const html = renderMarkup();

    expect(html).toContain('id="console-identity-source"');
    expect(html).toMatch(/Secondary/);
  });

  it('does not show the secondary tag for a scan-sourced identity', () => {
    useConsoleStore.setState({ identityStatus: 'loaded', identity: IDENTITY_A, identitySource: 'scan' });

    const html = renderMarkup();

    expect(html).not.toContain('id="console-identity-source"');
  });

  it('disables the scan button while scanning', () => {
    useConsoleStore.setState({ scanStatus: 'scanning' });

    const html = renderMarkup();

    expect(html).toContain('id="console-scan"');
    expect(html).toMatch(/id="console-scan"[^>]*disabled/);
    expect(html).toContain('Scanning…');
  });

  it('renders scanError in a role="alert" node', () => {
    useConsoleStore.setState({ scanStatus: 'error', scanError: "Couldn't scan for a console." });

    const html = renderMarkup();

    expect(html).toContain('id="console-scan-error"');
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/scan for a console/);
  });

  it('renders identityError in a role="alert" node', () => {
    useConsoleStore.setState({ identityStatus: 'error', identityError: 'No reply from the console.' });

    const html = renderMarkup();

    expect(html).toContain('id="console-identity-error"');
    expect(html).toContain('No reply from the console.');
  });

  it('shows a fallback pointer to manual entry when a scan completes with nothing found', () => {
    useConsoleStore.setState({ scanStatus: 'done', found: [] });

    const html = renderMarkup();

    expect(html).toContain('id="console-scan-empty"');
    expect(html).not.toContain('id="console-found"');
  });

  it('the manual IP input and submit button are always present as the fallback path', () => {
    const html = renderMarkup();

    expect(html).toContain('id="console-manual-ip"');
    expect(html).toContain('id="console-manual-submit"');
  });

  it('disables the manual submit button while the manual IP is empty', () => {
    useConsoleStore.setState({ manualIp: '' });

    const html = renderMarkup();

    expect(html).toMatch(/id="console-manual-submit"[^>]*disabled/);
  });

  it('enables the manual submit button once an IP is entered', () => {
    useConsoleStore.setState({ manualIp: '192.168.1.50' });

    const html = renderMarkup();

    expect(html).not.toMatch(/id="console-manual-submit"[^>]*disabled/);
  });

  it('states the read-only guarantee', () => {
    const html = renderMarkup();

    expect(html).toContain('console-readonly-note');
    expect(html).toMatch(/only reads/i);
  });

  it('never renders the word "capture" anywhere in the markup', () => {
    useConsoleStore.setState({ scanStatus: 'done', found: [CONSOLE_A] });

    const html = renderMarkup();

    expect(html).not.toMatch(/capture/i);
  });
});
