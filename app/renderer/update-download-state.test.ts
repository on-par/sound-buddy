import { describe, it, expect } from 'vitest';

// update-download-state.js is a plain classic script (window.updateDownloadState
// in the browser, module.exports under Node) so its pure view-model logic is
// exercised here without a DOM.
const { BYTES_PER_MB, formatBytes, viewFor } = require('./update-download-state.js') as {
  BYTES_PER_MB: number;
  formatBytes: (n: number) => string;
  viewFor: (
    status:
      | { state: string; receivedBytes?: number; totalBytes?: number; percent?: number; message?: string }
      | null,
    info: { version: string }
  ) => {
    text: string;
    primary: { label: string; action: string } | null;
    showCancel: boolean;
    showProgress: boolean;
    percent: number;
    indeterminate: boolean;
  };
};

const INFO = { version: '1.4.2' };

describe('formatBytes', () => {
  it('formats bytes as MB to one decimal', () => {
    expect(formatBytes(12.34 * BYTES_PER_MB)).toBe('12.3 MB');
  });

  it('rounds to one decimal', () => {
    expect(formatBytes(1.05 * BYTES_PER_MB)).toBe('1.1 MB');
  });

  it('formats zero bytes', () => {
    expect(formatBytes(0)).toBe('0.0 MB');
  });
});

describe('viewFor', () => {
  it('offer view when status is null (update just offered)', () => {
    const view = viewFor(null, INFO);
    expect(view).toEqual({
      text: 'Sound Buddy 1.4.2 is available.',
      primary: { label: 'Download', action: 'download' },
      showCancel: false,
      showProgress: false,
      percent: 0,
      indeterminate: false,
    });
  });

  it('downloading view with a known total shows percent and byte counts', () => {
    const status = { state: 'downloading', receivedBytes: 5 * BYTES_PER_MB, totalBytes: 10 * BYTES_PER_MB, percent: 50 };
    const view = viewFor(status, INFO);
    expect(view).toEqual({
      text: 'Downloading Sound Buddy 1.4.2… 50% (5.0 MB of 10.0 MB)',
      primary: null,
      showCancel: false,
      showProgress: true,
      percent: 50,
      indeterminate: false,
    });
  });

  it('downloading view with an unknown total is indeterminate and shows received bytes only', () => {
    const status = { state: 'downloading', receivedBytes: 3 * BYTES_PER_MB, totalBytes: 0, percent: 0 };
    const view = viewFor(status, INFO);
    expect(view).toEqual({
      text: 'Downloading Sound Buddy 1.4.2… 3.0 MB',
      primary: null,
      showCancel: false,
      showProgress: true,
      percent: 0,
      indeterminate: true,
    });
  });

  it('done view offers Restart to Update', () => {
    const view = viewFor({ state: 'done' }, INFO);
    expect(view).toEqual({
      text: 'Sound Buddy 1.4.2 downloaded — restart to install.',
      primary: { label: 'Restart to Update', action: 'install' },
      showCancel: false,
      showProgress: false,
      percent: 0,
      indeterminate: false,
    });
  });

  it('error view surfaces the message and offers Retry', () => {
    const view = viewFor({ state: 'error', message: 'download failed — try again' }, INFO);
    expect(view).toEqual({
      text: 'download failed — try again',
      primary: { label: 'Retry', action: 'retry' },
      showCancel: false,
      showProgress: false,
      percent: 0,
      indeterminate: false,
    });
  });

  it('cancelled view resets to the plain offer view', () => {
    const view = viewFor({ state: 'cancelled' }, INFO);
    expect(view).toEqual({
      text: 'Sound Buddy 1.4.2 is available.',
      primary: { label: 'Download', action: 'download' },
      showCancel: false,
      showProgress: false,
      percent: 0,
      indeterminate: false,
    });
  });
});
