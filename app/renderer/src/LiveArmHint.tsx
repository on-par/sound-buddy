// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The inline "arm at least one strip" hint near the Start button (#43) —
// TD-001 slice 6h (#711): ported off inline-app.js's DOM-writing
// showArmHint/hideArmHint onto liveCaptureStore.armHint (the 6i
// capture-lifecycle callbacks write the store; this island renders #arm-hint
// reactively). Portaled by App.tsx onto #arm-hint-island. The React span
// keeps the id/class/role so #arm-hint e2e locators and the .arm-hint styles
// apply unchanged.

import type { JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';

export default function LiveArmHint(): JSX.Element {
  // useStoreShallow (not the bound hook) so renderToString reads the live
  // store — see useStoreShallow.ts's header for why zustand's own hook can't.
  const armHint = useStoreShallow(useLiveCaptureStore, (s) => s.armHint);
  return (
    <div
      id="arm-hint"
      className="arm-hint"
      role="alert"
      style={{ display: armHint.visible ? 'block' : 'none' }}
    >
      {armHint.text}
    </div>
  );
}
