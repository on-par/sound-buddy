import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ─── CSS design-system extraction guard (#304) ───────────────────────────────
//
// The renderer's design system used to live in an inline <style> block in
// index.html. It was relocated verbatim into src/styles/tokens.css and
// src/styles/app.css, imported as global side-effect CSS at the React entry.
// These assertions encode the acceptance criteria: no inline <style> remains,
// the token/component split holds, and both files carry the proprietary
// license header required of app/ source (CLAUDE.md #55).

const LICENSE_LINE = 'Licensed under the Sound Buddy Desktop Application License (app/LICENSE).';

const html = fs.readFileSync(fileURLToPath(new URL('./index.html', import.meta.url)), 'utf8');
const tokensCss = fs.readFileSync(fileURLToPath(new URL('./src/styles/tokens.css', import.meta.url)), 'utf8');
const appCss = fs.readFileSync(fileURLToPath(new URL('./src/styles/app.css', import.meta.url)), 'utf8');
const mainTsx = fs.readFileSync(fileURLToPath(new URL('./src/main.tsx', import.meta.url)), 'utf8');

describe('index.html has no inline <style> block', () => {
  it('contains no <style> tag', () => {
    expect(html).not.toContain('<style>');
  });

  it('contains no </style> tag', () => {
    expect(html).not.toContain('</style>');
  });
});

describe('src/main.tsx imports the extracted stylesheets', () => {
  it('imports tokens.css', () => {
    expect(mainTsx).toContain("import './styles/tokens.css';");
  });

  it('imports app.css', () => {
    expect(mainTsx).toContain("import './styles/app.css';");
  });
});

describe('src/styles/tokens.css', () => {
  it('carries the proprietary license header', () => {
    expect(tokensCss).toContain(LICENSE_LINE);
  });

  it('holds the :root token block', () => {
    expect(tokensCss).toContain(':root {');
  });

  it('reproduces exact token literals verbatim', () => {
    expect(tokensCss).toContain('--gold-500:#EBB93C');
    expect(tokensCss).toContain('--neutral-950:#0B0C0F');
    expect(tokensCss).toContain('--band-mid:#23BBA6');
    expect(tokensCss).toContain('--header-h:52px');
    expect(tokensCss).toContain('--titlebar-safe-left:82px');
  });

  it('carries the console-style gridline major/minor tokens (#480)', () => {
    expect(tokensCss).toContain('--gridline-minor:rgba(255,255,255,0.03)');
    expect(tokensCss).toContain('--gridline-major:rgba(255,255,255,0.09)');
  });
});

describe('src/styles/app.css', () => {
  it('carries the proprietary license header', () => {
    expect(appCss).toContain(LICENSE_LINE);
  });

  it('holds component rules and keyframes', () => {
    expect(appCss).toContain('.btn');
    expect(appCss).toContain('@keyframes');
  });

  it('does not hold the :root token block (proves the split)', () => {
    expect(appCss).not.toContain(':root {');
  });

  it('uses the shared titlebar safe-area token for the header and remaining top banners', () => {
    expect(appCss).toContain(
      '#license-banner,\n    #trial-banner {\n      padding-left:var(--titlebar-safe-left);',
    );
    expect(appCss).toContain('padding-left:var(--titlebar-safe-left);');
  });

  it('carries the console-style major/minor gridline rules (#480)', () => {
    expect(appCss).toContain('.sb-grid-line.minor');
    expect(appCss).toContain('.sb-grid-line.major');
    expect(appCss).toContain('.eq-grid.minor');
    expect(appCss).toContain('.eq-grid.major');
  });

  it('carries the console channel meter fill rule (#978)', () => {
    expect(appCss).toContain('.console-channel-meter-fill');
  });
});

describe('Settings dialog CSS (#204, chrome #1008)', () => {
  it('has the Settings-scoped chrome classes', () => {
    expect(appCss).toContain('.settings-dialog-card');
    expect(appCss).toContain('.settings-titlebar');
    expect(appCss).toContain('.settings-close-btn');
    expect(appCss).toContain('.settings-body');
    expect(appCss).toContain('.settings-rail');
    expect(appCss).toContain('.settings-rail-item.active');
    expect(appCss).toContain('.settings-panes');
    expect(appCss).toContain('.settings-pane');
    expect(appCss).toContain('.settings-footer');
  });

  it('no longer holds the horizontal tab-strip rules the rail replaced (#1008)', () => {
    expect(appCss).not.toContain('.settings-tabs');
    expect(appCss).not.toContain('.settings-tab ');
    expect(appCss).not.toContain('.settings-tab.active');
  });

  it('sizes the Settings card and rail from tokens, never literals (#1008)', () => {
    expect(appCss).toContain('.settings-dialog-card { width:var(--settings-card-w); height:var(--settings-card-h);');
    expect(appCss).toContain('flex:0 0 var(--settings-rail-w)');
    expect(appCss).toContain('height:var(--control-h-sm)');
    expect(tokensCss).toContain('--settings-card-w:min(760px,calc(100vw - 48px))');
    expect(tokensCss).toContain('--settings-card-h:min(560px,calc(100vh - 96px))');
    expect(tokensCss).toContain('--settings-rail-w:176px');
  });

  it('leaves the shared .rig-dialog-card untouched so other dialogs are unaffected (#1008)', () => {
    expect(appCss).toContain('.rig-dialog-card { width:min(340px,calc(100vw - 48px));');
    // No Settings chrome rule may target the shared card.
    expect(appCss).not.toMatch(/\.rig-dialog-card\s*\{[^}]*--settings-card-w/);
  });

  it('lets the Settings pane scroll inside the fixed frame instead of growing the card', () => {
    expect(appCss).toContain('.settings-pane { display:flex; flex-direction:column; flex:1; min-height:0; gap:12px; overflow-y:auto; }');
    expect(appCss).not.toContain('max-height:min(72vh, 640px)');
  });

  it('no longer holds the two separate dialog-card classes it replaced', () => {
    expect(appCss).not.toContain('.storage-dialog-card');
    expect(appCss).not.toContain('.ai-dialog-card');
  });

  it('no longer styles the two separate header gear buttons it replaced', () => {
    expect(appCss).not.toContain('#ai-settings-btn');
    expect(appCss).not.toContain('#storage-settings-btn');
  });
});

describe('rc-toolbar wraps instead of clipping (#478)', () => {
  it('lets the toolbar row wrap so buttons never clip under the panel overflow', () => {
    expect(appCss).toContain('#rc-toolbar { display:flex; flex-wrap:wrap;');
  });

  it('wraps and right-aligns the action group with breathing room', () => {
    expect(appCss).toContain(
      '.rc-toolbar-actions { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:8px; min-width:0; }',
    );
  });
});

describe('Feedback message textarea sizing (#926)', () => {
  it('overrides the shared single-line input height for multi-line inputs', () => {
    expect(appCss).toContain(
      'textarea.rig-dialog-input { height:auto; min-height:calc(var(--control-h) * 2); padding:8px 12px; line-height:1.4; resize:vertical; }',
    );
  });

  it('leaves the single-line .rig-dialog-input rule at the fixed control height', () => {
    expect(appCss).toContain('.rig-dialog-input { height:var(--control-h); padding:0 12px;');
  });
});

describe('Settings row grid (#1009)', () => {
  it('adds the control-column-width and row-gap tokens', () => {
    expect(tokensCss).toContain('--settings-control-w:260px');
    expect(tokensCss).toContain('--settings-row-gap:14px');
  });

  it('lays out every row class as a two-column grid keyed on the token', () => {
    expect(appCss).toContain('grid-template-columns:1fr var(--settings-control-w)');
    expect(appCss).toContain('.settings-pane .ai-field,');
    expect(appCss).toContain('.settings-pane .select-label,');
    expect(appCss).toContain('.settings-pane .ai-enable-row,');
    expect(appCss).toContain('.settings-pane .slider,');
  });

  it('gives the group header a small-caps hairline divider', () => {
    expect(appCss).toContain('.settings-group-title');
    const match = appCss.match(/\.settings-group-title\s*\{[^}]*\}/);
    expect(match).not.toBeNull();
    const rule = match ? match[0] : '';
    expect(rule).toContain('text-transform:uppercase');
    expect(rule).toContain('letter-spacing:var(--tracking-caps)');
    expect(rule).toContain('border-bottom:1px solid var(--border-subtle)');
  });

  it('compacts controls to --control-h-sm only inside the Settings pane', () => {
    expect(appCss).toContain('.settings-pane .select-wrap select { height:var(--control-h-sm)');
    expect(appCss).toContain('.settings-pane .rig-dialog-input { height:var(--control-h-sm)');
    expect(appCss).toContain('.settings-pane .ghost-btn { height:var(--control-h-sm)');
  });

  it('leaves the shared base row rules byte-unchanged so other dialogs are untouched', () => {
    expect(appCss).toContain('.ai-field { display:flex; flex-direction:column; gap:5px; }');
    expect(appCss).toContain('.select-label { display:flex; flex-direction:column; gap:6px; width:100%; }');
    expect(appCss).toContain('.ai-enable-row { display:flex; align-items:center; gap:8px;');
  });

  it('introduces no new hardcoded color, height, radius or font-size literal', () => {
    const start = appCss.indexOf('/* Settings row grid (#1009');
    const end = appCss.indexOf('/* Storage pane (#91)');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    // Strip comments before scanning for literals — the block's own header
    // comment references issue numbers like "#1009" and "#999", which are
    // not CSS color values but would otherwise false-positive the hex check.
    const block = appCss.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/rgba?\(/);
    expect(block).not.toMatch(/height:\d+px/);
    expect(block).not.toMatch(/border-radius:\d+px/);
    expect(block).not.toMatch(/font-size:\d+px/);
  });
});
