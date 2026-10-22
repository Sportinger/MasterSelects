// Fingerprints of the docs pictures and clips: what an asset was made from, so a changed recipe,
// effect or footage marks it stale. A fingerprint hashes
//   - the recipe (its shot-list entry, or the generated basic still, as JSON),
//   - the effect's own code: the file that defines it, the operator-graph files that test an effect type
//     against its id, the graph a catalog hub registers for it, and the files these import (shader,
//     parameters, limits). Left out: the shared engine (files more than six files import), catalog hubs
//     (files that name more than three effect ids, such as the graph owner), registries (files that import
//     more than eight), and another effect's code (a file that names other effects but not this one). In a
//     family file that defines several effects, only the imports its own definition uses count. So an edit to
//     one effect marks only its own pictures stale (and its family's, for a shared family shader),
//   - the media it reads: the footage, test image or (for a thumbnail) the still it is cut from,
//   - the editor theme, for pictures of the editor.
// scripts/docs-media-manifest.json keeps the fingerprint of every asset as it was rendered, one line
// per asset; the tools write it after each render (never in a scratch run).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, scratchRun } from './docShotSettings.mjs';

export const MANIFEST_FILE = 'scripts/docs-media-manifest.json';
/** Where effect code lives: the effects, their operator graphs and shaders, and the services of one effect family. */
const CODE_SCOPES = ['src/effects', 'src/services/operators', 'src/shaders', 'src/services/faceCables', 'src/services/planarTracking'];
/** A file imported by more than this many files is shared engine code, not one effect's. */
const SHARED_IMPORTERS = 6;
/** A file that names more effect ids than this is a catalog hub (graph owner, presentation plans), not one effect's code. */
const HUB_IDS = 3;
/** A file that imports more code files than this is a registry (all compositions, all graphs), not one effect's code. */
const REGISTRY_IMPORTS = 8;
/** Registry and type hubs that name every effect id but are no effect's code. */
const CODE_HUBS = new Set(['src/effects/types.ts', 'src/effects/index.ts', 'src/effects/effectCatalogGroups.ts']);
/** The picker groups list every effect id once. */
const GROUPS_FILE = 'src/effects/effectCatalogGroups.ts';

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
  // Which effect ids each file names as an effect (defines, compares a type to, lists in a set or union),
  // to tell one effect's code from a hub or another effect's code. A plain value ('wave' as an option, a node
  // named 'threshold') does not count.
  const groupsText = texts.get(GROUPS_FILE) ?? '';
  const effectIds = new Set([...groupsText.matchAll(/effects:\s*\[([^\]]*)\]/gu)]
    .flatMap((match) => [...match[1].matchAll(/['"]([a-z0-9-]+)['"]/gu)].map((id) => id[1])));
  const asEffect = /(?:\bid:\s*|_ID\s*=\s*|[=!]==\s*|\bcase\s+|\|\s*|\[\s*|,\s*)['"]([a-z0-9][a-z0-9-]*)['"]|['"]([a-z0-9][a-z0-9-]*)['"]\s*(?:\||[=!]==)/gu;
  const named = new Map([...texts].map(([file, text]) => [file,
    new Set([...text.matchAll(asEffect)].map((match) => match[1] ?? match[2]).filter((id) => effectIds.has(id)))]));
  const compact = (text) => text.toLowerCase().replace(/[^a-z0-9]/gu, '');
  const byLength = [...effectIds].toSorted((a, b) => b.length - a.length);
  const nameOwner = (file) => {
    const base = compact(path.posix.basename(file).replace(/\.[a-z]+$/u, ''));
    return byLength.find((effectId) => base.startsWith(compact(effectId)));
  };
  const shared = (file) => CODE_HUBS.has(file) || (importers.get(file) ?? 0) > SHARED_IMPORTERS || named.get(file).size > HUB_IDS;
  const registry = (file) => (imports.get(file) ?? []).length > REGISTRY_IMPORTS;
  // A family file defines several effects (one shader, one definition each): from it, follow only the imports
  // its own definition uses, or that no other definition of the family uses (the shader, the shared helpers).
  const definitionBlocks = (file) => texts.get(file).split(/\n(?=(?:export\s+)?(?:const|function|let)\s)/u);
  const importNames = (file) => {
    const names = new Map();
    for (const match of texts.get(file).matchAll(/import\s+(?:type\s+)?([^'";]*?)\s+from\s*['"]([^'"]+)['"]/gu)) {
      const target = resolve(file, match[2]);
      if (!target) continue;
      const locals = match[1].replace(/[{}]/gu, ' ').split(/[\s,]+/u).filter((word) => word && word !== 'as' && word !== 'type' && word !== '*');
      names.set(target, [...names.get(target) ?? [], ...locals]);
    }
    return names;
  };
  const followed = (file, id, defines) => {
    const targets = imports.get(file) ?? [];
    const blocks = definitionBlocks(file).filter((block) => /\bid:\s*['"]|_ID\s*=\s*['"]/u.test(block));
    if (blocks.length < 2 || !defines.test(texts.get(file))) return targets;
    const own = blocks.filter((block) => defines.test(block)).join('\n');
    const others = blocks.filter((block) => !defines.test(block)).join('\n');
    const names = importNames(file);
    const uses = (text, local) => new RegExp(`\\b${local}\\b`, 'u').test(text);
    return targets.filter((target) => {
      const locals = names.get(target) ?? [];
      return !locals.length || locals.some((local) => uses(own, local) || !uses(others, local));
    });
  };
  const cache = new Map();
  /** The files of one effect's own code, sorted. */
  const codeFiles = (id) => {
    if (cache.has(id)) return cache.get(id);
    const literal = id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const defines = new RegExp(`(?:\\bid:\\s*|_ID\\s*=\\s*)['"]${literal}['"]`, 'u');
    // An operator file is the effect's when it tests an effect type against the id (`type === 'wave'`), declares
    // it in a type (`type X = 'wave' | ...`) or keys a graph by it; a bare `case 'wave'` of a curve shape is not.
    const typeRef = new RegExp(`(?:[Tt]ype\\s*[=!]==\\s*|\\btype:\\s*)['"]${literal}['"]|['"]${literal}['"]\\s*[=!]==\\s*[\\w.]*[Tt]ype\\b|^(?:export\\s+)?type\\s+\\w+\\s*=.*['"]${literal}['"]`, 'mu');
    // Roots: the definition (always, even in a family file that defines several effects), and the operator
    // files that name the effect, unless they are shared engine or a catalog hub.
    const roots = files.filter((file) => !CODE_HUBS.has(file) && (
      (file.startsWith('src/effects/') && defines.test(texts.get(file)))
      || (file.startsWith('src/services/operators/') && typeRef.test(texts.get(file)) && !shared(file))));
    // A catalog hub (the graph owner) registers the effect's graph next to its id: `type === 'id' ? createGraph`.
    // The imported names right after the id, up to the next quote, are the effect's own code too.
    for (const file of files.filter((candidate) => candidate.startsWith('src/services/operators/') && shared(candidate) && !CODE_HUBS.has(candidate) && named.get(candidate).has(id))) {
      const names = importNames(file);
      const near = [...texts.get(file).matchAll(new RegExp(`['"]${literal}['"]([^'"\\n]{0,160})`, 'gu'))].map((match) => match[1]).join(' ');
      const words = new Set(near.match(/[A-Za-z_$][\w$]*/gu) ?? []);
      for (const [target, locals] of names) if (locals.some((local) => words.has(local)) && !shared(target)) roots.push(target);
    }
    // The walk does not enter another effect's code: a file that names other effects but not this one.
    // So is a file named after another effect (driftLines.ts, glowSampling.ts), by the longest effect id it starts with.
    const otherEffect = (file) => (named.get(file).size > 0 && !named.get(file).has(id)) || ![undefined, id].includes(nameOwner(file));
    const seen = new Set();
    const stack = [...roots];
    while (stack.length) {
      const file = stack.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      stack.push(...followed(file, id, defines).filter((target) => !shared(target) && !registry(target) && !otherEffect(target)));
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

/** What a render read besides its recipe: the hash of the effect code and of each media file. */
export function fingerprintParts(recipe, { code }) {
  return { code: recipe.effects.length ? code.codeHash(recipe.effects) : undefined, inputs: recipe.inputs.map((file) => mediaHash(file)) };
}

/**
 * The fingerprint of a recipe (see docsMediaRecipes.mjs): 16 hex digits. `inputs` are absolute media
 * files; `code` the effect code index. `parts` (fingerprintParts saved when the render was made) stands in
 * for the code and media of today, for a clip encoded again from kept exports.
 */
export function recipeFingerprint(recipe, { code, parts }) {
  return sha(canonical({ kind: recipe.kind, spec: recipe.spec, theme: recipe.theme, ...(parts ?? fingerprintParts(recipe, { code })) })).slice(0, 16);
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

/** The code index for recording (built once per root: the code does not change during a run). */
export function recordIndex(root = REPO_ROOT) {
  if (!recordIndexes.has(root)) recordIndexes.set(root, effectCodeIndex(root));
  return recordIndexes.get(root);
}

/**
 * Records the fingerprint of these rendered recipes for their outputs (never in a scratch run). `parts`: the
 * code and media the render was made from, when that is not today's (a clip encoded again from kept exports).
 */
export function recordFingerprints(recipes, { code, root = REPO_ROOT, env = process.env, parts } = {}) {
  if (scratchRun(env) || !recipes.length) return;
  const index = code ?? recordIndex(root);
  const assets = readManifest(root);
  for (const recipe of recipes) {
    const fingerprint = recipeFingerprint(recipe, { code: index, parts });
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
