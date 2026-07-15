// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { useShallow } from 'zustand/react/shallow';
import type { StoreApi, UseBoundStore } from 'zustand';

export function useStoreShallow<S, T>(
  store: UseBoundStore<StoreApi<S>>,
  selector: (state: S) => T
): T {
  return store(useShallow(selector));
}
