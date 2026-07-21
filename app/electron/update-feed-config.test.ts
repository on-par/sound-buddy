// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Guards the electron-updater feed configuration (#625): electron-builder
// generates release/latest-mac.yml from the `publish:` block below and bakes
// Contents/Resources/app-update.yml into the .app, so electron-updater
// resolves the update feed with zero runtime configuration. This test reads
// electron-builder.yml as text so the shipped feed config is unit-testable
// without cutting a real release.
const appRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const builderConfig = fs.readFileSync(path.join(appRoot, 'electron-builder.yml'), 'utf8');

describe('electron-builder.yml update feed config (#625)', () => {
  it('declares a publish: block targeting the public releases repo', () => {
    expect(builderConfig).toMatch(/^publish:\s*$/m);
    expect(builderConfig).toMatch(/^\s*provider:\s*github\s*$/m);
    expect(builderConfig).toMatch(/^\s*owner:\s*on-par\s*$/m);
    expect(builderConfig).toMatch(/^\s*repo:\s*sound-buddy-releases\s*$/m);
  });

  it('carries no token or private flag (the downloads repo is public — AC3)', () => {
    expect(builderConfig).not.toMatch(/token:/);
    expect(builderConfig).not.toMatch(/^\s*private:\s*true\s*$/m);
  });

  it('mac.artifactName contains no space (GitHub rewrites spaces to dots on upload)', () => {
    const match = builderConfig.match(/^\s*artifactName:\s*(\S+)\s*$/m);
    expect(match).not.toBeNull();
    expect(match![1]).not.toContain(' ');
    expect(match![1]).toContain('Sound.Buddy');
  });

  it('dmg.artifactName matches the existing published DMG name', () => {
    expect(builderConfig).toMatch(/artifactName:\s*Sound\.Buddy-\$\{version\}-\$\{arch\}\.\$\{ext\}/);
  });

  it('narrows the node_modules exclusion to @sound-buddy (no blanket exclusion)', () => {
    expect(builderConfig).not.toMatch(/^\s*-\s*"!node_modules\/\*\*"\s*$/m);
    expect(builderConfig).toMatch(/^\s*-\s*"!node_modules\/@sound-buddy\/\*\*"\s*$/m);
  });
});
