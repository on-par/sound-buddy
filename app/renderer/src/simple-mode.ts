// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type { AppSettings } from '../../electron/ipc/api';
import type { ModeSwitchRequest } from './mode-switch';

export const ALL_TAB_MODES: readonly ModeSwitchRequest[] = ['analyze', 'history', 'dir', 'live', 'console', 'recent', 'guide', 'ringout', 'reportcard'];
const SIMPLE_TAB_MODES: readonly ModeSwitchRequest[] = ['analyze', 'history', 'reportcard'];

export function isSimpleMode(settings: AppSettings | null): boolean {
  return settings !== null
    && settings.advancedFeaturesEnabled === false
    && settings.reportFirstUxEnabled !== true;
}

export function visibleTabModes(settings: AppSettings | null): readonly ModeSwitchRequest[] {
  return isSimpleMode(settings) ? SIMPLE_TAB_MODES : ALL_TAB_MODES;
}

export function clampBootMode(mode: string, settings: AppSettings | null): string {
  return visibleTabModes(settings).includes(mode as ModeSwitchRequest) ? mode : 'reportcard';
}
