// Docs media runner: makes the docs pictures and clips from their recipes with one command, so new footage,
// a new design or a changed effect regenerates them. Recipes: scripts/docsMediaRecipes.mjs (the shot lists
// plus the basic stills and thumbnails of scripts/effect-docs.mjs); fingerprints: scripts/docsMediaFingerprint.mjs.
//
//   node scripts/docs-media.mjs                      # every recipe
//   node scripts/docs-media.mjs drift-lines blur     # these effect ids, picker groups or shot lists
//   node scripts/docs-media.mjs --stale [ids]        # only recipes whose recipe, effect code or media changed
//   node scripts/docs-media.mjs --list [ids]         # what would run, with each recipe's status
//   node scripts/docs-media.mjs --check              # stale assets as warnings (exit 0)
//   node scripts/docs-media.mjs --adopt [ids]        # record fingerprints without rendering: all assets that have
//                                                    # none, or every asset of the named recipes (stale ones too;
//                                                    # after a manifest merge conflict name the other side's ids)
//   options: --kinds still,basic-still,strip,graph,editor,clip,screenshot,thumb
//            --out <folder>   write under this folder instead of the repository (a scratch run; records nothing)
//            --url <vite>     reuse this Vite of the checkout (else DOCS_MEDIA_URL, else one is started and stopped)
//            --media <folder> footage for this run (default: the footage setting of scripts/docShotSettings.mjs)
//            --theme <mode>   editor theme for this run (default: the theme setting, dark)
//            --keep <folder>  keep the doc-clip exports there (doc-clip.mjs --reencode can reuse them)
//            --sheet <file>   where the contact sheet goes (default: <out>/contact-sheet.jpg or a temp folder)
// Prints a summary and writes a contact sheet of everything the run made (pages of 36 for a long run). A
// scratch run (--out) skips the screenshots, which only write into the repository. A run into the repository
// refreshes effects/catalog.json afterwards (node scripts/effect-docs.mjs).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT, docOutput } from './docShotSettings.mjs';
import { KINDS, collectRecipes, selectRecipes } from './docsMediaRecipes.mjs';
import { adoptable, effectCodeIndex, readManifest, recipeStatus, recordFingerprints } from './docsMediaFingerprint.mjs';
import { writeContactSheet } from './docsMediaSheet.mjs';
import { oldModules } from './docsMediaVite.mjs';
import { makeThumb } from './docShotThumb.mjs';
import { loadEffectSnapshot } from './effectDocsRegistry.mjs';

const VALUED = new Set(['--kinds', '--out', '--url', '--media', '--theme', '--keep', '--sheet']);
const argv = process.argv.slice(2);
const option = (name) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
const flag = (name) => argv.includes(name);
const ids = argv.filter((arg, index) => !arg.startsWith('--') && !VALUED.has(argv[index - 1]));
const unknownOptions = argv.filter((arg) => arg.startsWith('--') && !VALUED.has(arg) && !['--stale', '--list', '--check', '--adopt'].includes(arg));
if (unknownOptions.length) throw new Error(`Unknown option ${unknownOptions.join(', ')} (see the head of scripts/docs-media.mjs)`);
const kinds = option('--kinds')?.split(',').map((kind) => kind.trim()).filter(Boolean) ?? [];
const badKinds = kinds.filter((kind) => !KINDS.includes(kind));
if (badKinds.length) throw new Error(`Unknown kind ${badKinds.join(', ')}; kinds: ${KINDS.join(', ')}`);
if (option('--out')) process.env.DOCS_MEDIA_OUT_ROOT = path.resolve(option('--out'));
if (option('--theme')) process.env.DOCS_THEME = option('--theme');
const media = option('--media') ? path.resolve(option('--media')) : undefined;
const scratch = Boolean(process.env.DOCS_MEDIA_OUT_ROOT);
const started = Date.now();
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

const snapshot = await loadEffectSnapshot(REPO_ROOT);
const recipes = collectRecipes({ snapshot, media });
const code = effectCodeIndex();
const exists = (file) => fs.existsSync(path.join(REPO_ROOT, file));
const status = recipeStatus(recipes, { code, manifest: readManifest(), exists });
const { recipes: chosen, unknown } = selectRecipes(recipes, { ids, kinds, snapshot });
if (unknown.length) throw new Error(`No recipe for ${unknown.join(', ')}: name effect ids, picker groups (${snapshot.groups.map((group) => group.id).join(', ')}) or shot lists`);

// --stale: recipes whose fingerprint changed or whose output is missing, and the thumbnails cut from them.
let selected = chosen;
if (flag('--stale')) {
  const rebuilt = new Set(chosen.filter((recipe) => ['stale', 'missing'].includes(status.get(recipe))).flatMap((recipe) => recipe.outputs));
  selected = chosen.filter((recipe) => ['stale', 'missing'].includes(status.get(recipe))
    || (recipe.kind === 'thumb' && rebuilt.has(`docs/Features/${recipe.spec.source}`)));
}

if (flag('--list') || flag('--check')) {
  const counts = {};
  for (const recipe of selected) counts[status.get(recipe)] = (counts[status.get(recipe)] ?? 0) + 1;
  for (const recipe of selected) {
    const state = status.get(recipe);
    if (flag('--list') || state !== 'current') console.log(`${flag('--check') && state !== 'current' ? 'warning: ' : ''}${state.padEnd(8)} ${recipe.id} → ${recipe.outputs.join(', ')}`);
  }
  console.log(`${selected.length} recipes: ${Object.entries(counts).map(([state, count]) => `${count} ${state}`).join(', ') || 'none'}.`
    + (counts.stale || counts.missing ? ' Rebuild with node scripts/docs-media.mjs --stale.' : '')
    + (counts.unknown ? ' "unknown": made before fingerprints were kept; node scripts/docs-media.mjs --adopt records them as they are.' : ''));
  process.exit(0);
}

if (flag('--adopt')) {
  const adopt = adoptable(selected, status, { named: ids.length > 0 });
  recordFingerprints(adopt, { code });
  console.log(scratch ? 'A scratch run records nothing.' : `Recorded the fingerprints of ${adopt.length} recipes (${adopt.flatMap((recipe) => recipe.outputs).length} assets).`);
  process.exit(0);
}

if (!selected.length) {
  console.log(flag('--stale') ? 'Nothing is stale.' : 'No recipe selected.');
  process.exit(0);
}

// The run log and generated manifests: beside the contact sheet of a scratch run, else in a temp folder.
const work = scratch ? path.join(process.env.DOCS_MEDIA_OUT_ROOT, 'docs-media-run') : fs.mkdtempSync(path.join(os.tmpdir(), 'docs-media-'));
fs.mkdirSync(work, { recursive: true });
fs.rmSync(path.join(work, 'run.log'), { force: true });
const logFile = path.join(work, 'run.log');
const log = (text) => fs.appendFileSync(logFile, `${text}\n`);

/** A free TCP port on this machine. */
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
});
const reachable = async (url) => { try { return (await fetch(`${url}/tests/browser/effect-lab/index.html`)).ok; } catch { return false; } };

/** A Vite of this checkout: --url or DOCS_MEDIA_URL when it answers, else a new one on a free port (stopped at the end). */
async function ensureVite() {
  const given = option('--url') ?? process.env.DOCS_MEDIA_URL;
  if (given) {
    const url = given.replace(/\/$/u, '');
    if (!await reachable(url)) throw new Error(`No Vite answers at ${url}; start one in this checkout (npx vite --port <port> --strictPort) or leave --url out.`);
    // Vite serves /@fs/ only inside its own workspace: another checkout's Vite answers 403 here.
    const own = await fetch(`${url}/@fs${REPO_ROOT}/package.json`).then((response) => response.ok).catch(() => false);
    if (!own) {
      throw new Error(`${url} does not serve this checkout (${REPO_ROOT}): the pictures would show that checkout's code under this checkout's fingerprints. `
        + 'Start a Vite in this checkout (npx vite --port <port> --strictPort) and pass its --url, or leave --url out so the runner starts one.');
    }
    const { old, unchecked } = await oldModules(url, REPO_ROOT, [...new Set(selected.flatMap((recipe) => recipe.effects).flatMap((id) => code.codeFiles(id)))]);
    if (old.length) {
      throw new Error(`The Vite at ${url} serves older code than the files on disk (${old.slice(0, 5).join(', ')}${old.length > 5 ? ` and ${old.length - 5} more` : ''}): `
        + 'its file watcher missed edits (inotify watches used up?). Restart that Vite, or leave --url out so the runner starts a fresh one. '
        + 'Otherwise the pictures would show the old code under the fingerprint of the new.');
    }
    if (unchecked.length) {
      console.warn(`warning: could not compare ${unchecked.length} code files the Vite at ${url} serves with the disk; if one was edited, restart that Vite: `
        + `${unchecked.slice(0, 5).join(', ')}${unchecked.length > 5 ? ` and ${unchecked.length - 5} more` : ''}`);
    }
    return { url, stop: () => {} };
  }
  const port = await freePort();
  const vite = spawn(process.execPath, [path.join(REPO_ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'],
    { cwd: REPO_ROOT, stdio: ['ignore', fs.openSync(path.join(work, 'vite.log'), 'a'), fs.openSync(path.join(work, 'vite.log'), 'a')] });
  const url = `http://localhost:${port}`;
  for (let attempt = 0; attempt < 120 && !await reachable(url); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 500));
  if (!await reachable(url)) { vite.kill(); throw new Error(`The Vite started on port ${port} did not answer (log: ${path.join(work, 'vite.log')}).`); }
  console.log(`Started Vite of this checkout at ${url} (stopped after the run).`);
  return { url, stop: () => vite.kill() };
}

/** Runs one tool; its output goes to the run log. Resolves with the exit code and the output's last lines. */
function run(args, title) {
  return new Promise((resolve) => {
    log(`\n=== ${title}\n$ node ${args.join(' ')}`);
    const child = spawn(process.execPath, args, { cwd: REPO_ROOT, env: process.env });
    let tail = '';
    const take = (chunk) => { fs.appendFileSync(logFile, chunk); tail = `${tail}${chunk}`.slice(-4000); };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('close', (exitCode) => resolve({ exitCode, tail }));
  });
}

/** The command of one recipe kind for the recipes of one shot list. */
function command(kind, file, group, url) {
  const names = group.map((recipe) => recipe.name).join(',');
  const extra = [...media ? ['--media', media] : [], ...option('--keep') ? ['--keep', path.resolve(option('--keep'))] : []];
  if (kind === 'still') return ['scripts/effect-lab.mjs', '--pairs', file, '--only', names, '--url', url];
  if (kind === 'strip') return ['scripts/effect-lab.mjs', '--presets', file, '--only', names, '--url', url];
  if (kind === 'graph') return ['scripts/effect-graph-shot.mjs', '--manifest', file, '--only', names, '--url', url];
  if (kind === 'editor') return ['scripts/effect-editor-shot.mjs', file, '--only', names, '--url', url];
  if (kind === 'clip') return ['scripts/doc-clip.mjs', file, '--only', names, '--url', url, ...extra];
  if (kind === 'basic-still') {
    const manifest = path.join(work, 'basic-stills.json');
    fs.writeFileSync(manifest, JSON.stringify({ pairs: group.map((recipe) => recipe.spec) }, null, 1));
    return ['scripts/effect-lab.mjs', '--pairs', manifest, '--url', url];
  }
  throw new Error(`No command for ${kind}`);
}

const results = [];
let vite;
try {
  for (const kind of KINDS) {
    const ofKind = selected.filter((recipe) => recipe.kind === kind);
    if (!ofKind.length) continue;
    if (kind === 'thumb') {
      for (const recipe of ofKind) {
        const begin = Date.now();
        try {
          // A still this run rebuilt (in the scratch folder too) is the source; else the committed one.
          const source = [docOutput(`docs/Features/${recipe.spec.source}`), path.join(REPO_ROOT, 'docs/Features', recipe.spec.source)].find((file) => fs.existsSync(file));
          await makeThumb({ source, out: docOutput(recipe.outputs[0]), region: recipe.spec.region, fit: recipe.spec.fit });
          recordFingerprints([recipe], { code });
          results.push({ recipe, ok: true, ms: Date.now() - begin });
        } catch (error) {
          results.push({ recipe, ok: false, ms: Date.now() - begin, error: error.message });
        }
      }
      console.log(`thumb: ${ofKind.length} thumbnails`);
      continue;
    }
    if (kind === 'screenshot' && scratch) {
      // Not a failure: the screenshot tool writes into the repository only.
      for (const recipe of ofKind) results.push({ recipe, ok: true, skipped: true, ms: 0 });
      console.log(`screenshot: ${ofKind.length} skipped (capture-feature-doc-screenshots.mjs writes into the repository only; run without --out)`);
      continue;
    }
    vite ??= await ensureVite();
    const files = [...new Set(ofKind.map((recipe) => recipe.file))];
    for (const file of files) {
      const group = ofKind.filter((recipe) => recipe.file === file);
      const begin = Date.now();
      const title = `${kind} ${file}: ${group.map((recipe) => recipe.name).join(', ')}`;
      process.stdout.write(`${title} … `);
      const outcome = [];
      if (kind === 'screenshot') {
        for (const recipe of group) outcome.push(await run(['scripts/capture-feature-doc-screenshots.mjs', `--id=${recipe.name}`, `--base-url=${vite.url}`], title));
      } else {
        outcome.push(await run(command(kind, file, group, vite.url), title));
      }
      const failed = outcome.find((entry) => entry.exitCode !== 0);
      const ms = Date.now() - begin;
      console.log(failed ? `FAILED (${seconds(ms)})` : `ok (${seconds(ms)})`);
      if (failed) console.log(failed.tail.trim().split('\n').slice(-6).map((line) => `    ${line}`).join('\n'));
      // The shot scripts record their own fingerprints; the generated basic stills and screenshots are recorded here.
      if (!failed && ['basic-still', 'screenshot'].includes(kind)) recordFingerprints(group, { code });
      // When a shot list fails part-way, the entries it wrote before the failure still count (and show on the sheet).
      const wrote = (recipe) => recipe.outputs.every((output) => fs.existsSync(docOutput(output)) && fs.statSync(docOutput(output)).mtimeMs >= begin - 1000);
      for (const recipe of group) {
        const ok = !failed || wrote(recipe);
        results.push({ recipe, ok, ms: ms / group.length, error: ok ? undefined : failed.tail.trim().split('\n').at(-1) });
      }
    }
  }
} finally {
  vite?.stop();
}

// The contact sheet: every output this run wrote.
const made = results.filter((result) => result.ok && !result.skipped).flatMap(({ recipe }) => recipe.outputs.map((output) => ({ output, file: docOutput(output) })))
  .filter(({ file }) => fs.existsSync(file) && fs.statSync(file).mtimeMs >= started - 1000);
const sheetFile = path.resolve(option('--sheet') ?? (scratch ? path.join(process.env.DOCS_MEDIA_OUT_ROOT, 'contact-sheet.jpg') : path.join(work, 'contact-sheet.jpg')));
// A failing sheet must not cost the summary and the catalog refresh after hours of rendering.
const sheet = await writeContactSheet(made.map(({ output, file }) => ({ file, label: path.relative('docs/Features/assets', output) })), sheetFile,
  { title: `docs media ${new Date().toLocaleString('sv-SE').slice(0, 16)} · ${made.length} files${scratch ? ` · scratch: ${process.env.DOCS_MEDIA_OUT_ROOT}` : ''}` })
  .catch((error) => { console.warn(`warning: no contact sheet: ${error.message}`); return []; });

if (!scratch && made.length) {
  const refresh = await run(['scripts/effect-docs.mjs'], 'effect-docs');
  console.log(`effect-docs.mjs: ${refresh.tail.trim().split('\n').at(-1)}`);
}

const failures = results.filter((result) => !result.ok);
const skipped = results.filter((result) => result.skipped).length;
const after = recipeStatus(recipes, { code: effectCodeIndex(), manifest: readManifest(), exists });
const stillStale = recipes.filter((recipe) => after.get(recipe) === 'stale' || after.get(recipe) === 'missing');
console.log(`\n${results.length - failures.length - skipped} of ${results.length - skipped} recipes made${skipped ? ` (${skipped} skipped)` : ''}, ${made.length} files${scratch ? ` under ${process.env.DOCS_MEDIA_OUT_ROOT}` : ''}, in ${seconds(Date.now() - started)}.`);
for (const failure of failures) console.log(`  FAILED ${failure.recipe.id}: ${failure.error ?? ''}`);
const listed = (list) => `${list.slice(0, 20).map((recipe) => recipe.id).join(', ')}${list.length > 20 ? ` and ${list.length - 20} more (--check lists them)` : ''}`;
if (!scratch) console.log(stillStale.length ? `Still stale: ${stillStale.length}: ${listed(stillStale)}` : 'No stale assets left.');
console.log(`Contact sheet: ${sheet.length ? sheet.join(', ') : '(nothing made)'}\nLog: ${logFile}`);
if (failures.length) process.exitCode = 1;
