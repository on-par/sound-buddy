import { describe, it, expect } from 'vitest';
import { resolveAppVersion } from './app-version';

describe('resolveAppVersion', () => {
  it('reads the version field from package.json at the given app root', () => {
    const readFile = (filePath: string, encoding: BufferEncoding) => {
      expect(filePath).toBe('/fake/app/package.json');
      expect(encoding).toBe('utf8');
      return JSON.stringify({ name: 'sound-buddy-app', version: '1.2.3' });
    };
    expect(resolveAppVersion('/fake/app', readFile)).toBe('1.2.3');
  });
});
