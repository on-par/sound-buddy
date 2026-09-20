// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure fold for Analyze's live-listening room-mic EQ view (#1469, lc-06):
// resolves {listening, appMode, secondary, override} into what
// AnalyzeLiveEqPanel.tsx renders. `listening` (analyzeEntryStore) is the
// explicit, only gate for visibility — never inferred from
// secondary.status === 'active', which is also true for a Settings-started
// room mic during a Session capture (measurement-device-state.ts). A 'room'
// view is reachable ONLY from status 'active', so a DISCONNECTED (or
// blocked/starting/off) secondary source always falls through to 'notice'
// instead of rendering the last override it ever had — AC3 (no frozen curve
// once disconnected) is structural, not conventional.

import { secondaryStatusHTML, type SecondaryMeasurementState } from './measurement-device-state';
import type { EqPaneRoomOverride } from './live-capture-panel';

export interface AnalyzeLiveEqInput {
  listening: boolean;
  appMode: string;
  secondary: SecondaryMeasurementState;
  override: EqPaneRoomOverride | null;
}

export type AnalyzeLiveEqView =
  | { kind: 'hidden' }
  | { kind: 'notice'; text: string }
  | { kind: 'room'; override: EqPaneRoomOverride };

// Analyze's live-listening EQ never appears while the Session (live)
// workspace is active — LiveEqPane's docked pane owns that screen (AC2) —
// so this island and the docked pane are never both visible at once.
export function analyzeLiveEqView(input: AnalyzeLiveEqInput): AnalyzeLiveEqView {
  if (!input.listening || input.appMode === 'live') return { kind: 'hidden' };
  if (input.secondary.status === 'active' && input.override) {
    return { kind: 'room', override: input.override };
  }
  return { kind: 'notice', text: secondaryStatusHTML(input.secondary) };
}
