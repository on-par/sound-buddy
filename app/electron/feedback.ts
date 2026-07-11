// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { app, shell } from 'electron';
import { logWarn } from './logger';

export const FEEDBACK_EMAIL = 'support@soundbuddy.online';

export function feedbackMailtoUrl(appVersion: string, osVersion: string): string {
  const subject = 'Sound Buddy Feedback';
  const body = `\n\n---\nApp version: ${appVersion}\nmacOS: ${osVersion}`;
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export async function openFeedback(): Promise<void> {
  const url = feedbackMailtoUrl(app.getVersion(), process.getSystemVersion());
  try {
    await shell.openExternal(url);
  } catch (err) {
    logWarn(`feedback mailto failed: ${String(err)}`);
  }
}
