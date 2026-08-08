// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import ConsoleNetworkConsentDialog from './ConsoleNetworkConsentDialog';
import { useConsoleNetworkConsentStore } from './stores/consoleNetworkConsentStore';

function renderMarkup(): string {
  return renderToString(createElement(ConsoleNetworkConsentDialog));
}

describe('ConsoleNetworkConsentDialog (#378)', () => {
  afterEach(() => {
    useConsoleNetworkConsentStore.setState({ dialogOpen: false });
  });

  it('is hidden (display:none) when the dialog is closed', () => {
    useConsoleNetworkConsentStore.setState({ dialogOpen: false });

    const html = renderMarkup();

    expect(html).toContain('id="console-network-consent-dialog"');
    expect(html).toContain('display:none');
  });

  it('is visible (display:flex) and names exactly what is read when open', () => {
    useConsoleNetworkConsentStore.setState({ dialogOpen: true });

    const html = renderMarkup();

    expect(html).toContain('display:flex');
    expect(html).toContain('channel names');
    expect(html).toContain('channel levels');
    expect(html).toContain('routing configuration');
  });

  it('states OSC/UDP, local-subnet-only, no-cloud-relay, and read-only scope', () => {
    useConsoleNetworkConsentStore.setState({ dialogOpen: true });

    const html = renderMarkup();

    expect(html).toMatch(/OSC\/UDP/);
    expect(html).toMatch(/local network/i);
    expect(html).toMatch(/no cloud relay/i);
    expect(html).toMatch(/Read-only/i);
  });

  it('has no pre-checked control — allow and decline are both plain buttons', () => {
    useConsoleNetworkConsentStore.setState({ dialogOpen: true });

    const html = renderMarkup();

    expect(html).not.toContain('<input');
    expect(html).toContain('id="console-network-consent-allow"');
    expect(html).toContain('id="console-network-consent-decline"');
  });

  it('mentions Settings as the place to revoke', () => {
    useConsoleNetworkConsentStore.setState({ dialogOpen: true });

    const html = renderMarkup();

    expect(html).toMatch(/revoke.*Settings|Settings.*revoke/i);
  });
});
