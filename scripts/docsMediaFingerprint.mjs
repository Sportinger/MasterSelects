// Fingerprints of the docs pictures and clips: what an asset was made from, so a changed recipe,
// effect or footage marks it stale. A fingerprint hashes
//   - the recipe (its shot-list entry, or the generated basic still, as JSON),
//   - the effect's own code: the file that defines it, every file in a folder of its own (a folder named after
//     the id, or the definition's folder when no other effect is defined there), files named after it in the
//     effects and the engine (faceCables.wgsl, PixelParticleDisintegrateRenderer.ts), the operator-graph files
//     that test an effect type against its id or export its graph creator (createDefaultKaleidoscopeGraph), the
//     creator a catalog hub calls for it (followed into the file that exports it, across line breaks and into a
//     dispatcher), and the files these import (shader, parameters, limits). Left out of the import walk: the
//     shared engine (files more than six files import), catalog hubs (files that name more than three effect
//     ids, such as the graph owner), registries (files that import more than eight), and another effect's code
//     (a file that names other effects but not this one). In a family file that defines several effects, only
//     the imports its own definition uses count. Where the rules are unsure they lean toward a file too many:
//     that costs one extra render, a file too few a stale picture that reads as current,
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
/** Where an effect's own runtime may also live, found by its file name only (never walked into). */
const NAME_SCOPES = ['src/engine'];
/**
 * Effects whose runtime lives in a service or engine folder of its own, which the effect definition does not
 * import (the engine dispatches to it by type): these folders count whole as the effect's own code.
 */
export const RUNTIME_FOLDERS = {
  flocking: ['src/services/flock', 'src/engine/flock'],
  'stick-figure': ['src/services/rig'],
  'pixel-particle-disintegrate': ['src/engine/particles'],
};
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
  const runtimeDirs = Object.values(RUNTIME_FOLDERS).flat();
  const walk = (dir, skip = []) => {
    if (!fs.existsSync(path.join(root, dir)) || skip.includes(dir)) return;
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(file, skip);
      else if (/\.(ts|tsx|wgsl|glsl|mjs|js)$/u.test(entry.name) && !/\.test\./u.test(entry.name)) files.push(file);
    }
  };
  [...CODE_SCOPES, ...runtimeDirs].forEach((dir) => walk(dir));
  const known = new Set(files);
  const engineStart = files.length;
  NAME_SCOPES.forEach((dir) => walk(dir, runtimeDirs));
  const engineFiles = files.splice(engineStart);
  const allKnown = new Set([...files, ...engineFiles]);
  const texts = new Map([...files, ...engineFiles].map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
  const resolveIn = (set) => (from, spec) => {
    const base = (spec.startsWith('.') ? path.posix.join(path.posix.dirname(from), spec) : spec.startsWith('@/') ? `src/${spec.slice(2)}` : '')
      .replace(/\?[a-z]+$/u, '');
    return base ? [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}.js`, `${base}.mjs`].find((file) => set.has(file)) : undefined;
  };
  const resolve = resolveIn(known);
  const resolveAll = resolveIn(allKnown);
  const specsOf = (text) => [...text.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/gu)]
    .map((match) => match[1] ?? match[2] ?? match[3]);
  const imports = new Map();
  const importers = new Map();
  for (const file of files) {
    const targets = [...new Set(specsOf(texts.get(file)).map((spec) => resolve(file, spec)).filter(Boolean))];
    imports.set(file, targets);
    for (const target of targets) importers.set(target, (importers.get(target) ?? 0) + 1);
  }
  // The in-scope imports of the engine files, followed from an engine file named after an effect.
  for (const file of engineFiles) imports.set(file, [...new Set(specsOf(texts.get(file)).map((spec) => resolve(file, spec)).filter(Boolean))]);
  // Importers of the engine files too, so an engine file many others use counts as shared engine.
  const allImporters = new Map();
  for (const file of [...files, ...engineFiles]) {
    for (const target of new Set(specsOf(texts.get(file)).map((spec) => resolveAll(file, spec)).filter(Boolean))) {
      allImporters.set(target, (allImporters.get(target) ?? 0) + 1);
    }
  }
  // Which effect ids each file names as an effect (defines, compares a type to, lists in a set or union),
  // to tell one effect's code from a hub or another effect's code. A plain value ('wave' as an option, a node
  // named 'threshold') does not count.
  const groupsText = texts.get(GROUPS_FILE) ?? '';
  const effectIds = new Set([...groupsText.matchAll(/effects:\s*\[([^\]]*)\]/gu)]
    .flatMap((match) => [...match[1].matchAll(/['"]([a-z0-9-]+)['"]/gu)].map((id) => id[1])));
  const asEffect = /(?:\bid:\s*|_ID\s*=\s*|[=!]==\s*|\bcase\s+|\|\s*|\[\s*|,\s*)['"]([a-z0-9][a-z0-9-]*)['"]|['"]([a-z0-9][a-z0-9-]*)['"]\s*(?:\||[=!]==)/gu;
  const named = new Map(files.map((file) => [file,
    new Set([...texts.get(file).matchAll(asEffect)].map((match) => match[1] ?? match[2]).filter((id) => effectIds.has(id)))]));
  // Which effect ids each file defines (`id: 'wave'`, `WAVE_ID = 'wave'`), to tell a folder of one effect from a family folder.
  const defined = new Map(files.map((file) => [file,
    new Set([...texts.get(file).matchAll(/(?:\bid:\s*|_ID\s*=\s*)['"]([a-z0-9][a-z0-9-]*)['"]/gu)].map((match) => match[1]).filter((id) => effectIds.has(id)))]));
  // Which effect ids a file claims as the effect it is code of: defines it, tests an effect type against it, or
  // declares it in an effect type union. A node id in an array or an argument ('contrast' as an operator) does not.
  const claimRule = /(?:[Tt]ype\s*[=!]==\s*|\btype:\s*)['"]([a-z0-9][a-z0-9-]*)['"]|['"]([a-z0-9][a-z0-9-]*)['"]\s*[=!]==\s*[\w.]*[Tt]ype\b/gu;
  const unionRule = /^(?:export\s+)?type\s+\w*(?:Effect|Type)\w*\s*=([^;]*)/gmu;
  const claimed = new Map(files.map((file) => {
    const text = texts.get(file);
    const ids = [...text.matchAll(claimRule)].map((match) => match[1] ?? match[2]);
    for (const union of text.matchAll(unionRule)) ids.push(...[...union[1].matchAll(/['"]([a-z0-9][a-z0-9-]*)['"]/gu)].map((match) => match[1]));
    return [file, new Set([...defined.get(file), ...ids.filter((id) => effectIds.has(id))])];
  }));
  // The constants that hold an effect id (`const PARTICLE_DISINTEGRATE = 'pixel-particle-disintegrate'`), so a hub
  // branch on such a constant leads to the effect's graph as a quoted id does.
  const idConstants = new Map();
  for (const file of files) {
    for (const match of texts.get(file).matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*(?::\s*[\w'"|\s]+)?=\s*['"]([a-z0-9][a-z0-9-]*)['"]/gu)) {
      if (effectIds.has(match[2])) idConstants.set(match[2], [...new Set([...idConstants.get(match[2]) ?? [], match[1]])]);
    }
  }
  /** The effect whose runtime folder (RUNTIME_FOLDERS) holds a file. */
  const runtimeOwner = (file) => Object.keys(RUNTIME_FOLDERS).find((effectId) => RUNTIME_FOLDERS[effectId].some((dir) => file.startsWith(`${dir}/`)));
  // The exported names of each code file, to follow a creator a hub calls into the file that exports it.
  const exported = new Map(files.map((file) => [file,
    new Set([...texts.get(file).matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gu)].map((match) => match[1]))]));
  const pascal = (id) => id.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('');
  // A file named after an effect: its basename starts with the id's words and the next character starts a new
  // word (faceCables.wgsl, SlitScanSurfacePass.ts), so 'wave' does not own WaveformRenderer.ts.
  const nameRule = (id) => new RegExp(`^${id.split('-').map((part) => `[${part[0].toLowerCase()}${part[0].toUpperCase()}]${part.slice(1)}`).join('[-_]?')}(?=[A-Z0-9._-]|$)`, 'u');
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
  /**
   * The code a hub runs for an id, from the text right after it: the `?` branch of a ternary up to its `:`
   * (`'id' ? createGraph : other`), else the statement up to its end (`if (type === 'id') return graph(params);`).
   */
  const branchText = (after) => {
    const statement = after.split(/;|\n\s*(?:if|const|let|return|export|function)\b/u)[0];
    const ask = statement.search(/\?(?![.?])/u);
    if (ask < 0) return statement;
    let depth = 0;
    for (let at = ask + 1; at < statement.length; at += 1) {
      const char = statement[at];
      if ('([{'.includes(char)) depth += 1;
      else if (')]}'.includes(char)) { if (depth === 0) return statement.slice(ask + 1, at); depth -= 1; }
      else if (char === ':' && depth === 0) return statement.slice(ask + 1, at);
    }
    return statement.slice(ask + 1);
  };
  const cache = new Map();
  /** The files of one effect's own code, sorted. */
  const codeFiles = (id) => {
    if (cache.has(id)) return cache.get(id);
    const literal = id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const defines = new RegExp(`(?:\\bid:\\s*|_ID\\s*=\\s*)['"]${literal}['"]`, 'u');
    // An operator file is the effect's when it tests an effect type against the id (`type === 'wave'`), declares
    // it in a type (`type X = 'wave' | ...`) or keys a graph by it; a bare `case 'wave'` of a curve shape is not.
    const typeRef = new RegExp(`(?:[Tt]ype\\s*[=!]==\\s*|\\btype:\\s*)['"]${literal}['"]|['"]${literal}['"]\\s*[=!]==\\s*[\\w.]*[Tt]ype\\b|^(?:export\\s+)?type\\s+\\w*(?:Effect|Type)\\w*\\s*=.*['"]${literal}['"]`, 'mu');
    // Roots: the definition (always, even in a family file that defines several effects), and the operator
    // files that name the effect, unless they are shared engine or a catalog hub.
    const definitions = files.filter((file) => file.startsWith('src/effects/') && !CODE_HUBS.has(file) && defines.test(texts.get(file)));
    const roots = [...definitions, ...files.filter((file) => !CODE_HUBS.has(file)
      && file.startsWith('src/services/operators/') && typeRef.test(texts.get(file)) && !shared(file))];
    // A folder of its own: a folder named after the id, or the definition's folder when nothing in it defines
    // another effect. All its code counts, however many files import it (an effect's parameters.ts).
    const family = (dir) => files.filter((file) => file.startsWith(`${dir}/`)).find((file) => [...defined.get(file)].some((other) => other !== id)
      || ![undefined, id].includes(nameOwner(file)));
    const ownFolders = new Set([
      ...files.filter((file) => file.startsWith('src/effects/') && file.split('/').slice(0, -1).includes(id)).map((file) => file.slice(0, file.lastIndexOf(`/${id}/`) + id.length + 1)),
      ...definitions.map((file) => path.posix.dirname(file)).filter((dir) => dir.split('/').length > 3),
    ].filter((dir) => !family(dir)));
    for (const dir of RUNTIME_FOLDERS[id] ?? []) ownFolders.add(dir);
    roots.push(...files.filter((file) => [...ownFolders].some((dir) => file.startsWith(`${dir}/`))));
    // In a family folder (several effects defined side by side, src/effects/tracking), the files beside the
    // definition that no single effect owns by name, definition or mention (DenseTerrainPipeline.ts) count for
    // every effect defined there.
    const familyDirs = new Set(definitions.map((file) => path.posix.dirname(file)).filter((dir) => dir.split('/').length > 2 && family(dir)));
    roots.push(...files.filter((file) => familyDirs.has(path.posix.dirname(file)) && !CODE_HUBS.has(file)
      && [undefined, id].includes(nameOwner(file)) && [...defined.get(file)].every((other) => other === id)
      && (named.get(file).size === 0 || named.get(file).has(id))));
    // The operator file that exports the effect's graph creator (createDefaultKaleidoscopeGraph), even in a
    // file of several graphs or one named after a sibling (mirrorRecipes.ts).
    const creator = new RegExp(`^create(?:Default)?${pascal(id)}(?:Effect|Image)?Graph$`, 'u');
    // Such a file of several effects' graphs, and a dispatcher a hub calls, count as they are; the walk enters
    // them only when they are not shared, so one effect does not collect the code of all its siblings.
    const graphFiles = files.filter((file) => !CODE_HUBS.has(file) && [...exported.get(file)].some((name) => creator.test(name)));
    // A catalog hub (the graph owner) registers the effect's graph next to its id, over line breaks and after
    // sibling ids of the same branch: `type === 'id' || type === 'other'\n  ? () => createGraph(type)`. The
    // imported names of that branch, up to the next quote or the next `:` branch, lead to the files that export
    // them, also when such a file is itself a dispatcher of several effects (uvDistortEffectGraphs.ts).
    const constants = idConstants.get(id) ?? [];
    const idRef = [`['"]${literal}['"]`, ...constants.map((name) => `\\b${name}\\b(?!\\s*=[^=])`)].join('|');
    const branch = new RegExp(`(?:${idRef})(?:\\s*\\|\\|\\s*[\\w.]+\\s*[=!]==\\s*['"][a-z0-9-]+['"])*([^'"]{0,240})`, 'gu');
    const mentions = (file) => named.get(file).has(id) || constants.some((name) => new RegExp(`[=!]==\\s*${name}\\b`, 'u').test(texts.get(file)));
    for (const file of files.filter((candidate) => candidate.startsWith('src/services/operators/') && shared(candidate) && !CODE_HUBS.has(candidate) && mentions(candidate))) {
      const names = importNames(file);
      const near = [...texts.get(file).matchAll(branch)].map((match) => branchText(match[1])).join(' ');
      const words = new Set(near.match(/[A-Za-z_$][\w$]*/gu) ?? []);
      for (const [target, locals] of names) if (locals.some((local) => words.has(local)) && !CODE_HUBS.has(target)) graphFiles.push(target);
    }
    // The walk does not enter another effect's code: a file that claims other effects (defines one, tests an
    // effect type against one, declares one in an effect type union) but does not name this one, a file named
    // after another effect (driftLines.ts, glowSampling.ts, by the longest effect id it starts with), or a file in
    // another effect's runtime folder. A node id an array or a call names ('contrast' as an operator) is no claim.
    const otherEffect = (file) => (claimed.get(file)?.size > 0 && !named.get(file)?.has(id) && !claimed.get(file).has(id))
      || ![undefined, id].includes(nameOwner(file)) || ![undefined, id].includes(runtimeOwner(file));
    roots.push(...graphFiles.filter((file) => !shared(file)));
    // Files named after the effect in the effects and the engine (SlitScanSurfacePass.ts, faceCables.wgsl),
    // unless the engine shares them; the walk follows their imports into the effect code.
    const own = nameRule(id);
    const namedFiles = [...files, ...engineFiles].filter((file) => own.test(path.posix.basename(file))
      && (file.startsWith('src/effects/') || NAME_SCOPES.some((scope) => file.startsWith(`${scope}/`)))
      && (allImporters.get(file) ?? 0) <= SHARED_IMPORTERS);
    const seen = new Set(graphFiles);
    const walked = new Set();
    const stack = [...roots, ...namedFiles];
    while (stack.length) {
      const file = stack.pop();
      if (walked.has(file)) continue;
      walked.add(file);
      seen.add(file);
      stack.push(...followed(file, id, defines).filter((target) => !shared(target) && !registry(target) && !otherEffect(target)));
    }
    const result = [...seen].toSorted();
    cache.set(id, result);
    return result;
  };
  // Line endings do not count: a Windows checkout (core.autocrlf) holds the same code with CRLF.
  const codeHash = (ids) => sha([...new Set(ids.flatMap(codeFiles))].toSorted().map((file) => `${file}\0${texts.get(file).replace(/\r\n?/gu, '\n')}`).join('\0'));
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
  const about = 'Written by the docs media tools (node scripts/docs-media.mjs and the shot scripts) after each render: the fingerprint of every docs picture and clip, so node scripts/docs-media.mjs --stale rebuilds what changed. On a merge conflict, take either side, then run node scripts/docs-media.mjs --adopt <effect ids the other side re-rendered> (plain --adopt records only assets without a fingerprint and leaves those stale).';
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
 * The recipes --adopt records as they are: with effect ids named, every one that exists (stale ones too); without,
 * only those that have no fingerprint yet. A stale recipe stays stale, so a plain --adopt never hides a change.
 */
export function adoptable(recipes, status, { named }) {
  return recipes.filter((recipe) => status.get(recipe) !== 'missing' && (named || status.get(recipe) === 'unknown'));
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
