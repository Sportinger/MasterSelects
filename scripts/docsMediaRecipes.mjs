// Docs media recipes: every picture and clip under docs/Features/assets and the recipe that makes it.
// The recipes are the shot lists the docs tools already read, plus what scripts/effect-docs.mjs makes:
//
//   kind         recipe                                            made by
//   still        scripts/effect-lab-shots/<group>.json "pairs"     effect-lab.mjs --pairs <file> --only <names>
//   strip        scripts/effect-lab-shots/<group>.json "strips"    effect-lab.mjs --presets <file> --only <effect ids>
//   basic-still  the default still of an effect page (labPair)     effect-lab.mjs --pairs on a generated manifest
//   graph        scripts/effect-graph-shots/<group>.json "shots"   effect-graph-shot.mjs <shots>
//   editor       scripts/effect-editor-shots/<group>.json "shots"  effect-editor-shot.mjs <file> --only <names>
//   clip         scripts/doc-clips/<group>.json "clips"            doc-clip.mjs <file> --only <names> (mp4 + poster)
//   thumb        the gallery thumbnail cut from a still or poster  docShotThumb.mjs (effect-docs.mjs --thumbs)
//   screenshot   docs/Features/assets/docs-screenshot-manifest.json capture-feature-doc-screenshots.mjs --id=<id>
//
// The test tests/unit/docsMediaRecipes.test.ts fails when an asset has no recipe (unless HAND_MADE names
// it with a reason) or a recipe points to nothing: a missing file or an unknown effect id.
import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from '../docs-site/scripts/lib/media.mjs';
import { docShotSettings, findMedia, REPO_ROOT } from './docShotSettings.mjs';
import { effectAssets, isBasicPage, labPair } from './effectDocsCatalog.mjs';
import { EFFECT_DOC_EXTRAS } from './effectDocsExtras.mjs';
import { recordFingerprints } from './docsMediaFingerprint.mjs';

export const ASSET_DIR = 'docs/Features/assets';
const FEATURES = 'docs/Features';
export const SHOT_LISTS = {
  lab: 'scripts/effect-lab-shots',
  graph: 'scripts/effect-graph-shots',
  editor: 'scripts/effect-editor-shots',
  clip: 'scripts/doc-clips',
};
export const SCREENSHOT_MANIFEST = 'docs/Features/assets/docs-screenshot-manifest.json';
/** Order of a run: thumbnails are cut from the stills and posters made before them. */
export const KINDS = ['still', 'basic-still', 'strip', 'graph', 'editor', 'clip', 'screenshot', 'thumb'];
const DEFAULT_OUT = {
  graph: `${ASSET_DIR}/effects/graphs`,
  editor: `${ASSET_DIR}/effects/editor`,
  clip: `${ASSET_DIR}/clips`,
};

/** Assets made by hand (a path or a folder ending in /) and why; every other asset needs a recipe. */
export const HAND_MADE = [
  { path: `${ASSET_DIR}/workflows/`, reason: 'editor walkthrough screenshots of the guides, taken by hand; the ui-shot tooling will give them recipes' },
  { path: `${ASSET_DIR}/transitions/`, reason: 'Crossfade filmstrips composed by hand from editor frames' },
  { path: `${ASSET_DIR}/keyframes/real-editor-current.png`, reason: 'a screenshot of the editor with a real project, taken by hand' },
  { path: `${ASSET_DIR}/effects/graphs/glitch-stages.svg`, reason: 'a stage diagram of Glitch drawn by hand as SVG' },
];
export const handMadeReason = (asset) => HAND_MADE.find((entry) => (entry.path.endsWith('/') ? asset.startsWith(entry.path) : asset === entry.path))?.reason;

/**
 * Pictures made before recipes were kept: custom pairs of hand-written effect pages, rendered from manifests
 * nobody committed. The lane that rewrites such a page shoots it again from a recipe in its shot list; the test
 * then only notes that the line here can go (no lane has to edit this list).
 */
const BEFORE_RECIPES = 'a custom pair from before recipes were kept: the page rewrite shoots it again from a shot list';
export const RECIPE_PENDING = {
  ...Object.fromEntries([
    'box-blur.webp',
    'bulge.webp',
    'chroma-key-matte.webp',
    'chroma-key.webp',
    'contrast.webp',
    'edge-detect.webp',
    'exposure.webp',
    'fisheye.webp',
    'grain.webp',
    'guided-perspective.webp',
    'hue-shift.webp',
    'invert.webp',
    'lens-correction.webp',
    'levels.webp',
    'motion-blur.webp',
    'posterize.webp',
    'radial-blur.webp',
    'saturation.webp',
    'scanlines.webp',
    'slit-scan.webp',
    'temperature.webp',
    'threshold.webp',
    'time-stack.webp',
    'twirl.webp',
    'vibrance.webp',
    'vignette.webp',
    'wave.webp',
    'zoom-blur.webp',
  ].map((asset) => [`${ASSET_DIR}/effects/${asset}`, BEFORE_RECIPES])),
  [`${ASSET_DIR}/effects/drift-lines.webp`]: 'the default still of the basic page Drift Lines started from (the page shows its loop; the catalog cuts the thumbnail from it)',
};

const posix = (file) => file.split(path.sep).join('/');
const repoPath = (file, root) => posix(path.relative(root, path.resolve(root, file)));
const readJson = (root, file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const listJson = (root, dir) => (fs.existsSync(path.join(root, dir))
  ? fs.readdirSync(path.join(root, dir)).filter((name) => name.endsWith('.json')).toSorted().map((name) => `${dir}/${name}`) : []);
const groupOf = (file) => path.basename(file, '.json');
const image = (name, settings) => path.resolve(REPO_ROOT, settings.imageDir, name.endsWith('.jpg') ? name : `${name}.jpg`);

/** `<effect>[?query][@name]` of a graph shot. */
export function parseGraphShot(spec) {
  const [target, name] = spec.split('@');
  const [effect] = target.split('?');
  return { effect, name: name || effect };
}

/** The recipes of one shot list (`kind`: lab, graph, editor or clip). */
export function shotListRecipes(kind, file, { root = REPO_ROOT, settings = docShotSettings(), media } = {}) {
  const data = readJson(root, file);
  const group = groupOf(file);
  const recipe = (fields) => ({ group, file, inputs: [], ...fields, id: `${fields.kind} ${file}#${fields.name}` });
  if (kind === 'lab') {
    return [
      ...(data.pairs ?? []).map((entry) => recipe({ kind: 'still', name: entry.name, spec: entry,
        effects: [entry.left?.effect, entry.right?.effect].filter((effect) => effect && effect !== 'original'),
        outputs: [repoPath(entry.out, root)], inputs: [image(entry.image, settings)] })),
      ...(data.strips ?? []).map((entry) => recipe({ kind: 'strip', name: entry.effect, spec: entry, effects: [entry.effect],
        outputs: [repoPath(entry.out ?? `${FEATURES}/${effectAssets(entry.effect).presets}`, root)], inputs: [image(entry.image, settings)] })),
    ];
  }
  if (kind === 'graph') {
    return (data.shots ?? []).map((spec) => {
      const { effect, name } = parseGraphShot(spec);
      return recipe({ kind: 'graph', name, spec, effects: [effect], outputs: [`${data.out ?? DEFAULT_OUT.graph}/${name}.webp`] });
    });
  }
  if (kind === 'editor') {
    return (data.shots ?? []).map((shot) => recipe({ kind: 'editor', name: shot.name, spec: shot, theme: shot.view === 'preview' ? undefined : settings.theme,
      effects: [shot.effect].filter(Boolean), outputs: [repoPath(shot.file ?? `${data.out ?? DEFAULT_OUT.editor}/${shot.name}.webp`, root)],
      inputs: [image(shot.image ?? 'harbor_town.jpg', settings)] }));
  }
  if (kind === 'clip') {
    const out = data.out ?? DEFAULT_OUT.clip;
    return (data.clips ?? []).map((clip) => {
      const source = clip.source ?? data.source;
      return recipe({ kind: 'clip', name: clip.name, spec: { ...clip, source, out },
        theme: clip.kind === 'operation' ? settings.theme : undefined,
        effects: [clip.effect, ...(clip.effects ?? []).map((extra) => extra.effect)].filter(Boolean),
        outputs: [`${out}/${clip.name}.mp4`, `${out}/${clip.name}.webp`], inputs: [findMedia(source, { media }) ?? `missing:${source}`] });
    });
  }
  throw new Error(`Unknown shot list kind ${kind}`);
}

/** The default still of an effect page (effect-docs.mjs labPair), keeping the layout of an existing still. */
export function basicStillRecipe(effect, { size, settings = docShotSettings() } = {}) {
  const spec = labPair(effect, size);
  return { id: `basic-still scripts/effect-docs.mjs#${effect.id}`, kind: 'basic-still', file: 'scripts/effect-docs.mjs', group: effect.group,
    name: effect.id, spec, effects: [effect.id], outputs: [spec.out], inputs: [image(spec.image, settings)] };
}

/** A gallery thumbnail cut from `source` (asset path relative to docs/Features). */
export function thumbRecipe(id, { source, root = REPO_ROOT }) {
  const region = EFFECT_DOC_EXTRAS[id]?.thumb?.region;
  return { id: `thumb scripts/effect-docs.mjs#${id}`, kind: 'thumb', file: 'scripts/effect-docs.mjs', group: 'thumbs', name: id,
    spec: { source, ...(region ? { region } : {}) }, effects: [], outputs: [`${FEATURES}/${effectAssets(id).thumb}`],
    inputs: [path.join(root, FEATURES, source)] };
}

/** Pictures and clips under docs/Features/assets (manifests and notes left out), repository paths. */
export function assetFiles(root = REPO_ROOT) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (!/\.(json|md|txt)$/u.test(entry.name)) files.push(file);
    }
  };
  if (fs.existsSync(path.join(root, ASSET_DIR))) walk(ASSET_DIR);
  return files.toSorted();
}

/**
 * Every recipe. `snapshot` (snapshotRegistry of effectDocsCatalog.mjs) adds the basic stills and thumbnails
 * effect-docs.mjs makes; without it only the shot lists count.
 */
export function collectRecipes({ root = REPO_ROOT, snapshot, settings = docShotSettings(), media } = {}) {
  const recipes = [];
  for (const kind of Object.keys(SHOT_LISTS)) {
    for (const file of listJson(root, SHOT_LISTS[kind])) recipes.push(...shotListRecipes(kind, file, { root, settings, media }));
  }
  if (fs.existsSync(path.join(root, SCREENSHOT_MANIFEST))) {
    for (const shot of readJson(root, SCREENSHOT_MANIFEST).shots ?? []) {
      recipes.push({ id: `screenshot ${SCREENSHOT_MANIFEST}#${shot.id}`, kind: 'screenshot', file: SCREENSHOT_MANIFEST, group: 'screenshots',
        name: shot.id, spec: shot, effects: [], outputs: [shot.output], inputs: [] });
    }
  }
  if (!snapshot) return recipes;
  const claimed = new Set(recipes.flatMap((recipe) => recipe.outputs));
  const exists = (file) => fs.existsSync(path.join(root, file));
  for (const effect of snapshot.effects) {
    const assets = effectAssets(effect.id);
    const still = `${FEATURES}/${assets.still}`;
    // The still of a basic page is the default still effect-docs.mjs writes for it.
    if (exists(still) && !claimed.has(still) && hasBasicPage(root, effect.id)) {
      recipes.push(basicStillRecipe(effect, { size: imageSize(fs.readFileSync(path.join(root, still))), settings }));
      claimed.add(still);
    }
    const thumb = `${FEATURES}/${assets.thumb}`;
    const source = [assets.still, assets.poster].find((file) => exists(`${FEATURES}/${file}`));
    if (exists(thumb) && !claimed.has(thumb) && source) recipes.push(thumbRecipe(effect.id, { source, root }));
  }
  return recipes;
}

/** Whether an effect page is still the basic page effect-docs.mjs writes. */
export const hasBasicPage = (root, id) => {
  const file = path.join(root, FEATURES, 'effects', `${id}.md`);
  return fs.existsSync(file) && isBasicPage(fs.readFileSync(file, 'utf8'));
};

/**
 * What is wrong between the assets and the recipes: assets without a recipe (and not HAND_MADE), recipes whose
 * output is missing or whose effect is not in the registry, and assets two recipes write.
 */
export function recipeProblems({ recipes, assets, effectIds, exists }) {
  const problems = [];
  const writers = new Map();
  for (const recipe of recipes) for (const output of recipe.outputs) writers.set(output, [...writers.get(output) ?? [], recipe.id]);
  for (const asset of assets) {
    if (!writers.has(asset) && !handMadeReason(asset) && !RECIPE_PENDING[asset]) problems.push(`${asset} has no recipe: add it to a shot list (scripts/effect-lab-shots, effect-graph-shots, effect-editor-shots or doc-clips) or to HAND_MADE in scripts/docsMediaRecipes.mjs with a reason`);
  }
  for (const [output, ids] of writers) if (ids.length > 1) problems.push(`${output} is written by ${ids.length} recipes: ${ids.join(', ')}`);
  for (const recipe of recipes) {
    for (const output of recipe.outputs) if (!exists(output)) problems.push(`${recipe.id} points to ${output}, which does not exist: render it (node scripts/docs-media.mjs ${recipe.effects[0] ?? recipe.group}) or remove the recipe`);
    for (const id of recipe.effects) if (!effectIds.has(id)) problems.push(`${recipe.id} names effect "${id}", which the registry does not have`);
    for (const input of recipe.inputs) if (String(input).startsWith('missing:')) problems.push(`${recipe.id} reads ${input.slice(8)}, which no media folder has`);
  }
  return problems;
}

/**
 * The recipes for these effect ids, picker group ids or shot-list names (all when none) and kinds (all when none).
 * Returns { recipes, unknown: the ids that matched nothing }.
 */
export function selectRecipes(recipes, { ids = [], kinds = [], snapshot } = {}) {
  const pickerGroup = new Map((snapshot?.effects ?? []).map((effect) => [effect.id, effect.group]));
  const matches = (recipe, id) => recipe.effects.includes(id) || recipe.group === id || recipe.name === id
    || recipe.effects.some((effect) => pickerGroup.get(effect) === id)
    || (recipe.kind === 'thumb' && (recipe.name === id || pickerGroup.get(recipe.name) === id));
  const selected = recipes.filter((recipe) => (!kinds.length || kinds.includes(recipe.kind)) && (!ids.length || ids.some((id) => matches(recipe, id))));
  return { recipes: selected, unknown: ids.filter((id) => !recipes.some((recipe) => matches(recipe, id))) };
}

/**
 * Records the fingerprints of entries a shot script just rendered from a shot list (kind: lab, graph, editor
 * or clip). Shot files outside the recipe folders (a generated manifest) and scratch runs record nothing.
 */
export function recordShotList(kind, shotFile, names, { root = REPO_ROOT, media, recipeKind } = {}) {
  const file = repoPath(shotFile, root);
  if (!file.startsWith(`${SHOT_LISTS[kind]}/`)) return;
  const wanted = new Set(names);
  recordFingerprints(shotListRecipes(kind, file, { root, media })
    .filter((recipe) => wanted.has(recipe.name) && (!recipeKind || recipe.kind === recipeKind)), { root });
}
