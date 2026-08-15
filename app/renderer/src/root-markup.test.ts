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
  it('has a real folder picker, Analyze All CTA, and results list — now rendered by DirectoryPanel.tsx onto the empty #tab-dir island (TD-001 slice 6h, #711)', () => {
    const directoryPanel = fs.readFileSync(fileURLToPath(new URL('./DirectoryPanel.tsx', import.meta.url)), 'utf8');
    expect(directoryPanel).toContain('id="dir-choose-btn"');
    expect(directoryPanel).toContain('id="dir-analyze-btn"');
    expect(directoryPanel).toContain('id="dir-results"');
    expect(markup).toMatch(/<div class="tab-content" id="tab-dir"><\/div>/);
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
  it('shows a pre-start cue that listening builds a live Report Card', () => {
    expect(markup).toContain('id="live-rc-cue"');
    expect(markup).toContain('Listening builds a live Report Card as it runs.');
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

  it('gates the offer on the pure window-count rule (#488, #757 — the mode requirement is gone, so record sessions offer the card too)', () => {
    expect(inlineApp).toContain('shouldOfferReportCard(liveWindows.length)');
  });

  it('navigates to the Report Card tab from the offer button', () => {
    expect(inlineApp).toMatch(
      /rc-offer-btn'\)\.addEventListener\('click'[\s\S]{0,200}mode-tab\[data-mode="reportcard"\]'\)\.click\(\)/
    );
  });

  it('has a not-enough-data state for a session too short to grade (#261)', () => {
    expect(markup).toMatch(/id="rc-not-enough" class="rec-offer" style="display:none"/);
    expect(markup).toContain('Not enough data');
    expect(markup).toContain('monitor at least a few seconds of audio');
  });
});

describe('Live tab reads as always-listening, never capture (#777)', () => {
  // The AC's no-"capture" wording rule covers the Live tab UI (the #tab-live
  // block) and the Analyze source-picker's live option — NOT the separate
  // soundcheck copy ("Play back a captured session..."), which stays as-is.
  it('purges every user-visible "capture" from the #tab-live block', () => {
    const liveTabStart = markup.indexOf('<div class="tab-content" id="tab-live">');
    const liveTabEnd = markup.indexOf('id="spectrum-header"');
    expect(liveTabStart).toBeGreaterThan(-1);
    expect(liveTabEnd).toBeGreaterThan(liveTabStart);
    const liveTab = markup.slice(liveTabStart, liveTabEnd);
    expect(liveTab).not.toMatch(/>[^<]*[Cc]apture[^<]*</);
  });

  it('purges "capture" from the Analyze source-picker live option (TD-001 slice 6h, #711 — now AnalyzeSourcePicker.tsx)', () => {
    const pickerTsx = fs.readFileSync(fileURLToPath(new URL('./AnalyzeSourcePicker.tsx', import.meta.url)), 'utf8');
    const liveOptionStart = pickerTsx.indexOf("id: 'live'");
    const liveOptionEnd = pickerTsx.indexOf('}', liveOptionStart);
    expect(liveOptionStart).toBeGreaterThan(-1);
    expect(liveOptionEnd).toBeGreaterThan(liveOptionStart);
    const liveOption = pickerTsx.slice(liveOptionStart, liveOptionEnd);
    expect(liveOption).not.toMatch(/[Cc]apture/);
  });

  it('rewords the two runtime Live-tab strings in inline-app.js to listening/monitoring vocabulary', () => {
    expect(inlineApp).toContain("'Add at least one track before starting listening.'");
    expect(inlineApp).not.toContain("'Add at least one track before starting capture.'");
    expect(inlineApp).toContain("'Failed to start live listening'");
    expect(inlineApp).not.toContain("'Failed to start live capture'");
  });
});

describe('Always-monitoring Live tab with a top-bar-only transport (#757)', () => {
  it('removes the in-tab Mode toggle, preflight gate, and Start/Stop transport from #tab-live', () => {
    expect(markup).not.toContain('id="live-controls-island"');
    expect(markup).not.toContain('id="live-transport-island"');
    expect(markup).not.toContain('id="live-mode"');
    expect(markup).not.toContain('id="preflight-panel"');
    expect(markup).not.toContain('id="preflight-island"');
  });

  it('keeps the top-bar Record button island and the still-inline status/offer rows', () => {
    expect(markup).toContain('id="record-button-island"');
    expect(markup).toContain('id="live-status"');
    expect(markup).toContain('id="live-rc-cue"');
    expect(markup).toContain('id="arm-hint"');
    expect(markup).toContain('id="rec-offer"');
    expect(markup).toContain('id="rc-offer"');
  });

  it('no longer references the removed in-tab controls in App.tsx', () => {
    const appSrc = fs.readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
    expect(appSrc).not.toContain('live-controls-island');
    expect(appSrc).not.toContain('live-transport-island');
    expect(appSrc).not.toContain('preflight-island');
    expect(appSrc).toContain("document.getElementById('record-button-island')");
  });

  it('promoteToRecording consults the preflight checklist before promoting (#757 inline guard)', () => {
    expect(inlineApp).toContain('window.preflight.buildChecklist');
    expect(inlineApp).toContain('window.preflight.checklistSummary');
    const promoteBlock = inlineApp.slice(inlineApp.indexOf('async function promoteToRecording'));
    expect(promoteBlock.indexOf('preflightBlockReason')).toBeGreaterThan(-1);
    expect(promoteBlock.indexOf('preflightBlockReason')).toBeLessThan(promoteBlock.indexOf('canPromoteToRecording'));
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

describe('Secondary measurement device source (#460, React-owned per #724)', () => {
  it('no longer carries a portal-target island in root-markup.html — #727 relocated it into SettingsPanel.tsx as direct JSX', () => {
    expect(markup).not.toContain('id="secondary-measurement-island"');
  });

  it('no longer carries the old static-markup block — it is React-owned now (SecondaryMeasurementPanel.tsx)', () => {
    expect(markup).not.toContain('id="secondary-measurement-block"');
    expect(markup).not.toContain('id="secondary-measurement-device"');
    expect(markup).not.toContain('id="secondary-measurement-status"');
    expect(markup).not.toContain('id="secondary-measurement-warning"');
  });

  it('inline-app.js no longer defines the ported DOM-writer/lifecycle glue', () => {
    expect(inlineApp).not.toContain('applySecondaryMeasurementSettings');
    expect(inlineApp).not.toContain('initSecondaryMeasurementPicker');
    expect(inlineApp).not.toContain('renderSecondaryStatus');
    expect(inlineApp).not.toContain('populateSecondaryDevicePicker');
    expect(inlineApp).not.toContain('SECONDARY_RECONNECT_POLL_MS');
    expect(inlineApp).not.toContain('secondaryReconnectTimer');
  });

  it('inline-app.js still routes the Room feed through roomFeed(), and exposes afterSecondaryMeasurementChange to the React runtime', () => {
    expect(inlineApp).toContain('roomFeed()');
    expect(inlineApp).toContain('afterSecondaryMeasurementChange');
  });
});

describe('Header live dBFS readout (#767)', () => {
  it('renders #live-level-readout at the right end of #header-right, after #live-indicator', () => {
    const headerRightIdx = markup.indexOf('id="header-right"');
    const liveIndicatorIdx = markup.indexOf('id="live-indicator"');
    const readoutIdx = markup.indexOf('id="live-level-readout"');
    expect(headerRightIdx).toBeGreaterThan(-1);
    expect(liveIndicatorIdx).toBeGreaterThan(headerRightIdx);
    expect(readoutIdx).toBeGreaterThan(liveIndicatorIdx);
  });

  it('starts hidden — patched visible only while an input device is actively monitoring', () => {
    expect(markup).toMatch(/id="live-level-readout"[^>]*style="display:none"/);
  });

  it('is persistently labeled relative/dBFS and carries the calibrated-SPL honesty title', () => {
    expect(markup).toContain('dBFS');
    expect(markup).toContain('relative');
    expect(markup).toContain('not calibrated SPL');
    expect(markup).toContain('A calibrated reference microphone is required for true SPL readings.');
  });

  it('has value slots for the rms and peak readouts', () => {
    expect(markup).toContain('id="live-level-rms"');
    expect(markup).toContain('id="live-level-peak"');
  });
});

describe('Existing tabs stay intact under the unified Analyze picker (#543)', () => {
  it('keeps all seven mode tabs, unchanged (now rendered by ModeTabs.tsx, TD-001 slice 6e, #703)', () => {
    const modeTabsMarkup = renderToString(createElement(ModeTabs));
    ['dir', 'live', 'soundcheck', 'recent', 'guide', 'ringout', 'reportcard'].forEach((mode) => {
      expect(modeTabsMarkup).toContain(`data-mode="${mode}"`);
    });
  });

  it('leaves the Directory batch-analysis panel in place (DirectoryPanel.tsx renders onto the empty #tab-dir island)', () => {
    const directoryPanel = fs.readFileSync(fileURLToPath(new URL('./DirectoryPanel.tsx', import.meta.url)), 'utf8');
    expect(directoryPanel).toContain('id="dir-choose-btn"');
    expect(directoryPanel).toContain('id="dir-analyze-btn"');
    expect(markup).toContain('id="tab-dir"');
  });
});
