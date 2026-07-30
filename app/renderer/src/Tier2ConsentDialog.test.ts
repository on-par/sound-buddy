// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Tier2ConsentDialog from './Tier2ConsentDialog';
import { ElectronContext } from './useElectron';
import { createMockSoundBuddy } from './mock-sound-buddy';

describe('Tier2ConsentDialog (#378)', () => {
  it('renders hidden until a Tier 2 feature explicitly requests access', () => {
    const mock = createMockSoundBuddy();
    const html = renderToString(
      createElement(ElectronContext.Provider, { value: mock.api }, createElement(Tier2ConsentDialog))
    );
    expect(html).toContain('id="tier2-consent-dialog"');
    expect(html).toContain('style="display:none"');
    expect(html).toContain('channel names, levels, and routing configuration');
    expect(html).toContain('Allow read-only local access');
  });
});
