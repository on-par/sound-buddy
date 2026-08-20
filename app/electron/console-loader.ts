// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Loads the @sound-buddy/console OSC helpers (#876+) from the packaged app's
// Contents/Resources/console directory. The app excludes node_modules/@sound-buddy
// from app.asar, so Electron main must use the same bundled CJS loader pattern
// as engine, license-policy, and scene-inspector.

import { bundledResourceDir, loadBundledCjs } from './bundled-cjs-loader';

type ConsoleModule = typeof import('../../packages/console/dist-cjs/index');

export function consoleModuleDir(): string {
  return bundledResourceDir('console');
}

export function loadConsoleModule(): ConsoleModule {
  return loadBundledCjs<ConsoleModule>('console');
}
