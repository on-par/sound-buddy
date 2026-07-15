// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { StoreApi, UseBoundStore } from 'zustand';

// Subscribes directly via useSyncExternalStore instead of calling the bound
// hook (`store(selector)`) so both the client and "server" snapshot read the
// live store — zustand's own bound hook uses `getInitialState()` (the state
// at `create()` time, frozen forever) as its server snapshot, which is only
// correct for real SSR-then-hydrate apps. This app is Electron-only and
// never server-renders in production; `renderToString` is a test-only
// technique (no jsdom — see CLAUDE.md) for rendering components whose store
// state was set via `store.setState(...)` before the render call, which
// needs the live state, not the frozen initial one.
export function useStoreShallow<S, T>(
  store: UseBoundStore<StoreApi<S>>,
  selector: (state: S) => T
): T {
  const shallowSelector = useShallow(selector);
  const getSnapshot = () => shallowSelector(store.getState());
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
