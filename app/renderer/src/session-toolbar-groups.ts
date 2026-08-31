// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Session toolbar's grouping (#1347): `.daw-transport` wraps only between
// groups, never within one, so every control emitted into the transport row
// must be wrapped by sessionToolbarGroupHTML instead of appended as a bare
// child. An absent cluster (e.g. no session loaded yet) passes '' and emits
// nothing, so no stray divider or empty group survives into the DOM. No
// escaping is applied — every interpolation here is one of this module's own
// literals or markup already built by a sibling view module.

export type SessionToolbarGroupKey =
  | 'transport' | 'tempo' | 'view' | 'tracks' | 'session' | 'capture';

export const SESSION_TOOLBAR_GROUP_LABELS: Readonly<Record<SessionToolbarGroupKey, string>> =
  Object.freeze({
    transport: 'Session status',
    tempo: 'Tempo',
    view: 'Timeline view',
    tracks: 'Tracks',
    session: 'Recorded session',
    capture: 'Capture',
  });

export function sessionToolbarGroupHTML(key: SessionToolbarGroupKey, innerHTML: string): string {
  if (innerHTML === '') return '';
  return `<div class="daw-transport-group daw-transport-group--${key}" role="group" `
    + `aria-label="${SESSION_TOOLBAR_GROUP_LABELS[key]}">${innerHTML}</div>`;
}
