// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type { AppSettings } from '../../electron/ipc/api';
import type { ModeSwitchRequest } from './mode-switch';

export const ALL_TAB_MODES: readonly ModeSwitchRequest[] = ['analyze', 'history', 'dir', 'live', 'console', 'recent', 'guide', 'ringout'];
const SIMPLE_TAB_MODES: readonly ModeSwitchRequest[] = ['analyze', 'history'];

export function isSimpleMode(settings: AppSettings | null): boolean {
  return settings !== null
    && settings.advancedFeaturesEnabled === false;
}

export function visibleTabModes(settings: AppSettings | null): readonly ModeSwitchRequest[] {
  return isSimpleMode(settings) ? SIMPLE_TAB_MODES : ALL_TAB_MODES;
}

// #1510: the fallback used to be 'reportcard', but Report Card is no longer
// a visible tab in any mode (#1512 Simple, #1507 Advanced) and its results
// now live in Analyze's results rail (#1505) — mode-switch.ts's
// showAnalyzeStage() is what actually paints the 'analyze' fallback onto the
// screen.
export function clampBootMode(mode: string, settings: AppSettings | null): string {
  return visibleTabModes(settings).includes(mode as ModeSwitchRequest) ? mode : 'analyze';
}
