// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import RigDialog from './RigDialog';
import { useRigDialogStore } from './stores/rigDialogStore';

// RigDialog (TD-001 slice 6i, #712) — React port of inline-app.js's rigDialog()
// modal, keeping the same ids/classes so named-channel-groups.spec.ts's
// #rig-dialog-input/#rig-dialog-ok locators work unchanged. renderToString
// reads the live store (useStoreShallow); the mount effect (window.rigDialog
// install) and the click/keyboard dispatch are c8-ignored + e2e-gated.
describe('RigDialog (TD-001 slice 6i, #712)', () => {
  afterEach(() => {
    useRigDialogStore.setState({ isOpen: false, title: '', msg: '', value: '', confirmLabel: 'OK', withInput: true });
  });

  it('renders the closed dialog hidden', () => {
    const html = renderToString(createElement(RigDialog));
    expect(html).toContain('id="rig-dialog"');
    expect(html).toMatch(/id="rig-dialog"[^>]*style="display:none"/);
  });

  it('renders the open prompt with title, msg, input, and confirm label', () => {
    useRigDialogStore.setState({
      isOpen: true, title: 'Save rig as…', msg: 'Name your setup.', value: 'Main Board', confirmLabel: 'Save', withInput: true,
    });
    const html = renderToString(createElement(RigDialog));
    expect(html).toContain('id="rig-dialog-title">Save rig as…');
    expect(html).toMatch(/id="rig-dialog-msg"[^>]*>Name your setup\./);
    expect(html).toContain('id="rig-dialog-input"');
    expect(html).toContain('value="Main Board"');
    expect(html).toMatch(/id="rig-dialog-ok"[^>]*>Save</);
    expect(html).toMatch(/id="rig-dialog-cancel"[^>]*>Cancel</);
  });

  it('hides the msg when absent and the input for a confirm-only prompt', () => {
    useRigDialogStore.setState({
      isOpen: true, title: 'Delete rig', msg: '', value: '', confirmLabel: 'Delete', withInput: false,
    });
    const html = renderToString(createElement(RigDialog));
    expect(html).toMatch(/id="rig-dialog-msg"[^>]*style="display:none"/);
    expect(html).toMatch(/id="rig-dialog-input"[^>]*style="display:none"/);
    expect(html).toMatch(/id="rig-dialog-ok"[^>]*>Delete</);
  });
});
