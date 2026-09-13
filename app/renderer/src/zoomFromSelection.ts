// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Fit sel selection-to-zoom bridge (#1395). A leaf module on purpose — modelled
// directly on loopFromSelection.ts (#1317): it imports only the type from
// ./time-selection, not the shared instance, so the caller supplies the model (live at
// call time, not render time) and this stays testable without a DOM or a React render.

import { type TimeSelectionModel, type TimeSelectionRange } from './time-selection';

/** The TimelineZoomContext.selection applyTimelineZoom's zoom-to-selection action should
 *  use for this click: the live drawn selection when one exists, otherwise the loaded
 *  take's full span, otherwise null so applyTimelineZoom's own insert-marker fallback
 *  applies (ADR-0109's fallback ladder — supplied selection -> take span -> insert-marker
 *  window). Reads timeSelection live (via getSelection(), not a value captured at the last
 *  React render) so a selection drawn without a re-render since is not missed. */
export function zoomSelectionAtAction(
  timeSelection: TimeSelectionModel,
  takeSecs: number,
): TimeSelectionRange | null {
  const selection = timeSelection.getSelection();
  if (selection !== null) return selection;
  return takeSecs > 0 ? { startSecs: 0, endSecs: takeSecs } : null;
}
