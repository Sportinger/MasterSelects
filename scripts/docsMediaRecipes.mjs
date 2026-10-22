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
//   thumb        the gallery thumbnail cut from a still or poster  docShotThumb.mjs (effect-docs.mjs --thumbs);
//                (effectDocsCatalog.mjs thumbSource picks which)
//   screenshot   docs/Features/assets/docs-screenshot-manifest.json capture-feature-doc-screenshots.mjs --id=<id>
//
// The test tests/unit/docsMediaRecipes.test.ts fails when an asset has no recipe (unless HAND_MADE names
// it with a reason) or a recipe points to nothing: a missing file or an unknown effect id.
import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from '../docs-site/scripts/lib/media.mjs';
import { docLogicalPath, docShotSettings, findMedia, REPO_ROOT } from './docShotSettings.mjs';
import { effectAssets, isBasicPage, labPair, labShot, thumbSource } from './effectDocsCatalog.mjs';
import { EFFECT_DOC_EXTRAS } from './effectDocsExtras.mjs';
import { fingerprintParts, recordFingerprints, recordIndex } from './docsMediaFingerprint.mjs';

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
  { path: `${ASSET_DIR}/effects/graphs/flocking.webp`, reason: 'the Free Swarm\'s Flock group in the Nodes tab (a clip node graph, which effect-graph-shot cannot show), taken by hand with Expand all; its callouts are placed by hand' },
  { path: `${ASSET_DIR}/effects/graphs/stick-figure-walk.webp`, reason: 'the Rig nodes after Walk live in the clip\'s node graph, which effect-graph-shot cannot show: a review-folder script (review/GEN1/stick/r1/nodes.mjs: a black clip, Walk, Previews off, Avoid on, Source and Target dragged below, canvas cropped to Gait Cycle and Stick Figure) made it' },
  { path: `${ASSET_DIR}/effects/stick-figure.webp`, reason: 'the default figure alone on black, crop [504, 252, 960, 540] of the Effect Lab --variants-file render with --inset 0.001 that also made the preset strip (scripts/effect-lab-shots/presets.json: --pairs and --presets do not read inset yet)' },
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
};

const posix = (file) => file.split(path.sep).join('/');
const repoPath = (file, root) => posix(path.relative(root, path.resolve(root, file)));
const readJson = (root, file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const listJson = (root, dir) => (fs.existsSync(path.join(root, dir))
  ? fs.readdirSync(path.join(root, dir)).filter((name) => name.endsWith('.json')).toSorted().map((name) => `${dir}/${name}`) : []);
const groupOf = (file) => path.basename(file, '.json');
const image = (name, settings) => path.resolve(REPO_ROOT, settings.imageDir, name.endsWith('.jpg') ? name : `${name}.jpg`);

/** Effect ids of the picker groups (src/effects/effectCatalogGroups.ts), read once per root. */
const groupIds = new Map();
function knownEffectIds(root) {
  if (!groupIds.has(root)) {
    const file = path.join(root, 'src/effects/effectCatalogGroups.ts');
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    groupIds.set(root, new Set([...text.matchAll(/effects:\s*\[([^\]]*)\]/gu)].flatMap((match) => [...match[1].matchAll(/'([a-z0-9-]+)'/gu)].map((id) => id[1]))));
  }
  return groupIds.get(root);
}

/** Effects an operation clip adds through the picker (a typed effect id, "type": "glitch"): its pictures depend on their code too. */
const addedEffects = (clip, root) => (clip.kind === 'operation'
  ? (clip.steps ?? []).map((step) => step.type).filter((typed) => typeof typed === 'string' && knownEffectIds(root).has(typed.trim().toLowerCase()))
    .map((typed) => typed.trim().toLowerCase())
  : []);

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
        effects: [...new Set([clip.effect, ...(clip.effects ?? []).map((extra) => extra.effect), ...addedEffects(clip, root)].filter(Boolean))],
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

/** Clip layouts that show the effect in their right half (original | effect). */
const HALF_LAYOUTS = new Set(['pair', 'compare', 'split']);

/**
 * A gallery thumbnail cut from `source` (asset path relative to docs/Features). The region is thumb.region of
 * effectDocsExtras.mjs, else the effect half of a still or of a two-part clip poster; a single picture (layout
 * "single": a generator's still, or a single-picture clip poster) is taken whole. A "detail" poster (whole frame
 * | enlargement) gives its left half: the whole frame reads as the effect, the enlargement as a blurred fragment.
 * `layout`: the layout of the clip whose poster is the source, or "single" / "still" for a still.
 */
export function thumbRecipe(id, { source, root = REPO_ROOT, layout }) {
  const extra = EFFECT_DOC_EXTRAS[id]?.thumb;
  const poster = source === effectAssets(id).poster;
  const whole = layout === 'single' || (poster && layout !== 'detail' && !HALF_LAYOUTS.has(layout));
  const region = extra?.region ?? (poster && layout === 'detail' ? [0, 0, 0.5, 1] : whole ? [0, 0, 1, 1] : undefined);
  // The effect half of a loop's poster (the dancer, head to feet) is fitted whole when it is narrow; a still is cropped.
  const fit = poster && !extra?.region && HALF_LAYOUTS.has(layout) ? 'whole' : undefined;
  return { id: `thumb scripts/effect-docs.mjs#${id}`, kind: 'thumb', file: 'scripts/effect-docs.mjs', group: 'thumbs', name: id,
    spec: { source, ...(region ? { region } : {}), ...(fit ? { fit } : {}) }, effects: [], outputs: [`${FEATURES}/${effectAssets(id).thumb}`],
    inputs: [path.join(root, FEATURES, source)] };
}

/** The layout of the clip that makes an effect's poster (assets/effects/clips/<id>.webp), from the shot lists. */
export function posterLayout(id, root = REPO_ROOT) {
  const poster = `${ASSET_DIR}/effects/clips/${id}.webp`;
  for (const file of listJson(root, SHOT_LISTS.clip)) {
    const data = readJson(root, file);
    const clip = (data.clips ?? []).find((entry) => `${data.out ?? DEFAULT_OUT.clip}/${entry.name}.webp` === poster);
    if (clip) return clip.layout ?? 'single';
  }
  return undefined;
}

/**
 * The thumbnail recipe of an effect, or undefined when it has nothing to cut from. `wholeStill`: the still is
 * one picture (a generator's basic still, labShot layout "single"), not original | effect.
 */
export function effectThumbRecipe(id, root = REPO_ROOT, { wholeStill = false } = {}) {
  const exists = (asset) => fs.existsSync(path.join(root, FEATURES, asset));
  const pageFile = path.join(root, FEATURES, 'effects', `${id}.md`);
  const page = fs.existsSync(pageFile) ? fs.readFileSync(pageFile, 'utf8') : undefined;
  const source = thumbSource(id, { exists, page, override: EFFECT_DOC_EXTRAS[id]?.thumb?.source });
  const layout = source === effectAssets(id).poster ? posterLayout(id, root) : wholeStill ? 'single' : 'still';
  return source ? thumbRecipe(id, { source, root, layout }) : undefined;
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
    const recipe = exists(thumb) && !claimed.has(thumb) ? effectThumbRecipe(effect.id, root, { wholeStill: labShot(effect).layout === 'single' }) : undefined;
    if (recipe) recipes.push(recipe);
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
 * `written`: the file the script wrote for the entry; a recipe whose output it is not (an explicit --out to
 * another folder) is left alone, so the untouched asset in the repository keeps its fingerprint. `parts`:
 * the code and media the render was made from (fingerprintParts), when they are not today's.
 */
export function recordShotList(kind, shotFile, names, { root = REPO_ROOT, media, recipeKind, written, parts } = {}) {
  const file = repoPath(shotFile, root);
  if (!file.startsWith(`${SHOT_LISTS[kind]}/`)) return;
  const wanted = new Set(names);
  const writes = written === undefined ? undefined : posix(path.relative(root, docLogicalPath(path.resolve(written))));
  recordFingerprints(shotListRecipes(kind, file, { root, media })
    .filter((recipe) => wanted.has(recipe.name) && (!recipeKind || recipe.kind === recipeKind) && (writes === undefined || recipe.outputs.includes(writes))),
  { root, parts });
}

/** The code and media one shot-list entry is rendered from today (saved with kept exports for --reencode). */
export function shotListParts(kind, shotFile, name, { root = REPO_ROOT, media } = {}) {
  const file = repoPath(shotFile, root);
  const recipe = file.startsWith(`${SHOT_LISTS[kind]}/`) ? shotListRecipes(kind, file, { root, media }).find((entry) => entry.name === name) : undefined;
  return recipe ? fingerprintParts(recipe, { code: recordIndex(root) }) : undefined;
}
