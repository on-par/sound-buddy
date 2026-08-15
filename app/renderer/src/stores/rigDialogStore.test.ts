// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { useRigDialogStore } from './rigDialogStore';

// Pure UI-state store (TD-001 slice 6i, #712) powering the shared rig/group
// name prompt — no injected API, no window dependency, so the whole behavior
// is exercised here directly (the DOM dispatch / window.rigDialog install are
// RigDialog.tsx's c8-ignored, e2e-gated effect).
describe('rigDialogStore (TD-001 slice 6i, #712)', () => {
  afterEach(() => {
    useRigDialogStore.setState({ isOpen: false, title: '', msg: '', value: '', confirmLabel: 'OK', withInput: true });
  });

  it('starts closed with neutral defaults', () => {
    const s = useRigDialogStore.getState();
    expect(s.isOpen).toBe(false);
    expect(s.title).toBe('');
    expect(s.msg).toBe('');
    expect(s.value).toBe('');
    expect(s.confirmLabel).toBe('OK');
    expect(s.withInput).toBe(true);
  });

  it('open sets the prompt state and resolves with the value passed to close', async () => {
    const p = useRigDialogStore.getState().open({ title: 'Save rig as…', value: '', confirmLabel: 'Save', withInput: true });
    const s = useRigDialogStore.getState();
    expect(s.isOpen).toBe(true);
    expect(s.title).toBe('Save rig as…');
    expect(s.value).toBe('');
    expect(s.confirmLabel).toBe('Save');
    expect(s.withInput).toBe(true);

    useRigDialogStore.getState().close('New Rig');
    await expect(p).resolves.toBe('New Rig');
    expect(useRigDialogStore.getState().isOpen).toBe(false);
  });

  it('close(null) resolves the pending promise with null (cancel / Esc / backdrop)', async () => {
    const p = useRigDialogStore.getState().open({ title: 'Rename rig', value: 'Main' });
    useRigDialogStore.getState().close(null);
    await expect(p).resolves.toBeNull();
  });

  it('withInput defaults to true and a confirm-only prompt resolves true', async () => {
    const p = useRigDialogStore.getState().open({ title: 'Delete rig', withInput: false });
    expect(useRigDialogStore.getState().withInput).toBe(false);
    useRigDialogStore.getState().close(true);
    await expect(p).resolves.toBe(true);
  });

  it('open stores msg/value as given', () => {
    useRigDialogStore.getState().open({ title: 'Delete rig', msg: 'This cannot be undone.', value: 'Drum Kit' });
    const s = useRigDialogStore.getState();
    expect(s.msg).toBe('This cannot be undone.');
    expect(s.value).toBe('Drum Kit');
  });

  it('sequential opens resolve their own promises', async () => {
    const first = useRigDialogStore.getState().open({ title: 'first' });
    useRigDialogStore.getState().close('one');
    await expect(first).resolves.toBe('one');

    const second = useRigDialogStore.getState().open({ title: 'second' });
    useRigDialogStore.getState().close('two');
    await expect(second).resolves.toBe('two');
  });
});
