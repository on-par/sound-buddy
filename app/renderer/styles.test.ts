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

  it('uses the shared titlebar safe-area token for the header and top banners', () => {
    expect(appCss).toContain(
      '#update-banner,\n    #license-banner,\n    #trial-banner,\n    #whats-new-banner {\n      padding-left:var(--titlebar-safe-left);',
    );
    expect(appCss).toContain('padding-left:var(--titlebar-safe-left);');
  });

  it('carries the console-style major/minor gridline rules (#480)', () => {
    expect(appCss).toContain('.sb-grid-line.minor');
    expect(appCss).toContain('.sb-grid-line.major');
    expect(appCss).toContain('.eq-grid.minor');
    expect(appCss).toContain('.eq-grid.major');
  });
});

describe('Settings dialog CSS (#204)', () => {
  it('has the new tabbed-modal classes', () => {
    expect(appCss).toContain('.settings-dialog-card');
    expect(appCss).toContain('.settings-tabs');
    expect(appCss).toContain('.settings-tab.active');
    expect(appCss).toContain('.settings-pane');
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
