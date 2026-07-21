import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn(async () => {}) },
}));

import { shell } from 'electron';
import { openReleasePage } from './updater';

const RELEASES_PAGE = 'https://github.com/on-par/sound-buddy-releases/releases/latest';

describe('openReleasePage', () => {
  it('opens the given URL', () => {
    openReleasePage('https://example.com/x');

    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/x');
  });

  it('falls back to the releases page when no URL is given', () => {
    openReleasePage();

    expect(shell.openExternal).toHaveBeenCalledWith(RELEASES_PAGE);
  });
});
