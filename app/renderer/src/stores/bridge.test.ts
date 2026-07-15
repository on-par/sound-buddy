// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { installStoreBridge, type RendererStores } from './bridge';
import { useLicensingStore } from './licensingStore';
import { useSettingsStore } from './settingsStore';

describe('installStoreBridge', () => {
  it('installs both stores on the injected target and returns them', () => {
    const target: { rendererStores?: RendererStores } = {};

    const stores = installStoreBridge(target);

    expect(stores.licensing).toBe(useLicensingStore);
    expect(stores.settings).toBe(useSettingsStore);
    expect(target.rendererStores).toBe(stores);
  });

  it('exposes getState/subscribe on the installed target', () => {
    const target: { rendererStores?: RendererStores } = {};

    installStoreBridge(target);

    expect(target.rendererStores!.licensing.getState().isLicensed).toBe(false);
    expect(typeof target.rendererStores!.settings.subscribe).toBe('function');
  });
});
