// Prune decisions for the relocatable Python runtime bundled by
// app/build/afterPack.js (#663). Pure predicates only — no fs here; afterPack.js
// walks the runtime tree and calls these to decide what to delete, mirroring the
// planCodesignBatches/isMachOBinary split in signing.ts.

// Bump this when the prune rules change so afterPack.js's cache key changes too —
// otherwise a cached, differently-pruned runtime from a prior build would be reused.
export const PYTHON_PRUNE_VERSION = 'prune-v1';

const SITE_PACKAGES_SEGMENT = 'site-packages';
const PYCACHE_DIR = '__pycache__';
const PRUNED_TOOL_PACKAGES = ['pip', 'setuptools', 'wheel'];
const RUNTIME_DATA_DIRS = ['_soundfile_data', '_sounddevice_data'];
const TESTS_DIR = 'tests';
const TESTING_DIR = 'testing';
const NUMPY_DIR = 'numpy';

const TOOL_DIST_INFO_PATTERN = new RegExp(`^(${PRUNED_TOOL_PACKAGES.join('|')})-.*\\.dist-info$`);
const PIP_BIN_PATTERN = /^bin\/(pip[0-9.]*|wheel)$/;

function sitePackagesIndex(segments: string[]): number {
  return segments.indexOf(SITE_PACKAGES_SEGMENT);
}

/**
 * `relDir` is a POSIX-style path relative to the python runtime root
 * (e.g. `lib/python3.12/site-packages/scipy/stats/tests`).
 */
export function isPrunablePythonDir(relDir: string): boolean {
  const segments = relDir.split('/');

  // Data-dir guard wins over every other rule — these carry the libsndfile and
  // PortAudio native libs loaded at runtime.
  if (segments.some((segment) => RUNTIME_DATA_DIRS.includes(segment))) {
    return false;
  }

  const basename = segments[segments.length - 1];
  if (basename === PYCACHE_DIR) {
    return true;
  }

  const spIndex = sitePackagesIndex(segments);
  if (spIndex === -1) {
    return false;
  }
  const underSitePackages = segments.slice(spIndex + 1);
  if (underSitePackages.length === 0) {
    return false;
  }

  if (underSitePackages.length === 1 && PRUNED_TOOL_PACKAGES.includes(underSitePackages[0])) {
    return true;
  }

  if (underSitePackages.length === 1 && TOOL_DIST_INFO_PATTERN.test(underSitePackages[0])) {
    return true;
  }

  if (basename === TESTS_DIR) {
    return true;
  }

  if (basename === TESTING_DIR) {
    // numpy/testing is a load-bearing exception: scipy.signal imports it at
    // import time (verified with numpy 2.4.6 / scipy 1.18.0), so deleting it
    // breaks the app with a missing-module error. numpy/testing/tests is still
    // pruned above by the `tests` rule.
    const isNumpyTesting =
      underSitePackages.length === 2 && underSitePackages[0] === NUMPY_DIR && underSitePackages[1] === TESTING_DIR;
    return !isNumpyTesting;
  }

  return false;
}

export function isPrunablePythonFile(relFile: string): boolean {
  return PIP_BIN_PATTERN.test(relFile);
}
