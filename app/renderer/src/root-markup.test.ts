// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Directory dead-end guard (#293): the Directory tab is roadmap context until
// batch analysis ships in v1.1. These assertions encode the acceptance
// criteria — no disabled primary CTA, no fake folder-drop workflow, no CLI
// command as the resolution path, and a real handoff to Report Card.

const markup = fs.readFileSync(fileURLToPath(new URL('./root-markup.html', import.meta.url)), 'utf8');
const inlineApp = fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8');

describe('Directory tab is roadmap context, not a fake workflow (#293)', () => {
  it('has no disabled Analyze All primary CTA', () => {
    expect(markup).not.toContain('analyze-dir-btn');
  });

  it('has no folder dropzone pretending to start a batch run', () => {
    expect(markup).not.toContain('dir-dropzone');
    expect(markup).not.toContain('dir-file-list');
  });

  it('does not route users to the CLI as the resolution path', () => {
    expect(markup).not.toContain('sound-buddy --dir');
    expect(markup).not.toContain('dir-note-cmd');
  });

  it('marks availability on the tab itself and in the panel', () => {
    expect(markup).toMatch(/data-mode="dir"[^>]*>Directory<span class="tab-soon">v1\.1<\/span>/);
    expect(markup).toContain('id="dir-roadmap"');
    expect(markup).toContain('Coming in v1.1');
  });

  it('offers a working handoff to the supported Report Card path', () => {
    expect(markup).toContain('id="dir-goto-reportcard"');
    // btn-secondary, never btn-primary — a deferred feature must not lead
    // with a primary CTA.
    expect(markup).toMatch(/class="btn btn-secondary" id="dir-goto-reportcard"/);
    expect(inlineApp).toContain("document.getElementById('dir-goto-reportcard')");
  });

  it('inline-app no longer carries the dead directory workflow', () => {
    expect(inlineApp).not.toContain('loadDir');
    expect(inlineApp).not.toContain('currentDirPath');
    expect(inlineApp).not.toContain('Analyze the folder to see the spectrum');
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
});
