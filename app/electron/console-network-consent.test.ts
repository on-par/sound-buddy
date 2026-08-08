// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  hasConsoleNetworkConsent,
  assertConsoleNetworkConsent,
  ConsoleNetworkConsentError,
  CONSOLE_NETWORK_CONSENT_SCOPE,
} from './console-network-consent';

describe('CONSOLE_NETWORK_CONSENT_SCOPE (#378)', () => {
  it('names exactly channel names, channel levels, and routing configuration', () => {
    expect(CONSOLE_NETWORK_CONSENT_SCOPE).toEqual(['channel names', 'channel levels', 'routing configuration']);
  });
});

describe('hasConsoleNetworkConsent (#378)', () => {
  it('returns false when consent has not been granted', () => {
    expect(hasConsoleNetworkConsent({ consoleNetworkConsentGranted: false })).toBe(false);
  });

  it('returns false defensively for a corrupted/missing value', () => {
    expect(
      hasConsoleNetworkConsent({ consoleNetworkConsentGranted: undefined as unknown as boolean })
    ).toBe(false);
  });

  it('returns true only when consent has been granted', () => {
    expect(hasConsoleNetworkConsent({ consoleNetworkConsentGranted: true })).toBe(true);
  });
});

describe('assertConsoleNetworkConsent (#378)', () => {
  it('throws a ConsoleNetworkConsentError mentioning consent when not granted', () => {
    expect(() => assertConsoleNetworkConsent({ consoleNetworkConsentGranted: false })).toThrow(
      ConsoleNetworkConsentError
    );
    expect(() => assertConsoleNetworkConsent({ consoleNetworkConsentGranted: false })).toThrow(/consent/i);
  });

  it('does not throw when consent has been granted', () => {
    expect(() => assertConsoleNetworkConsent({ consoleNetworkConsentGranted: true })).not.toThrow();
  });
});

// License/Stripe decoupling requirement (#378): the console-network consent
// gate must never import license/licensing code, and vice versa, so the two
// concerns can never accidentally couple.
describe('license/Stripe decoupling (#378)', () => {
  const electronDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
  const gateSource = fs.readFileSync(path.join(electronDir, 'console-network-consent.ts'), 'utf8');
  const licenseSource = fs.readFileSync(path.join(electronDir, 'license.ts'), 'utf8');
  const licensingIpcSource = fs.readFileSync(path.join(electronDir, 'ipc', 'licensing.ts'), 'utf8');

  it('console-network-consent.ts does not import license/licensing code', () => {
    expect(gateSource).not.toMatch(/(?:from\s+['"]|require\(['"])\.\.?\/(?:ipc\/)?licens/);
  });

  it('license.ts does not import console-network-consent', () => {
    expect(licenseSource).not.toMatch(/console-network-consent/);
  });

  it('ipc/licensing.ts does not import console-network-consent', () => {
    expect(licensingIpcSource).not.toMatch(/console-network-consent/);
  });
});
