#!/usr/bin/env node
// Copies the hashed /assets/ files of recent production deployments into the
// new build before it is deployed.
//
// Cloudflare Pages serves only the files of the active deployment. A tab that
// was opened before a deploy still runs the old entry chunk and lazily imports
// old chunk names (App-<hash>.js, ExportPanel-<hash>.css, workers, wasm). Those
// requests 404 once the new deployment is live, unless the edge cache happens
// to hold them, so the tab fails to open panels or projects. Keeping the old
// files next to the new ones lets old tabs keep working until they reload.
// Pages deduplicates uploads by content hash, so retained files cost no upload.
//
// Usage: node scripts/retain-deployed-assets.mjs [--dist dist] [--project masterselects]
//          [--keep 6] [--origin https://<id>.masterselects.pages.dev ...] [--strict]
// Production deploys go through `npm run deploy:pages` (scripts/deploy-pages.mjs), which runs
// this retention and refuses to deploy unless the previous deployment's entry chunks and
// project storage worker ended up in dist/assets.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ASSET_NAME = String.raw`[A-Za-z0-9_][A-Za-z0-9_.-]*\.(?:js|mjs|css|wasm|webp|jpe?g|png|svg|ttf|woff2?|gz|json)`;
// Vite references chunks as "./name.js" (dynamic import), "assets/name.js"
// (preload lists) and "/assets/name.js" (workers, CSS urls).
const ASSET_REFERENCE = new RegExp(String.raw`(?:\./|/?assets/)(${ASSET_NAME})`, 'g');
const PARSED_EXTENSIONS = new Set(['.js', '.mjs', '.css']);
const ENTRY_PAGES = ['/', '/editor', '/index.html', '/app-bootstrap.js'];
const CONCURRENCY = 8;

function parseArgs(argv) {
  const options = { dist: 'dist', project: 'masterselects', keep: 6, origins: [], strict: false };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === '--strict') options.strict = true;
    else if (name === '--dist') { options.dist = value; index += 1; }
    else if (name === '--project') { options.project = value; index += 1; }
    else if (name === '--keep') { options.keep = Number(value); index += 1; }
    else if (name === '--origin') { options.origins.push(value.replace(/\/+$/, '')); index += 1; }
    else throw new Error(`Unknown argument: ${name}`);
  }
  if (!Number.isInteger(options.keep) || options.keep < 1) throw new Error('--keep needs a positive integer');
  return options;
}

function runCommand(command, args) {
  // npx is a .cmd shim on Windows, which execFile only starts through a shell.
  return execFileSync(command, args, { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The newest `keep` production deployments, newest (the live one) first. */
export function listProductionOrigins(project, keep, run = runCommand) {
  const output = run('npx', ['wrangler', 'pages', 'deployment', 'list',
    '--project-name', project, '--environment', 'production', '--json']);
  const start = output.indexOf('[');
  if (start < 0) throw new Error('wrangler pages deployment list returned no JSON list');
  const deployments = JSON.parse(output.slice(start));
  // Newest first, as wrangler lists them.
  return deployments.slice(0, keep).map(item => ({ origin: String(item.Deployment).replace(/\/+$/, ''), source: item.Source }));
}

export function extractAssetReferences(text) {
  const names = new Set();
  for (const match of text.matchAll(ASSET_REFERENCE)) names.add(match[1]);
  return names;
}

async function fetchAsset(url) {
  let response;
  try { response = await fetch(url, { redirect: 'follow' }); } catch { return { status: 'network' }; }
  if (!response.ok) return { status: response.status };
  // An unknown path must never be retained as an asset (SPA fallback HTML).
  if ((response.headers.get('content-type') ?? '').startsWith('text/html')) return { status: 'html' };
  return { status: 200, bytes: Buffer.from(await response.arrayBuffer()) };
}

/**
 * Copies every asset reachable from one deployment's entry pages into `assetsDir`. Returns the
 * names its entry pages reference directly (`entries`) and every name the crawl reached
 * (`reachable`), so a caller can check that the important ones really landed.
 */
export async function retainFromOrigin(origin, assetsDir, totals = { copied: new Set() }) {
  const queue = new Set();
  for (const page of ENTRY_PAGES) {
    try {
      const response = await fetch(`${origin}${page}`);
      if (response.ok) for (const name of extractAssetReferences(await response.text())) queue.add(name);
    } catch { /* A missing entry page only narrows the crawl. */ }
  }
  const seen = new Set(queue);
  const pending = [...queue];
  const result = { copied: 0, present: 0, missing: 0, unavailable: [], entries: new Set(queue), reachable: seen };
  while (pending.length) {
    const batch = pending.splice(0, CONCURRENCY);
    await Promise.all(batch.map(async (name) => {
      const target = path.join(assetsDir, name);
      const parse = PARSED_EXTENSIONS.has(path.extname(name));
      let bytes;
      // Hashed names are immutable: an existing file already holds these bytes.
      if (existsSync(target)) {
        result.present += 1;
        if (parse) bytes = readFileSync(target);
      } else {
        const fetched = await fetchAsset(`${origin}/assets/${name}`);
        if (fetched.status !== 200) { result.missing += 1; result.unavailable.push(`${name} (${fetched.status})`); return; }
        writeFileSync(target, fetched.bytes);
        result.copied += 1; totals.copied.add(name);
        bytes = fetched.bytes;
      }
      if (parse) for (const reference of extractAssetReferences(bytes.toString('utf8'))) {
        if (!seen.has(reference)) { seen.add(reference); pending.push(reference); }
      }
    }));
  }
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const assetsDir = path.resolve(options.dist, 'assets');
  if (!existsSync(assetsDir)) throw new Error(`${assetsDir} does not exist; build first`);
  const origins = options.origins.length
    ? options.origins.map(origin => ({ origin, source: 'manual' }))
    : listProductionOrigins(options.project, options.keep);
  const totals = { copied: new Set() };
  let failures = 0;
  for (const { origin, source } of origins) {
    try {
      const result = await retainFromOrigin(origin, assetsDir, totals);
      console.log(`[retain-assets] ${origin} (${source}): copied ${result.copied}, already present ${result.present}, unavailable ${result.missing}`);
      if (result.unavailable.length) console.log(`[retain-assets]   unavailable: ${result.unavailable.join(', ')}`);
    } catch (error) {
      failures += 1;
      console.warn(`[retain-assets] ${origin} (${source}) failed: ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log(`[retain-assets] retained ${totals.copied.size} files from ${origins.length} deployments in ${assetsDir}`);
  if (failures && options.strict) process.exitCode = 1;
}

// Compare file URLs (not `file://${argv[1]}`) so the entry check also matches Windows drive paths,
// paths that need URL encoding, and symlinked script paths.
function isEntrypoint() {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href; } catch { return false; }
}

if (isEntrypoint()) {
  main().catch((error) => { console.error(`[retain-assets] ${error instanceof Error ? error.message : error}`); process.exitCode = 1; });
}
