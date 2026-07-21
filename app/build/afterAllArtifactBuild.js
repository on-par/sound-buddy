// electron-builder afterAllArtifactBuild hook (#622).
//
// electron-builder 24's notarizeIfProvided() is called with the .app path
// only, inside the sign phase — it notarizes + staples the .app, then builds
// the mac targets (zip, dmg) from that already-stapled bundle. The dmg
// therefore CONTAINS a stapled app but carries no ticket of its own, so
// `xcrun stapler validate` against the .dmg fails until something submits +
// staples the dmg itself. That "something" is this hook: it runs after every
// artifact is built, plans the work with the pure, tested
// planDmgNotarization(), and executes it. All decision logic (whether to
// notarize, which files, what args) lives in packages/shared — this file is
// deliberately a thin shell, same as afterPack.js.
//
// No try/catch: a notarization/staple failure here must abort the build so
// release.sh's `|| die` reports it — a release must never ship an unstapled
// dmg silently.

const { execFileSync } = require('child_process');
const path = require('path');
const { pathToFileURL } = require('url');

function log(msg) {
  console.log(`  • [dmg-notarize] ${msg}`);
}

module.exports = async function afterAllArtifactBuild(buildResult) {
  const shared = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'packages', 'shared', 'dist', 'index.js')).href
  );
  const plan = shared.planDmgNotarization(buildResult.artifactPaths || [], process.env);

  if (!plan.notarize) {
    log(plan.reason);
    return [];
  }

  for (const step of plan.steps) {
    log(`notarizing ${path.basename(step.dmgPath)} (this waits on Apple)`);
    execFileSync('xcrun', step.submitArgs, { stdio: 'inherit' });
    execFileSync('xcrun', step.stapleArgs, { stdio: 'inherit' });
  }

  return []; // no new artifacts — the dmg is stapled in place
};
