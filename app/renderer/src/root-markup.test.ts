// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import ModeTabs from './ModeTabs';

// Directory tab is a real batch-analysis workflow (#270), replacing the
// #293 roadmap card. These assertions encode the acceptance criteria — a
// real folder picker + Analyze All CTA + results list, and no trace of the
// old dead-end roadmap markup or its handoff-to-Report-Card listener.

const markup = fs.readFileSync(fileURLToPath(new URL('./root-markup.html', import.meta.url)), 'utf8');
const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');

describe('Directory tab batch-analyzes a folder of recordings (#270)', () => {
  it('has a real folder picker, Analyze All CTA, and results list', () => {
    expect(markup).toContain('id="dir-choose-btn"');
    expect(markup).toContain('id="dir-analyze-btn"');
    expect(markup).toContain('id="dir-results"');
  });

  it('no longer carries the #293 roadmap markup or its v1.1 badge', () => {
    expect(markup).not.toContain('dir-roadmap');
    expect(markup).not.toContain('dir-goto-reportcard');
    expect(markup).not.toMatch(/data-mode="dir"[^>]*tab-soon">v1\.1/);
  });

  it('does not route users to the CLI as the resolution path', () => {
    expect(markup).not.toContain('sound-buddy --dir');
    expect(markup).not.toContain('dir-note-cmd');
  });

  it('inline-app no longer references the removed roadmap handoff listener', () => {
    expect(inlineApp).not.toContain('dir-goto-reportcard');
  });
});

describe('Live monitoring visibly leads to a Report Card (#488)', () => {
  it('shows a pre-start cue that capture builds a live Report Card', () => {
    expect(markup).toContain('id="live-rc-cue"');
    expect(markup).toContain('Capture builds a live Report Card as it runs.');
    // Idle-visible: the cue must NOT start hidden.
    expect(markup).not.toMatch(/id="live-rc-cue"[^>]*display:none/);
  });

  it('hides the cue while a capture runs and restores it on stop', () => {
    expect(inlineApp).toContain("document.getElementById('live-rc-cue').style.display = 'none'");
    expect(inlineApp).toContain("document.getElementById('live-rc-cue').style.display = 'block'");
  });

  it('has a report-card offer row reusing the rec-offer pattern', () => {
    expect(markup).toMatch(/id="rc-offer" class="rec-offer" style="display:none"/);
    expect(markup).toContain('Report card ready.');
    expect(markup).toMatch(/id="rc-offer-btn"[^>]*>View report card/);
  });

  it('gates the offer on the pure monitor-with-windows rule', () => {
    expect(inlineApp).toContain('shouldOfferReportCard(liveMode, liveWindows.length)');
  });

  it('navigates to the Report Card tab from the offer button', () => {
    expect(inlineApp).toMatch(
      /rc-offer-btn'\)\.addEventListener\('click'[\s\S]{0,200}mode-tab\[data-mode="reportcard"\]'\)\.click\(\)/
    );
  });

  it('has a not-enough-data state for a session too short to grade (#261)', () => {
    expect(markup).toMatch(/id="rc-not-enough" class="rec-offer" style="display:none"/);
    expect(markup).toContain('Not enough data');
    expect(markup).toContain('capture at least a few seconds of audio');
  });
});

describe('Storage and AI Engineer dialogs combined into one Settings gear (#204)', () => {
  it('has exactly one settings header button', () => {
    expect(markup.match(/id="settings-btn"/g)).toHaveLength(1);
  });

  it('no longer has the two separate header gear buttons it replaced', () => {
    expect(markup).not.toContain('id="storage-settings-btn"');
    expect(markup).not.toContain('id="ai-settings-btn"');
  });
});

describe('Docked live EQ pane markup (#668)', () => {
  it('renders the pane, its resize handle, and its body container', () => {
    expect(markup).toContain('id="live-eq-pane"');
    expect(markup).toContain('id="live-eq-resize"');
    expect(markup).toContain('id="live-eq-pane-body"');
  });

  it('starts hidden — inline-app.js shows it only in Live mode', () => {
    expect(markup).toMatch(/id="live-eq-pane"[^>]*style="display:none"/);
  });

  it('the resize handle is a keyboard-operable vertical separator', () => {
    expect(markup).toMatch(/id="live-eq-resize"[^>]*role="separator"/);
    expect(markup).toMatch(/id="live-eq-resize"[^>]*aria-orientation="vertical"/);
    expect(markup).toMatch(/id="live-eq-resize"[^>]*aria-label="Resize EQ pane"/);
    expect(markup).toMatch(/id="live-eq-resize"[^>]*tabindex="0"/);
  });

  it('lives inside #workspace, after the spectrum panel', () => {
    const workspaceIdx = markup.indexOf('id="workspace"');
    const spectrumCloseIdx = markup.indexOf('</section>', markup.indexOf('id="spectrum-panel"'));
    const paneIdx = markup.indexOf('id="live-eq-pane"');
    expect(workspaceIdx).toBeGreaterThan(-1);
    expect(spectrumCloseIdx).toBeGreaterThan(workspaceIdx);
    expect(paneIdx).toBeGreaterThan(spectrumCloseIdx);
  });
});

describe('Secondary measurement device source (#460)', () => {
  it('has the block, device picker, status line, and warning container', () => {
    expect(markup).toContain('id="secondary-measurement-block"');
    expect(markup).toContain('id="secondary-measurement-device"');
    expect(markup).toContain('id="secondary-measurement-status"');
    expect(markup).toContain('id="secondary-measurement-warning"');
  });

  it('starts hidden — inline-app.js shows it only when the flag is on', () => {
    expect(markup).toMatch(/id="secondary-measurement-block"[^>]*style="display:none"/);
  });

  it('sits directly after the live-controls island (device picker/measurement-source/mode/record-folder, React-owned per TD-001 slice 6c, #701)', () => {
    const islandIdx = markup.indexOf('id="live-controls-island"');
    const secondaryIdx = markup.indexOf('id="secondary-measurement-block"');
    expect(islandIdx).toBeGreaterThan(-1);
    expect(secondaryIdx).toBeGreaterThan(islandIdx);
  });

  it('inline-app.js gates the block on the secondaryMeasurementEnabled setting', () => {
    expect(inlineApp).toContain('applySecondaryMeasurementSettings');
    expect(inlineApp).toContain('secondaryMeasurementEnabled');
  });

  it('inline-app.js routes the Room feed through roomFeed() and polls for reconnect', () => {
    expect(inlineApp).toContain('roomFeed()');
    expect(inlineApp).toContain('startSecondaryMeasurement');
    expect(inlineApp).toContain('SECONDARY_RECONNECT_POLL_MS');
  });
});

describe('Existing tabs stay intact under the unified Analyze picker (#543)', () => {
  it('keeps all seven mode tabs, unchanged (now rendered by ModeTabs.tsx, TD-001 slice 6e, #703)', () => {
    const modeTabsMarkup = renderToString(createElement(ModeTabs));
    ['dir', 'live', 'soundcheck', 'recent', 'guide', 'ringout', 'reportcard'].forEach((mode) => {
      expect(modeTabsMarkup).toContain(`data-mode="${mode}"`);
    });
  });

  it('leaves the Directory batch-analysis panel in place', () => {
    expect(markup).toContain('id="dir-choose-btn"');
    expect(markup).toContain('id="dir-analyze-btn"');
  });
});
