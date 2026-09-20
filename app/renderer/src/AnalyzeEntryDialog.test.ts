// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import AnalyzeEntryDialog from './AnalyzeEntryDialog';
import { useAnalyzeEntryStore } from './stores/analyzeEntryStore';

function renderMarkup(): string {
  return renderToString(createElement(AnalyzeEntryDialog));
}

describe('AnalyzeEntryDialog (#1468)', () => {
  afterEach(() => {
    useAnalyzeEntryStore.setState({ dialogOpen: false });
  });

  it('is hidden (display:none) when the dialog is closed', () => {
    useAnalyzeEntryStore.setState({ dialogOpen: false });

    const html = renderMarkup();

    expect(html).toContain('id="analyze-entry-dialog"');
    expect(html).toContain('display:none');
  });

  it('is visible (display:flex) and offers both a file chooser and Listen live when open', () => {
    useAnalyzeEntryStore.setState({ dialogOpen: true });

    const html = renderMarkup();

    expect(html).toContain('display:flex');
    expect(html).toContain('id="analyze-entry-choose-file"');
    expect(html).toContain('id="analyze-entry-listen-live"');
    expect(html).toMatch(/Choose file/);
    expect(html).toMatch(/Listen live/);
  });

  it('describes Listen live with no line-check calibration reference (#1482)', () => {
    useAnalyzeEntryStore.setState({ dialogOpen: true });

    const html = renderMarkup();

    expect(html).toMatch(/Listen live/);
    expect(html).not.toMatch(/line[- ]?check|calibrat/i);
  });

  it('Listen live carries btn-primary and Choose file carries btn-secondary (#1485)', () => {
    useAnalyzeEntryStore.setState({ dialogOpen: true });

    const html = renderMarkup();

    const listenLiveStart = html.indexOf('id="analyze-entry-listen-live"');
    const listenLiveButton = html.slice(html.lastIndexOf('<button', listenLiveStart), html.indexOf('</button>', listenLiveStart));
    expect(listenLiveButton).toContain('btn-primary');

    const chooseFileStart = html.indexOf('id="analyze-entry-choose-file"');
    const chooseFileButton = html.slice(html.lastIndexOf('<button', chooseFileStart), html.indexOf('</button>', chooseFileStart));
    expect(chooseFileButton).toContain('btn-secondary');
  });

  it('body copy leads with live listening before mentioning loading a file (#1485)', () => {
    useAnalyzeEntryStore.setState({ dialogOpen: true });

    const html = renderMarkup();

    expect(html.indexOf('Listen live')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('load a recording')).toBeGreaterThan(-1);
    expect(html.indexOf('Listen live')).toBeLessThan(html.indexOf('load a recording'));
  });
});
