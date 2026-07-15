// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Deterministic app version (#402): Electron has no app.setVersion(), and
// unpackaged app.getVersion()'s own resolution is environment-dependent — it
// can fall back to Electron's own bundled version instead of reading
// package.json depending on how the main script is launched (observed: the
// AI Engineer dialog's version check passed locally by coincidence, since
// Electron's own version happens to be semver-shaped, but returned a bare
// "0.0" in CI). ipc/settings.ts's get-app-version handler reads the version
// explicitly via this instead of app.getVersion(), so the AI Engineer dialog
// (#202) always shows the real app version. Packaged builds resolve the same
// way: electron-builder ships package.json alongside dist/ inside the asar
// (see electron-builder.yml's `files` list), so the relative app root holds.

import * as fs from 'fs';
import * as path from 'path';

export function resolveAppVersion(
  appRoot: string,
  readFile: (filePath: string, encoding: BufferEncoding) => string = fs.readFileSync
): string {
  const pkg = JSON.parse(readFile(path.join(appRoot, 'package.json'), 'utf8')) as { version: string };
  return pkg.version;
}
