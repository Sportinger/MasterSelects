// The one production deploy path for Cloudflare Pages (`npm run deploy:pages`).
//
// Tabs opened before a deploy keep running the old build and lazily load its hashed chunk and
// worker names. Those only stay available when the new upload carries them too
// (scripts/retain-deployed-assets.mjs). Running `wrangler pages deploy` by hand skips that step
// silently, so this script refuses to deploy unless:
//   1. a full `Security Checks` run is green for HEAD (or HEAD only bumps the version of it),
//   2. dist was built by `vite build` from exactly this clean commit and package version,
//   3. the new build has its entry chunks and its projectStorage.worker-*.js,
//   4. after retention, dist/assets holds the live deployment's entry chunks and storage worker.
// Only then it runs `wrangler pages deploy dist --project-name masterselects --branch main`.
//
// Usage: node scripts/deploy-pages.mjs [--dry-run] [--skip-build] [--keep 8]
//          [--project masterselects] [--branch main] [--dist dist]
// --dry-run runs every check (including the build and the retention into dist) and prints the
// deploy command instead of running it. --skip-build reuses an existing dist (still checked).
// A --dist other than dist needs --skip-build: `npm run build:deploy` always writes dist (build
// elsewhere with `vite build --outDir <dir>` first).
//
// No shebang on purpose: npm runs this with node, and a CRLF after a shebang (Windows checkout
// without the .gitattributes eol rule) breaks the vitest import of this module.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractAssetReferences, listProductionOrigins, retainFromOrigin } from './retain-deployed-assets.mjs';
import { checkBuildInfo, checkGreenCi, checkOwnBuild, checkPreviousDeploymentRetained } from './deploy-pages-checks.mjs';
import { runCommand } from './run-command.mjs';

export function parseDeployArgs(argv) {
  const options = { dryRun: false, skipBuild: false, keep: 8, project: 'masterselects', branch: 'main', dist: 'dist' };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === '--dry-run') options.dryRun = true;
    else if (name === '--skip-build') options.skipBuild = true;
    else if (name === '--keep') { options.keep = Number(value); index += 1; }
    else if (name === '--project') { options.project = value; index += 1; }
    else if (name === '--branch') { options.branch = value; index += 1; }
    else if (name === '--dist') { options.dist = value; index += 1; }
    else throw new Error(`Unknown argument: ${name}`);
  }
  if (!Number.isInteger(options.keep) || options.keep < 1) throw new Error('--keep needs a positive integer');
  return options;
}

export class DeployGuardError extends Error {
  constructor(step, problems) {
    super(`${step} failed:\n  - ${problems.join('\n  - ')}`);
    this.name = 'DeployGuardError';
    this.step = step;
    this.problems = problems;
  }
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

function requireNone(step, problems) {
  if (problems.length) throw new DeployGuardError(step, problems);
}

// Tracked output of docs-site/scripts/sync-features.mjs, which `npm run docs:build` regenerates
// from docs/Features at HEAD. A stale sync makes the build rewrite these; that is derived content
// of committed sources, so it does not block the deploy (but should be committed afterwards).
const DOCS_SYNC_OUTPUTS = [
  'docs-site/src/content/docs/features/',
  'docs-site/src/content/docs/getting-started/overview.md',
  'docs-site/public/assets/',
];

function changedPaths(run, cwd) {
  return run('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd })
    .split('\n').filter(line => line.trim()).map(line => line.slice(3).trim());
}

export function isDocsSyncOutput(file) {
  return DOCS_SYNC_OUTPUTS.some(prefix => file === prefix || file.startsWith(prefix));
}

function describeRange(run, cwd, sha) {
  try { run('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd }); } catch { return null; }
  const files = run('git', ['diff', '--name-only', sha, 'HEAD'], { cwd }).split('\n').filter(Boolean);
  const manifestDiff = run('git', ['diff', '-U0', sha, 'HEAD', '--', 'package.json', 'package-lock.json'], { cwd });
  return { files, manifestDiff };
}

const GH_REQUIRED = 'it is required to prove a green Security Checks run for this commit';

/** Successful Security Checks runs, with a clear message when gh is missing or not logged in. */
function listGreenSecurityRuns(run, cwd) {
  let output;
  try {
    output = run('gh', ['run', 'list', '--workflow', 'security.yml', '--status', 'success',
      '--limit', '200', '--json', 'headSha'], { cwd });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new DeployGuardError('CI check', [`GitHub CLI gh was not found; install it and run \`gh auth login\` (${GH_REQUIRED})`]);
    }
    const detail = String(error?.stderr || error?.message || error).trim().split('\n').find(Boolean) ?? 'unknown error';
    const unauthenticated = /auth login|not logged in|authenticat|GH_TOKEN|HTTP 401/i.test(detail);
    throw new DeployGuardError('CI check', [unauthenticated
      ? `GitHub CLI gh is not authenticated; run \`gh auth login\` (${GH_REQUIRED}): ${detail}`
      : `gh run list failed (${GH_REQUIRED}): ${detail}`]);
  }
  try {
    const runs = JSON.parse(output || '[]');
    if (Array.isArray(runs)) return runs;
  } catch { /* reported below */ }
  throw new DeployGuardError('CI check', [`gh run list returned no JSON list: ${String(output).slice(0, 200)}`]);
}

/**
 * Runs the guarded deploy. `run(command, args, { cwd, inherit })` executes a program and returns
 * its stdout (throwing on a non-zero exit); tests replace it and the global fetch.
 */
export async function deployPages({ argv = [], cwd = process.cwd(), run = runCommand, log = console.log } = {}) {
  const options = parseDeployArgs(argv);
  const dist = path.resolve(cwd, options.dist);
  if (!options.skipBuild && dist !== path.resolve(cwd, 'dist')) {
    throw new DeployGuardError('Argument check', [`--dist ${options.dist} needs --skip-build: npm run build:deploy writes dist; build into ${options.dist} with \`vite build --outDir ${options.dist}\` first`]);
  }
  const assetsDir = path.join(dist, 'assets');

  const head = run('git', ['rev-parse', 'HEAD'], { cwd }).trim();
  const ciRuns = listGreenSecurityRuns(run, cwd);
  const ci = checkGreenCi({ head, successfulRuns: ciRuns, describeRange: sha => describeRange(run, cwd, sha) });
  requireNone('CI check', ci.problems);
  log(`[deploy-pages] Security Checks green for ${ci.coveredBy}${ci.coveredBy === head ? '' : ` (HEAD ${head} only bumps the version)`}`);

  // The checkout must be clean before the build; the build itself may rewrite derived docs-site files.
  const changedBefore = changedPaths(run, cwd);
  const worktreeDirty = changedBefore.length > 0;
  if (!options.skipBuild) {
    if (worktreeDirty) {
      throw new DeployGuardError('Checkout check', [`the checkout has local changes (${changedBefore.join(', ')}); deploy only from a clean checkout`]);
    }
    log('[deploy-pages] building with npm run build:deploy');
    run('npm', ['run', 'build:deploy'], { cwd, inherit: true });
    const changedByBuild = changedPaths(run, cwd);
    const unexpected = changedByBuild.filter(file => !isDocsSyncOutput(file));
    if (unexpected.length) {
      throw new DeployGuardError('Build check', [`the build changed files outside the docs-site sync output: ${unexpected.join(', ')}`]);
    }
    if (changedByBuild.length) {
      log(`[deploy-pages] note: docs:build re-synced ${changedByBuild.length} docs-site file(s) from docs/Features; commit the docs-site sync after this deploy (${changedByBuild.join(', ')})`);
    }
  }

  const packageVersion = readJson(path.join(cwd, 'package.json'))?.version;
  requireNone('Build check', checkBuildInfo({ buildInfo: readJson(path.join(dist, 'build-info.json')), head, packageVersion, worktreeDirty }));
  if (!existsSync(assetsDir)) throw new DeployGuardError('Build check', [`${assetsDir} does not exist`]);
  const indexHtml = existsSync(path.join(dist, 'index.html')) ? readFileSync(path.join(dist, 'index.html'), 'utf8') : '';
  const hasAsset = name => existsSync(path.join(assetsDir, name));
  requireNone('Build check', checkOwnBuild({ indexHtmlReferences: extractAssetReferences(indexHtml), hasAsset, assetNames: readdirSync(assetsDir) }));

  const origins = listProductionOrigins(options.project, options.keep, (command, args) => run(command, args, { cwd }));
  const totals = { copied: new Set() };
  const results = [];
  for (const { origin, source } of origins) {
    try {
      const result = await retainFromOrigin(origin, assetsDir, totals);
      results.push({ origin, ...result });
      log(`[deploy-pages] retained from ${origin} (${source}): copied ${result.copied}, already present ${result.present}, unavailable ${result.missing}`);
    } catch (error) {
      results.push({ origin, error: error instanceof Error ? error.message : String(error) });
      log(`[deploy-pages] ${origin} (${source}) could not be retained: ${results.at(-1).error}`);
    }
  }
  requireNone('Retained-asset check', checkPreviousDeploymentRetained({ previous: results[0], hasAsset }));
  log(`[deploy-pages] dist/assets keeps the live deployment's entry chunks and storage worker (${totals.copied.size} files retained from ${origins.length} deployments)`);

  const deployArgs = ['wrangler', 'pages', 'deploy', options.dist, '--project-name', options.project, '--branch', options.branch];
  if (options.dryRun) {
    log(`[deploy-pages] dry run: all checks passed; would run: npx ${deployArgs.join(' ')}`);
    return { deployed: false, head, deployArgs };
  }
  run('npx', deployArgs, { cwd, inherit: true });
  log('[deploy-pages] deployed; check /build-info.json on www.masterselects.com');
  return { deployed: true, head, deployArgs };
}

// Compare file URLs (not `file://${argv[1]}`) so the entry check also matches Windows drive paths,
// paths that need URL encoding, and symlinked script paths.
function isEntrypoint() {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href; } catch { return false; }
}

if (isEntrypoint()) {
  deployPages({ argv: process.argv.slice(2) }).catch((error) => {
    console.error(`[deploy-pages] NOT DEPLOYED. ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
