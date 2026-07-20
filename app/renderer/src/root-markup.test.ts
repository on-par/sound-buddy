// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

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

describe('Existing tabs stay intact under the unified Analyze picker (#543)', () => {
  it('keeps all seven mode tabs, unchanged', () => {
    ['dir', 'live', 'soundcheck', 'recent', 'guide', 'ringout', 'reportcard'].forEach((mode) => {
      expect(markup).toContain(`data-mode="${mode}"`);
    });
  });

  it('leaves the Directory batch-analysis panel in place', () => {
    expect(markup).toContain('id="dir-choose-btn"');
    expect(markup).toContain('id="dir-analyze-btn"');
  });
});
