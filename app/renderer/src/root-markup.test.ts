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
// TD-001 slice 6i (#712): the post-stop session chrome, the #live-status line,
// the window badge, and the capture lifecycle moved off the static markup +
// inline-app.js onto React islands / capture-lifecycle.ts — read those sources
// for the surface assertions below.
const lifecycleTs = fs.readFileSync(fileURLToPath(new URL('./capture-lifecycle.ts', import.meta.url)), 'utf8');
const liveCaptureStoreTs = fs.readFileSync(fileURLToPath(new URL('./stores/liveCaptureStore.ts', import.meta.url)), 'utf8');
const liveStatusLineTsx = fs.readFileSync(fileURLToPath(new URL('./LiveStatusLine.tsx', import.meta.url)), 'utf8');
const liveSessionOffersTsx = fs.readFileSync(fileURLToPath(new URL('./LiveSessionOffers.tsx', import.meta.url)), 'utf8');
const windowBadgeTsx = fs.readFileSync(fileURLToPath(new URL('./WindowBadge.tsx', import.meta.url)), 'utf8');

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

describe('Console workspace separation (#989)', () => {
  it('has its own top-level tab content and no console live surface inside the Live tab', () => {
    expect(markup).toContain('id="tab-console"');
    const liveTabStart = markup.indexOf('<div class="tab-content" id="tab-live">');
    const liveTabEnd = markup.indexOf('id="spectrum-header"');
    const liveTab = markup.slice(liveTabStart, liveTabEnd);
    expect(liveTab).not.toContain('console-panel-island');
    expect(liveTab).not.toContain('console-live-error');
  });

  it('ports ConsolePanel onto the Console workspace, not Live', () => {
    const appSrc = fs.readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
    expect(appSrc).toContain("document.getElementById('tab-console')");
    expect(appSrc).not.toContain("document.getElementById('console-panel-island')");
  });
});

describe('Live monitoring visibly leads to a Report Card (#488)', () => {
  it('shows a pre-start cue that listening builds a live Report Card (LiveSessionOffers.tsx)', () => {
    expect(liveSessionOffersTsx).toContain('id="live-rc-cue"');
    expect(liveSessionOffersTsx).toContain('Listening builds a live Report Card as it runs.');
    // The cue is store-driven (liveCueVisible), idle-visible by default.
    expect(liveSessionOffersTsx).toContain('liveCueVisible');
  });

  it('hides the cue while a capture runs and restores it on stop', () => {
    expect(liveCaptureStoreTs).toContain('setLiveCueVisible(visible)');
    // onCaptureStarting (fresh session) + promoteToRecording hide it;
    // onCaptureStopped restores it.
    expect(lifecycleTs).toContain('lc.setLiveCueVisible(false)');
    expect(lifecycleTs).toContain('lc.setLiveCueVisible(true)');
  });

  it('has a report-card offer row reusing the rec-offer pattern', () => {
    expect(liveSessionOffersTsx).toContain('id="rc-offer"');
    expect(liveSessionOffersTsx).toContain('className="rec-offer"');
    expect(liveSessionOffersTsx).toContain('Report card ready.');
    expect(liveSessionOffersTsx).toContain('id="rc-offer-btn"');
    expect(liveSessionOffersTsx).toContain('View report card');
  });

  it('gates the offer on the pure window-count rule (#488, #757 — the mode requirement is gone, so record sessions offer the card too)', () => {
    expect(lifecycleTs).toContain('shouldOfferReportCard(lc.liveWindows.length)');
  });

  it('navigates to the Report Card tab from the offer button', () => {
    expect(liveSessionOffersTsx).toContain('id="rc-offer-btn"');
    expect(liveSessionOffersTsx).toContain("switchMode('reportcard')");
  });

  it('has a not-enough-data state for a session too short to grade (#261)', () => {
    expect(liveSessionOffersTsx).toContain('id="rc-not-enough"');
    expect(liveSessionOffersTsx).toContain('Not enough data');
    expect(liveSessionOffersTsx).toContain('monitor at least a few seconds of audio');
  });
});

describe('Live tab reads as always-listening, never capture (#777)', () => {
  // The AC's no-"capture" wording rule covers the Live tab UI (the #tab-live
  // block) and the Analyze source-picker's live option.
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

  it('rewords the two runtime Live-tab strings to listening/monitoring vocabulary (capture-lifecycle.ts)', () => {
    expect(lifecycleTs).toContain("'Add at least one track before starting listening.'");
    expect(lifecycleTs).not.toContain("'Add at least one track before starting capture.'");
    expect(lifecycleTs).toContain("'Failed to start live listening'");
    expect(lifecycleTs).not.toContain("'Failed to start live capture'");
  });
});

describe('Always-monitoring Live tab with Session-owned transport (#757/#1112)', () => {
  it('does not pre-activate the Report Card side pane in the static shell', () => {
    expect(markup).toContain('<div id="reportcard-view">');
    expect(markup).not.toContain('<div id="reportcard-view" class="active">');
  });

  it('removes the in-tab Mode toggle, preflight gate, and Start/Stop transport from #tab-live', () => {
    expect(markup).not.toContain('id="live-controls-island"');
    expect(markup).not.toContain('id="live-transport-island"');
    expect(markup).not.toContain('id="live-mode"');
    expect(markup).not.toContain('id="preflight-panel"');
    expect(markup).not.toContain('id="preflight-island"');
  });

  it('keeps the header island mount points and the React-owned status/offer/window-badge islands', () => {
    expect(markup).toContain('id="record-button-island"');
    expect(markup).toContain('id="live-status-island"');
    expect(markup).toContain('id="live-session-offers-island"');
    // TD-001 slice 6h (#711): the arm hint moved to LiveArmHint.tsx, portaled
    // onto this island; the React span keeps id="arm-hint" (LiveArmHint.test.ts).
    expect(markup).toContain('id="arm-hint-island"');
    expect(markup).toContain('id="window-badge-island"');
    // The actual nodes are rendered by the islands.
    expect(liveStatusLineTsx).toContain('id="live-status"');
    expect(liveSessionOffersTsx).toContain('id="rec-offer"');
    expect(liveSessionOffersTsx).toContain('id="rc-offer"');
    expect(windowBadgeTsx).toContain('id="window-badge"');
  });

  it('hides the top-bar Record button while the Session workspace is active', () => {
    const css = fs.readFileSync(fileURLToPath(new URL('./styles/app.css', import.meta.url)), 'utf8');
    expect(css).toContain('body.live-active #record-button-island { display:none !important; }');
  });

  it('collapses inactive spectrum surfaces so the Session workspace owns the panel height', () => {
    const css = fs.readFileSync(fileURLToPath(new URL('./styles/app.css', import.meta.url)), 'utf8');
    expect(css).toContain('body.live-active #spectrum-imperative,');
    expect(css).toContain('body.live-active #spectrum-island { display:none !important; }');
    // #1245: :not(.not-pro)-scoped so the Pro gate can't be overridden.
    expect(css).toContain('body.live-active:not(.not-pro) #live-island { display:flex !important; }');
  });

  it('no longer references the removed in-tab controls in App.tsx', () => {
    const appSrc = fs.readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
    expect(appSrc).not.toContain('live-controls-island');
    expect(appSrc).not.toContain('live-transport-island');
    expect(appSrc).not.toContain('preflight-island');
    expect(appSrc).toContain("document.getElementById('record-button-island')");
  });

  it('promoteToRecording consults the preflight checklist before promoting (#757 inline guard)', () => {
    expect(lifecycleTs).toContain('buildChecklist({');
    expect(lifecycleTs).toContain('checklistSummary(items)');
    const promoteBlock = lifecycleTs.slice(lifecycleTs.indexOf('async function promoteToRecording'));
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

  it('exposes afterSecondaryMeasurementChange on the lifecycle runtime (still a no-op — the Room badge is MeasurementBadge.tsx now, TD-001 slice 6h #711; distinct from inline-app.js, out of scope for 6k — see #714)', () => {
    expect(lifecycleTs).toContain('afterSecondaryMeasurementChange');
    expect(lifecycleTs).toContain('/* no-op until 6k */');
    expect(inlineApp).not.toContain('function renderMeasurementBadge');
  });

  it('inline-app.js no longer defines afterSecondaryStateChange or its redundant onMeasurementEvent listener (TD-001 slice 6k, #714)', () => {
    expect(inlineApp).not.toContain('afterSecondaryStateChange');
    expect(inlineApp).toContain('lcStore.getState().bindMeasurementEvents();');
  });
});

describe('Header live dBFS readout removed from top chrome (#1113)', () => {
  it('does not render the variable-width live level readout in the header', () => {
    const headerRightIdx = markup.indexOf('id="header-right"');
    const headerEndIdx = markup.indexOf('</div>\n  </div>\n\n  <!-- ══ Stage', headerRightIdx);
    const headerRight = markup.slice(headerRightIdx, headerEndIdx);
    expect(headerRight).not.toContain('id="live-level-readout"');
    expect(headerRight).not.toContain('id="live-level-rms"');
    expect(headerRight).not.toContain('id="live-level-peak"');
    expect(headerRight).not.toContain('relative');
  });
});

describe('Existing tabs stay intact under the unified Analyze picker (#543)', () => {
  it('keeps all workspace mode tabs available (now rendered by ModeTabs.tsx, TD-001 slice 6e, #703)', () => {
    const modeTabsMarkup = renderToString(createElement(ModeTabs));
    ['dir', 'live', 'console', 'recent', 'guide', 'ringout', 'reportcard'].forEach((mode) => {
      expect(modeTabsMarkup).toContain(`data-mode="${mode}"`);
    });
  });

  it('has no retired standalone tab or portal island', () => {
    expect(markup).not.toContain(`tab-${"soundcheck"}`);
    expect(markup).not.toContain(`${"soundcheck"}-island`);
  });

  it('leaves the Directory batch-analysis panel in place (DirectoryPanel.tsx renders onto the empty #tab-dir island)', () => {
    const directoryPanel = fs.readFileSync(fileURLToPath(new URL('./DirectoryPanel.tsx', import.meta.url)), 'utf8');
    expect(directoryPanel).toContain('id="dir-choose-btn"');
    expect(directoryPanel).toContain('id="dir-analyze-btn"');
    expect(markup).toContain('id="tab-dir"');
  });
});
