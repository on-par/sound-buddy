// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { app, shell } from 'electron';
import * as fs from 'fs';
import { getLogFilePath, logWarn } from './logger';

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

// #144: "Attach diagnostics" reveals the log file in Finder so the user can
// drag it into the feedback email themselves — a mailto: link can't carry an
// attachment, and the log never leaves the machine unless the user does that.
export type RevealDiagnosticsResult = { revealed: boolean; missing?: boolean };

export function revealDiagnosticLog(): RevealDiagnosticsResult {
  const p = getLogFilePath();
  if (!p || !fs.existsSync(p)) {
    logWarn('reveal diagnostics: log file does not exist yet');
    return { revealed: false, missing: true };
  }
  shell.showItemInFolder(p);
  return { revealed: true };
}
