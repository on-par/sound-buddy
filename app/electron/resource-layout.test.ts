// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import RESOURCE_LAYOUT from './resource-layout.json';

const config = parseYaml(fs.readFileSync(path.join(__dirname, '..', 'electron-builder.yml'), 'utf8'));

describe('electron-builder.yml resource entries match resource-layout.json (#745)', () => {
  it('mac.signIgnore has exactly one entry per RESOURCE_LAYOUT subdirectory', () => {
    const expected = Object.values(RESOURCE_LAYOUT)
      .map((entry) => `Contents/Resources/${entry.resourcesSubdir}/`)
      .sort();
    expect([...config.mac.signIgnore].sort()).toEqual(expected);
  });

  it('extraResources matches every RESOURCE_LAYOUT entry with an extraResourceFrom', () => {
    const expected = Object.values(RESOURCE_LAYOUT)
      .filter((entry) => entry.extraResourceFrom !== null)
      .map((entry) => ({ from: entry.extraResourceFrom, to: entry.resourcesSubdir, filter: ['**/*'] }))
      .sort((a, b) => a.to.localeCompare(b.to));
    const actual = [...config.extraResources].sort((a, b) => a.to.localeCompare(b.to));
    expect(actual).toEqual(expected);
  });
});
