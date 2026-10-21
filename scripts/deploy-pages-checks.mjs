// Checks that `npm run deploy:pages` (scripts/deploy-pages.mjs) runs before it uploads a
// production build. Each check returns a list of problems; an empty list means it passed.
// They take plain data so the unit tests can drive them without git, gh, wrangler or a network.

export const STORAGE_WORKER_ASSET = /^projectStorage\.worker-[\w-]+\.js$/;

/** Files a release commit may change on top of a commit whose full CI run is green. */
const RELEASE_FILES = new Set(['src/version.ts', 'src/changelog-data.json', 'package.json', 'package-lock.json']);
/** In the package manifests a release changes nothing but the top-level version lines. */
const MANIFEST_FILES = new Set(['package.json', 'package-lock.json']);

/**
 * The build must come from the exact clean commit that is deployed, with the version the
 * manifest declares, so production diagnostics can name its source (`releaseId`).
 */
export function checkBuildInfo({ buildInfo, head, packageVersion, worktreeDirty }) {
  const problems = [];
  if (!buildInfo) return ['dist/build-info.json is missing; build with `npm run build:deploy` first'];
  if (buildInfo.schema !== 'masterselects-build/v1') problems.push(`dist/build-info.json has unknown schema ${buildInfo.schema}`);
  if (buildInfo.buildId === 'development') problems.push('dist was built by the dev server, not by `vite build`');
  if (buildInfo.sourceDirty !== false) problems.push('dist was built from a checkout with local changes (sourceDirty is not false)');
  if (buildInfo.sourceRevision !== head) problems.push(`dist was built from ${buildInfo.sourceRevision ?? 'an unknown commit'}, but HEAD is ${head}`);
  if (!buildInfo.releaseId) problems.push('dist/build-info.json has no releaseId');
  if (buildInfo.version !== packageVersion) problems.push(`dist reports version ${buildInfo.version}, package.json says ${packageVersion}`);
  if (worktreeDirty) problems.push('the checkout has local changes now; deploy only from a clean checkout');
  return problems;
}

/** The new build must be complete itself: its HTML entry chunks and its storage worker. */
export function checkOwnBuild({ indexHtmlReferences, hasAsset, assetNames }) {
  const problems = [];
  if (!indexHtmlReferences.size) problems.push('dist/index.html references no /assets/ entry chunk');
  for (const name of indexHtmlReferences) if (!hasAsset(name)) problems.push(`dist/index.html references missing asset ${name}`);
  if (!assetNames.some(name => STORAGE_WORKER_ASSET.test(name))) problems.push('dist/assets contains no projectStorage.worker-*.js');
  return problems;
}

/**
 * The previous (currently live) deployment's tabs must keep working after the deploy: its
 * entry chunks and its project storage worker must now be in dist/assets. Without them an
 * open tab cannot open panels or projects until it reloads.
 */
export function checkPreviousDeploymentRetained({ previous, hasAsset }) {
  if (!previous) return ['no previous production deployment was found; cannot prove old tabs keep their assets'];
  if (previous.error) return [`the previous deployment ${previous.origin} could not be crawled: ${previous.error}`];
  const problems = [];
  if (!previous.entries.size) problems.push(`the previous deployment ${previous.origin} served no entry page with /assets/ references`);
  for (const name of previous.entries) {
    if (!hasAsset(name)) problems.push(`entry asset ${name} of the previous deployment is not in dist/assets`);
  }
  const workers = [...previous.reachable].filter(name => STORAGE_WORKER_ASSET.test(name));
  if (!workers.length) problems.push(`no projectStorage.worker-*.js is reachable from the previous deployment ${previous.origin}`);
  for (const name of workers) {
    if (!hasAsset(name)) problems.push(`storage worker ${name} of the previous deployment is not in dist/assets`);
  }
  return problems;
}

/** True when a `git diff -U0` of the package manifests only changes their version lines. */
export function onlyVersionLinesChanged(diffText) {
  return diffText.split('\n').every((line) => {
    if (!/^[+-]/.test(line) || /^(?:\+\+\+|---) /.test(line)) return true;
    return /^[+-]\s*"version":\s*"[^"]*",?\s*$/.test(line);
  });
}

/**
 * A full `Security Checks` run must be green for the deployed commit. A release commit that
 * only bumps the version on top of a green commit counts as covered by that run.
 * `describeRange(sha)` returns `{ files, manifestDiff }` for sha..HEAD, or null when sha is
 * not an ancestor of HEAD.
 */
export function checkGreenCi({ head, successfulRuns, describeRange }) {
  if (successfulRuns.some(run => run.headSha === head)) return { problems: [], coveredBy: head };
  for (const run of successfulRuns) {
    const range = describeRange(run.headSha);
    if (!range) continue;
    // An empty file list means the same tree, e.g. a merge of the green branch.
    const onlyRelease = range.files.every(file => RELEASE_FILES.has(file));
    const manifestsOnlyVersion = !range.files.some(file => MANIFEST_FILES.has(file)) || onlyVersionLinesChanged(range.manifestDiff);
    if (onlyRelease && manifestsOnlyVersion) return { problems: [], coveredBy: run.headSha };
  }
  return {
    problems: [`no green Security Checks run for ${head} (or for a parent it only bumps the version of); run \`gh workflow run security.yml --ref <branch>\` and wait for it`],
    coveredBy: null,
  };
}
