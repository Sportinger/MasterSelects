// Fingerprints of the docs pictures and clips: what an asset was made from, so a changed recipe,
// effect or footage marks it stale. A fingerprint hashes
//   - the recipe (its shot-list entry, or the generated basic still, as JSON),
//   - the effect's own code: the file that defines it, the operator-graph files that name it, and the
//     files these import (shader, parameters, limits), leaving out files that more than six files import
//     (the editor's shared engine: a change there does not mark every picture stale),
//   - the media it reads: the footage, test image or (for a thumbnail) the still it is cut from,
//   - the editor theme, for pictures of the editor.
// scripts/docs-media-manifest.json keeps the fingerprint of every asset as it was rendered, one line
// per asset; the tools write it after each render (never in a scratch run).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, scratchRun } from './docShotSettings.mjs';

export const MANIFEST_FILE = 'scripts/docs-media-manifest.json';
const CODE_SCOPES = ['src/effects', 'src/services/operators', 'src/shaders'];
/** A file imported by more than this many files is shared engine code, not one effect's. */
const SHARED_IMPORTERS = 6;
/** Registry and type hubs that name every effect id but are no effect's code. */
const CODE_HUBS = new Set(['src/effects/types.ts', 'src/effects/index.ts', 'src/effects/effectCatalogGroups.ts']);

const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const canonical = (value) => (Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).toSorted().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value));

/** The import graph of the effect code, read once per root. */
export function effectCodeIndex(root = REPO_ROOT) {
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(path.join(root, dir))) return;
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (/\.(ts|tsx|wgsl|glsl|mjs|js)$/u.test(entry.name) && !/\.test\./u.test(entry.name)) files.push(file);
    }
  };
  CODE_SCOPES.forEach(walk);
  const known = new Set(files);
  const texts = new Map(files.map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
  const resolve = (from, spec) => {
    const base = (spec.startsWith('.') ? path.posix.join(path.posix.dirname(from), spec) : spec.startsWith('@/') ? `src/${spec.slice(2)}` : '')
      .replace(/\?[a-z]+$/u, '');
    return base ? [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}.js`, `${base}.mjs`].find((file) => known.has(file)) : undefined;
  };
  const imports = new Map();
  const importers = new Map();
  for (const [file, text] of texts) {
    const specs = [...text.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/gu)]
      .map((match) => match[1] ?? match[2] ?? match[3]);
    const targets = [...new Set(specs.map((spec) => resolve(file, spec)).filter(Boolean))];
    imports.set(file, targets);
    for (const target of targets) importers.set(target, (importers.get(target) ?? 0) + 1);
  }
  const cache = new Map();
  /** The files of one effect's own code, sorted. */
  const codeFiles = (id) => {
    if (cache.has(id)) return cache.get(id);
    const literal = id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const quoted = new RegExp(`['"]${literal}['"]`, 'u');
    const defines = new RegExp(`(?:\\bid:\\s*|_ID\\s*=\\s*)['"]${literal}['"]`, 'u');
    const roots = files.filter((file) => !CODE_HUBS.has(file) && (
      (file.startsWith('src/effects/') && defines.test(texts.get(file)))
      || (file.startsWith('src/services/operators/') && quoted.test(texts.get(file)))));
    const seen = new Set();
    const stack = [...roots];
    while (stack.length) {
      const file = stack.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      stack.push(...(imports.get(file) ?? []).filter((target) => !CODE_HUBS.has(target) && (importers.get(target) ?? 0) <= SHARED_IMPORTERS));
    }
    const result = [...seen].toSorted();
    cache.set(id, result);
    return result;
  };
  const codeHash = (ids) => sha([...new Set(ids.flatMap(codeFiles))].toSorted().map((file) => `${file}\0${texts.get(file)}`).join('\0'));
  return { codeFiles, codeHash };
}

const fileHashes = new Map();
/** Content hash of a media file (cached by path, size and time), or "missing". */
export function mediaHash(file) {
  if (!file || !fs.existsSync(file)) return 'missing';
  const stat = fs.statSync(file);
  const key = `${file}:${stat.size}:${stat.mtimeMs}`;
  if (!fileHashes.has(key)) fileHashes.set(key, sha(fs.readFileSync(file)));
  return fileHashes.get(key);
}

/**
 * The fingerprint of a recipe (see docsMediaRecipes.mjs): 16 hex digits. `inputs` are absolute media
 * files; `code` the effect code index.
 */
export function recipeFingerprint(recipe, { code }) {
  return sha(canonical({
    kind: recipe.kind, spec: recipe.spec, theme: recipe.theme,
    code: recipe.effects.length ? code.codeHash(recipe.effects) : undefined,
    inputs: recipe.inputs.map((file) => mediaHash(file)),
  })).slice(0, 16);
}

export function readManifest(root = REPO_ROOT) {
  const file = path.join(root, MANIFEST_FILE);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).assets ?? {} : {};
}

/** One line per asset, sorted, so parallel branches merge cleanly. */
export function manifestText(assets) {
  const about = 'Written by the docs media tools (node scripts/docs-media.mjs and the shot scripts) after each render: the fingerprint of every docs picture and clip, so node scripts/docs-media.mjs --stale rebuilds what changed. On a merge conflict, take either side and run node scripts/docs-media.mjs --adopt.';
  const lines = Object.keys(assets).toSorted().map((asset) => `    ${JSON.stringify(asset)}: ${JSON.stringify(assets[asset])}`);
  return `{\n  "about": ${JSON.stringify(about)},\n  "assets": {\n${lines.join(',\n')}\n  }\n}\n`;
}

/** One code index per root for the tools that record after each render (the code does not change during a run). */
const recordIndexes = new Map();

/** Records the fingerprint of these rendered recipes for their outputs (never in a scratch run). */
export function recordFingerprints(recipes, { code, root = REPO_ROOT, env = process.env } = {}) {
  if (scratchRun(env) || !recipes.length) return;
  if (!code && !recordIndexes.has(root)) recordIndexes.set(root, effectCodeIndex(root));
  const index = code ?? recordIndexes.get(root);
  const assets = readManifest(root);
  for (const recipe of recipes) {
    const fingerprint = recipeFingerprint(recipe, { code: index });
    for (const output of recipe.outputs) assets[output] = { recipe: recipe.id, fingerprint };
  }
  fs.writeFileSync(path.join(root, MANIFEST_FILE), manifestText(assets));
}

/**
 * Status of each recipe against the manifest: "current", "stale" (recipe, code or media changed),
 * "unknown" (no fingerprint recorded yet) or "missing" (an output file does not exist).
 */
export function recipeStatus(recipes, { code, manifest, exists }) {
  return new Map(recipes.map((recipe) => {
    if (recipe.outputs.some((output) => !exists(output))) return [recipe, 'missing'];
    const recorded = recipe.outputs.map((output) => manifest[output]);
    if (recorded.some((entry) => !entry)) return [recipe, 'unknown'];
    const fingerprint = recipeFingerprint(recipe, { code });
    return [recipe, recorded.every((entry) => entry.fingerprint === fingerprint && entry.recipe === recipe.id) ? 'current' : 'stale'];
  }));
}
