import { describe, it, expect, vi } from 'vitest';
import { serializeRendererError, installCrashHooks } from './crash-hooks';

describe('serializeRendererError', () => {
  it('serializes an ErrorEvent-shaped input carrying an Error', () => {
    const err = new Error('boom');
    const result = serializeRendererError({ error: err, message: 'ignored' });

    expect(result).toEqual({ message: 'boom', stack: err.stack });
  });

  it('falls back to the event message when the carried Error has no message', () => {
    const err = new Error('');
    const result = serializeRendererError({ error: err, message: 'Script error.' });

    expect(result).toEqual({ message: 'Script error.', stack: err.stack });
  });

  it('serializes a plain (bare-message) ErrorEvent-shaped input', () => {
    const result = serializeRendererError({ message: 'Script error.' });

    expect(result).toEqual({ message: 'Script error.' });
  });

  it('serializes a PromiseRejectionEvent-shaped input with an Error reason', () => {
    const reason = new Error('rejected');
    const result = serializeRendererError({ reason });

    expect(result).toEqual({ message: 'rejected', stack: reason.stack });
  });

  it('serializes a PromiseRejectionEvent-shaped input with a non-Error reason', () => {
    expect(serializeRendererError({ reason: 'custom reason' })).toEqual({
      message: 'custom reason',
    });
    expect(serializeRendererError({ reason: 42 })).toEqual({ message: '42' });
  });

  it('returns null for junk with no usable message', () => {
    expect(serializeRendererError(null)).toBeNull();
    expect(serializeRendererError(undefined)).toBeNull();
    expect(serializeRendererError('a string')).toBeNull();
    expect(serializeRendererError(42)).toBeNull();
    expect(serializeRendererError({})).toBeNull();
    expect(serializeRendererError({ message: '' })).toBeNull();
    expect(serializeRendererError({ error: new Error(''), message: '' })).toBeNull();
  });
});

describe('installCrashHooks', () => {
  function fakeTarget() {
    const listeners = new Map<string, (e: unknown) => void>();
    return {
      listeners,
      addEventListener: (type: string, cb: (e: unknown) => void) => listeners.set(type, cb),
    };
  }

  it('registers both error and unhandledrejection listeners', () => {
    const target = fakeTarget();
    const report = vi.fn();

    installCrashHooks(target, report);

    expect(target.listeners.has('error')).toBe(true);
    expect(target.listeners.has('unhandledrejection')).toBe(true);
  });

  it('calls report with the serialized error on a real error event', () => {
    const target = fakeTarget();
    const report = vi.fn();
    installCrashHooks(target, report);

    target.listeners.get('error')!({ message: 'boom' });

    expect(report).toHaveBeenCalledWith({ message: 'boom' });
  });

  it('calls report with the serialized rejection on an unhandledrejection event', () => {
    const target = fakeTarget();
    const report = vi.fn();
    installCrashHooks(target, report);

    target.listeners.get('unhandledrejection')!({ reason: 'oops' });

    expect(report).toHaveBeenCalledWith({ message: 'oops' });
  });

  it('does not call report when the event has no usable message', () => {
    const target = fakeTarget();
    const report = vi.fn();
    installCrashHooks(target, report);

    target.listeners.get('error')!({});

    expect(report).not.toHaveBeenCalled();
  });

  it('swallows a rejection from report so the crash hook never throws', () => {
    const target = fakeTarget();
    const report = vi.fn().mockRejectedValue(new Error('report failed'));
    installCrashHooks(target, report);

    expect(() => target.listeners.get('error')!({ message: 'boom' })).not.toThrow();
  });

  it('does not throw when report itself throws synchronously', () => {
    const target = fakeTarget();
    const report = vi.fn(() => {
      throw new Error('sync throw');
    });
    installCrashHooks(target, report);

    expect(() => target.listeners.get('error')!({ message: 'boom' })).not.toThrow();
  });
});
