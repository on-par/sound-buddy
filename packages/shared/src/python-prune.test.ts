import { describe, expect, it } from 'vitest';
import { PYTHON_PRUNE_VERSION, isPrunablePythonDir, isPrunablePythonFile } from './python-prune.js';

describe('isPrunablePythonDir', () => {
  it('prunes pip, setuptools, wheel as immediate children of site-packages', () => {
    expect(isPrunablePythonDir('lib/python3.12/site-packages/pip')).toBe(true);
    expect(isPrunablePythonDir('lib/python3.12/site-packages/setuptools')).toBe(true);
    expect(isPrunablePythonDir('lib/python3.12/site-packages/wheel')).toBe(true);
  });

  it('prunes pip/setuptools/wheel dist-info dirs', () => {
    expect(isPrunablePythonDir('lib/python3.12/site-packages/pip-25.1.dist-info')).toBe(true);
    expect(isPrunablePythonDir('lib/python3.12/site-packages/setuptools-80.9.0.dist-info')).toBe(true);
    expect(isPrunablePythonDir('lib/python3.12/site-packages/wheel-0.45.1.dist-info')).toBe(true);
  });

  it('keeps other packages dist-info dirs', () => {
    expect(isPrunablePythonDir('lib/python3.12/site-packages/numpy-2.4.6.dist-info')).toBe(false);
  });

  it('prunes tests dirs at any depth under site-packages', () => {
    expect(isPrunablePythonDir('lib/python3.12/site-packages/scipy/stats/tests')).toBe(true);
    expect(
      isPrunablePythonDir('lib/python3.12/site-packages/scipy/sparse/linalg/_eigen/arpack/tests'),
    ).toBe(true);
  });

  it('keeps numpy/testing as a load-bearing exception', () => {
    expect(isPrunablePythonDir('lib/python3.12/site-packages/numpy/testing')).toBe(false);
  });

  it('prunes numpy/testing/tests (the exception does not extend to nested tests dirs)', () => {
    expect(isPrunablePythonDir('lib/python3.12/site-packages/numpy/testing/tests')).toBe(true);
  });

  it('prunes non-numpy testing dirs', () => {
    expect(isPrunablePythonDir('lib/python3.12/site-packages/somepkg/testing')).toBe(true);
  });

  it('guards the runtime data dirs even though they would otherwise match the tests rule', () => {
    expect(isPrunablePythonDir('lib/python3.12/site-packages/_soundfile_data')).toBe(false);
    expect(isPrunablePythonDir('lib/python3.12/site-packages/_sounddevice_data')).toBe(false);
    expect(isPrunablePythonDir('lib/python3.12/site-packages/_soundfile_data/tests')).toBe(false);
  });

  it('prunes __pycache__ anywhere, including stdlib', () => {
    expect(isPrunablePythonDir('lib/python3.12/site-packages/numpy/__pycache__')).toBe(true);
    expect(isPrunablePythonDir('lib/python3.12/__pycache__')).toBe(true);
    expect(isPrunablePythonDir('lib/python3.12/encodings/__pycache__')).toBe(true);
  });

  it('leaves the stdlib untouched outside __pycache__', () => {
    expect(isPrunablePythonDir('lib/python3.12/email')).toBe(false);
    expect(isPrunablePythonDir('lib/python3.12/unittest')).toBe(false);
    expect(isPrunablePythonDir('lib/python3.12/idlelib/idle_test')).toBe(false);
    expect(isPrunablePythonDir('lib/python3.12/site-packages')).toBe(false);
    expect(isPrunablePythonDir('bin')).toBe(false);
  });

  it('matches site-packages generically across python versions', () => {
    expect(isPrunablePythonDir('lib/python3.13/site-packages/pip')).toBe(true);
  });

  it('only prunes pip/setuptools/wheel as an immediate child of site-packages', () => {
    expect(isPrunablePythonDir('lib/python3.12/site-packages/somepkg/pip')).toBe(false);
  });
});

describe('isPrunablePythonFile', () => {
  it('prunes pip and wheel console scripts in bin', () => {
    expect(isPrunablePythonFile('bin/pip')).toBe(true);
    expect(isPrunablePythonFile('bin/pip3')).toBe(true);
    expect(isPrunablePythonFile('bin/pip3.12')).toBe(true);
    expect(isPrunablePythonFile('bin/wheel')).toBe(true);
  });

  it('keeps the python interpreter binaries', () => {
    expect(isPrunablePythonFile('bin/python3')).toBe(false);
    expect(isPrunablePythonFile('bin/python3.12')).toBe(false);
  });

  it('keeps regular site-packages files', () => {
    expect(isPrunablePythonFile('lib/python3.12/site-packages/numpy/__init__.py')).toBe(false);
  });
});

describe('PYTHON_PRUNE_VERSION', () => {
  it('is a non-empty, stable prune-vN token embedded in the cache-key contract', () => {
    expect(PYTHON_PRUNE_VERSION).toMatch(/^prune-v\d+$/);
  });
});
