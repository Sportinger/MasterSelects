// Docs media recipes: every picture and clip under docs/Features/assets has a recipe that makes it again
// (node scripts/docs-media.mjs), and every recipe points to a file and an effect that exist. Stale assets
// (recipe, effect code or footage changed since the render) are reported as a warning, not a failure.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  EFFECTS_HIDDEN_FROM_CATALOG, EFFECT_GROUPS, effectEngine, effectEngineMembers, effectExperimentalNote, getAllEffects,
} from '../../src/effects';
import { effectParamDisplay } from '../../src/effects/paramDisplay';
import { catalogText } from '../../src/services/nodeGraph/catalogText';
import { snapshotRegistry } from '../../scripts/effectDocsCatalog.mjs';
import { docLogicalPath, docOutput, findMedia } from '../../scripts/docShotSettings.mjs';
import {
  HAND_MADE, RECIPE_PENDING, assetFiles, collectRecipes, handMadeReason, parseGraphShot, recipeProblems, recordShotList, selectRecipes, shotListRecipes, thumbRecipe,
} from '../../scripts/docsMediaRecipes.mjs';
import { RUNTIME_FOLDERS, adoptable, effectCodeIndex, fingerprintParts, manifestText, readManifest, recipeFingerprint, recipeStatus } from '../../scripts/docsMediaFingerprint.mjs';
import { oldModules } from '../../scripts/docsMediaVite.mjs';
import { thumbRegion, trimDividers } from '../../scripts/docShotThumb.mjs';
import { effectAssets, labPair, labShot, thumbSource } from '../../scripts/effectDocsCatalog.mjs';
import { sheetPages } from '../../scripts/docsMediaSheet.mjs';

const root = path.resolve(__dirname, '../..');
const exists = (file: string) => fs.existsSync(path.join(root, file));
const snapshot = snapshotRegistry({
  effects: getAllEffects(), groups: EFFECT_GROUPS, hidden: EFFECTS_HIDDEN_FROM_CATALOG, engineOf: effectEngine,
  engineMembers: effectEngineMembers, text: catalogText, display: effectParamDisplay, experimental: effectExperimentalNote,
});
const recipes = collectRecipes({ root, snapshot });
const assets = assetFiles(root);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-media-test-'));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

describe('every docs asset has a recipe', () => {
  it('finds the recipe of every picture and clip, and every recipe points to a file and an effect that exist', () => {
    const problems = recipeProblems({ recipes, assets, effectIds: new Set(snapshot.effects.map((effect: { id: string }) => effect.id)), exists });
    expect(problems, 'node scripts/docs-media.mjs --list shows the recipes; Documentation-Site.md, "Shot and clip tooling"').toEqual([]);
  });

  it('names only existing files as hand-made or pending', () => {
    const dead = [...HAND_MADE.map((entry) => entry.path), ...Object.keys(RECIPE_PENDING)]
      .filter((entry) => (entry.endsWith('/') ? !assets.some((asset) => asset.startsWith(entry)) : !assets.includes(entry)));
    expect(dead, 'remove these entries from scripts/docsMediaRecipes.mjs').toEqual([]);
    const outputs = new Set(recipes.flatMap((recipe) => recipe.outputs));
    const done = Object.keys(RECIPE_PENDING).filter((asset) => outputs.has(asset));
    // A rewritten page shot its still again from a recipe: the pending line can go (not a failure, so no lane has to edit the list).
    if (done.length) console.warn(`docs media: these assets have recipes now; drop them from RECIPE_PENDING: ${done.join(', ')}`);
    expect(Object.values(RECIPE_PENDING).every((reason) => reason.length > 20) && HAND_MADE.every((entry) => entry.reason.length > 20)).toBe(true);
  });

  it('reports stale assets as a warning', () => {
    const manifest = readManifest(root);
    const status = recipeStatus(recipes, { code: effectCodeIndex(root), manifest, exists });
    const stale = recipes.filter((recipe) => status.get(recipe) === 'stale').map((recipe) => recipe.id);
    if (stale.length) console.warn(`docs media: ${stale.length} stale (node scripts/docs-media.mjs --stale rebuilds them): ${stale.join(', ')}`);
    const unknown = recipes.filter((recipe) => status.get(recipe) === 'unknown').length;
    if (unknown) console.warn(`docs media: ${unknown} recipes have no fingerprint yet (node scripts/docs-media.mjs --adopt records them as they are).`);
    const orphans = Object.keys(manifest).filter((asset) => !exists(asset));
    if (orphans.length) console.warn(`docs media: the manifest names assets that are gone: ${orphans.join(', ')}`);
    expect(status.size).toBe(recipes.length);
  });
});

describe('the fingerprint covers one effect\'s own code', () => {
  const code = effectCodeIndex(root);
  const ids: string[] = snapshot.effects.map((effect: { id: string }) => effect.id);
  /** The effects an edit of this file marks stale. */
  const touched = (file: string) => ids.filter((id) => code.codeFiles(id).includes(file));

  it('takes the definition, shader and graph of Drift Lines and nothing of other effects or the catalog hubs', () => {
    const files = code.codeFiles('drift-lines');
    expect(files).toEqual(expect.arrayContaining(['src/effects/halftone/driftLines.ts', 'src/effects/halftone/index.ts',
      'src/effects/halftone/shader.wgsl', 'src/services/operators/motionHalftoneEffectGraphs.ts']));
    expect(files.filter((file) => /acuarela|chroma-key|keyer|glitch|signal-lab|fisheye|effectGraphOwner|effectPresentationPlans/iu.test(file))).toEqual([]);
    expect(files.length).toBeLessThan(12);
  });

  it('marks only the edited effect stale (its family for a shared family shader)', () => {
    expect(touched('src/effects/halftone/driftLines.ts')).toEqual(['drift-lines']);
    expect(touched('src/services/operators/acuarelaEffectGraph.ts')).toEqual(['acuarela']);
    expect(touched('src/effects/stylize/vignette/vignetteModel.ts')).toEqual(['vignette']);
    expect(touched('src/effects/blur/separableBlur.wgsl').toSorted()).toEqual(['box-blur', 'gaussian-blur']);
    expect(touched('src/services/operators/effectGraphOwner.ts')).toEqual([]);
    expect(touched('src/services/operators/effectPresentationPlans.ts')).toEqual([]);
    // A graph registered only in the graph owner (`type === 'slit-scan' ? createDefaultSlitScanGraph`) still counts.
    expect(code.codeFiles('slit-scan')).toContain('src/services/operators/slitScanEffectGraph.ts');
    const driftRecipes = recipes.filter((recipe) => recipe.effects.some((id) => code.codeFiles(id).includes('src/effects/halftone/driftLines.ts')));
    expect(driftRecipes.length).toBeGreaterThan(0);
    expect(driftRecipes.every((recipe) => recipe.effects.includes('drift-lines'))).toBe(true);
  });

  it('counts the effect an operation clip adds through the picker, and the services of an effect family', () => {
    const addGlitch = shotListRecipes('clip', 'scripts/doc-clips/analog.json', { root }).find((recipe) => recipe.name === 'add-glitch');
    expect(addGlitch?.effects).toEqual(['glitch']);
    expect(code.codeFiles('face-cables')).toContain('src/services/faceCables/cableOperatorGraph.ts');
    // A sibling compared in the same chain through a constant (`|| type === WEAVE_EFFECT_TYPE`) is not the branch's graph.
    for (const id of ['face-cables', 'voxel-relief', 'analog-signal-lab']) {
      expect(code.codeFiles(id), id).not.toContain('src/services/operators/geometry/weaveGraph.ts');
    }
    expect(code.codeFiles('weave')).toContain('src/services/operators/geometry/weaveGraph.ts');
  });

  it('keeps every effect\'s code small: no effect reaches the operator library', () => {
    // Outside a folder of its own (slit-scan/ holds 30 files of its runtime, src/engine/flock 62 of Flocking's), no effect collects more than 40 files.
    const runtime = RUNTIME_FOLDERS as Record<string, string[]>;
    const outside = (id: string) => code.codeFiles(id).filter((file) => !file.split('/').slice(0, -1).includes(id)
      && !(runtime[id] ?? []).some((dir) => file.startsWith(`${dir}/`)));
    const largest = ids.map((id) => [id, outside(id).length] as const).toSorted((a, b) => b[1] - a[1])[0];
    expect(largest[1], `${largest[0]} fingerprints ${largest[1]} files`).toBeLessThanOrEqual(40);
  });

  it('misses no code an effect renders with (a file too many costs a render, a file too few a stale picture)', () => {
    // The graph a dispatcher or a sibling's recipe file creates (createDefaultKaleidoscopeGraph in mirrorRecipes.ts).
    expect(touched('src/services/operators/mirrorRecipes.ts')).toContain('kaleidoscope');
    expect(touched('src/services/operators/colorEffectGraphs.ts')).toEqual(expect.arrayContaining(['brightness', 'contrast']));
    // Mirror counts too: its Edges choice reads DISTORT_EDGE_OPTIONS from there (through uvDistortParams.ts).
    expect(touched('src/services/operators/uvDistortRecipes.ts')).toEqual(expect.arrayContaining(['bulge', 'twirl', 'wave', 'mirror']));
    // A folder of its own counts whole, however many files import a file in it.
    expect(touched('src/effects/time/slit-scan/parameters.ts')).toEqual(['slit-scan']);
    expect(code.codeFiles('slit-scan')).toContain('src/effects/time/slit-scan/ShapeTimeRuntime.ts');
    expect(code.codeFiles('analog-signal-lab')).toContain('src/effects/analog/signal-lab/analogImageResolveShader.ts');
    expect(code.codeFiles('pixel-particle-disintegrate')).toContain('src/effects/stylize/pixel-particle-disintegrate/releaseTiming.ts');
    expect(code.codeFiles('time-stack')).toContain('src/effects/time/time-stack/TimeStackResources.ts');
    // Files named after the effect in the engine and in a family folder; files a family folder shares with no owner.
    expect(code.codeFiles('pixel-particle-disintegrate')).toContain('src/engine/particles/PixelParticleDisintegrateRenderer.ts');
    expect(code.codeFiles('slit-scan')).toContain('src/engine/native3d/sceneRenderer/SlitScanSceneSurfaces.ts');
    expect(code.codeFiles('face-cables')).toContain('src/effects/tracking/faceCables.wgsl');
    expect(code.codeFiles('cctv')).toContain('src/effects/tracking/DenseTerrainPipeline.ts');
    expect(code.codeFiles('wave').some((file) => /Waveform/u.test(file)), 'wave does not own WaveformRenderer').toBe(false);
    // A runtime of its own in a service or engine folder the engine dispatches to (RUNTIME_FOLDERS).
    expect(touched('src/services/flock/flockEffect.ts')).toEqual(['flocking']);
    expect(touched('src/services/flock/compiler/flockCompiler.ts')).toEqual(['flocking']);
    expect(code.codeFiles('flocking')).toContain('src/engine/flock/runtime/FlockSimulationRuntime.ts');
    expect(touched('src/services/rig/skeletonPoseLibrary.ts')).toEqual(['stick-figure']);
    expect(code.codeFiles('stick-figure')).toContain('src/services/rig/stickFigureJointRuntime.ts');
    for (const [id, dirs] of Object.entries(RUNTIME_FOLDERS as Record<string, string[]>)) {
      expect(ids, `RUNTIME_FOLDERS names ${id}`).toContain(id);
      for (const dir of dirs) expect(exists(dir), `RUNTIME_FOLDERS: ${dir}`).toBe(true);
    }
    // The graph a hub registers through a constant (PARTICLE_DISINTEGRATE) and the imports of an engine file named after the effect.
    expect(code.codeFiles('pixel-particle-disintegrate')).toEqual(expect.arrayContaining([
      'src/services/operators/particleDisintegrateGraph.ts', 'src/services/operators/particleDisintegrateOperators.ts']));
    // A node id in an array or an argument ('contrast' as an operator, 'scanlines' as a stage) does not make a file another effect's.
    expect(code.codeFiles('voxel-relief')).toEqual(expect.arrayContaining([
      'src/services/operators/voxelGraphDefaults.ts', 'src/services/operators/expandVoxelGeometry.ts']));
    expect(code.codeFiles('analog-signal-lab')).toContain('src/services/operators/analogDisplayResolveGraph.ts');
    expect(code.codeFiles('splat-exploration')).toContain('src/services/operators/splatOperators.ts');
    // The pattern looks' shader twin also carries the graph's own Rotate UV, Fractal Noise and round-half-even code (halftone/index.ts).
    expect(code.codeFiles('drift-lines')).toEqual(['src/effects/_shared/catalogEffect.ts', 'src/effects/_shared/coordinateRotation.wgsl',
      'src/effects/halftone/driftLines.ts', 'src/effects/halftone/index.ts', 'src/effects/halftone/shader.wgsl',
      'src/services/operators/imageNoiseSemantics.ts', 'src/services/operators/imageRoundingSemantics.ts', 'src/services/operators/motionHalftoneEffectGraphs.ts']);
  });

  it('follows the graph owner to the creator of every effect with a graph picture', () => {
    const operators = path.join(root, 'src/services/operators');
    const exporter = new Map<string, string>();
    for (const dir of ['src/services/operators', 'src/services/faceCables']) {
      for (const name of fs.readdirSync(path.join(root, dir), { recursive: true }).map(String).filter((entry) => entry.endsWith('.ts') && !entry.includes('.test.'))) {
        for (const match of fs.readFileSync(path.join(root, dir, name), 'utf8').matchAll(/export\s+(?:function|const)\s+(\w+)/gu)) exporter.set(match[1], `${dir}/${name}`);
      }
    }
    const owner = fs.readFileSync(path.join(operators, 'effectGraphOwner.ts'), 'utf8');
    const start = owner.indexOf('const fallback = effectType');
    const chain = owner.slice(start, owner.indexOf(';', start));
    const lastCreator = [...chain.matchAll(/create\w+/gu)].at(-1)?.[0] ?? '';
    const colorIds = (fs.readFileSync(path.join(operators, 'colorEffectGraphs.ts'), 'utf8').match(/type EditableColorEffectType = ([^;]+);/u)?.[1] ?? '')
      .match(/[a-z-]+/gu) ?? [];
    const shotIds = new Set(fs.readdirSync(path.join(root, 'scripts/effect-graph-shots')).flatMap((name) =>
      (JSON.parse(fs.readFileSync(path.join(root, 'scripts/effect-graph-shots', name), 'utf8')).shots as string[]).map((spec) => parseGraphShot(spec).effect)));
    // The trailing branches: `if (effect.type === 'voxel-relief') return voxelOperatorGraph(params);`, also on an
    // id constant (`const PARTICLE_DISINTEGRATE = '...'`, an imported WEAVE_EFFECT_TYPE).
    const constants = new Map<string, string>();
    for (const name of fs.readdirSync(operators, { recursive: true }).map(String).filter((entry) => entry.endsWith('.ts'))) {
      for (const match of fs.readFileSync(path.join(operators, name), 'utf8').matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*'([a-z0-9-]+)'/gu)) constants.set(match[1], match[2]);
    }
    const returns = new Map<string, string>();
    for (const match of owner.matchAll(/if \(effect\.type === (?:'([a-z0-9-]+)'|([A-Z][A-Z0-9_]*))\) return (?:\w+\()?(\w+)\(/gu)) {
      const id = match[1] ?? constants.get(match[2]);
      if (id && !returns.has(id)) returns.set(id, match[3]);
    }
    expect(returns.get('pixel-particle-disintegrate')).toBe('particleDisintegrateOperatorGraph');
    expect(returns.get('voxel-relief')).toBe('voxelOperatorGraph');
    const missing: string[] = [];
    let checked = 0;
    for (const id of shotIds) {
      const at = chain.indexOf(`'${id}'`);
      const creatorName = returns.get(id) ?? (at >= 0 ? chain.slice(at).match(/create\w+/u)?.[0] : colorIds.includes(id) ? lastCreator : undefined);
      if (!creatorName) continue;
      checked += 1;
      const file = exporter.get(creatorName);
      if (file && !code.codeFiles(id).includes(file)) missing.push(`${id}: ${file} (${creatorName})`);
    }
    expect(checked).toBeGreaterThan(20);
    expect(missing).toEqual([]);
  });
});

describe('docs media recipe helpers', () => {
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(scratch, file)), { recursive: true });
    fs.writeFileSync(path.join(scratch, file), text);
  };

  it('reads every shot-list format as it is (pairs, strips, graph shots, editor shots, clips)', () => {
    write('scripts/effect-lab-shots/demo.json', JSON.stringify({ pairs: [{ name: 'demo', out: 'docs/Features/assets/effects/demo.webp', image: 'harbor_town',
      left: { effect: 'original' }, right: { effect: 'demo-blur', params: { radius: 4 } } }], strips: [{ effect: 'demo-blur', image: 'dancer_stage' }] }));
    write('scripts/effect-graph-shots/demo.json', JSON.stringify({ shots: ['demo-blur?plumbing=hide', 'demo-blur?focus=a&marks=x:left@demo-blur-a'] }));
    write('scripts/effect-editor-shots/demo.json', JSON.stringify({ shots: [{ name: 'demo-inspector', effect: 'demo-blur' },
      { name: 'demo-scene', view: 'preview', effect: 'demo-blur', file: 'docs/Features/assets/effects/demo-scene.webp' }] }));
    write('scripts/doc-clips/demo.json', JSON.stringify({ out: 'docs/Features/assets/effects/clips', source: 'dancer_stage_motion.mp4',
      clips: [{ name: 'demo-loop', effect: 'demo-blur', layout: 'compare' }, { name: 'add-demo', kind: 'operation', effects: [{ effect: 'demo-blur' }] }] }));
    const lab = shotListRecipes('lab', 'scripts/effect-lab-shots/demo.json', { root: scratch });
    expect(lab.map((recipe) => [recipe.kind, recipe.name, recipe.effects, recipe.outputs])).toEqual([
      ['still', 'demo', ['demo-blur'], ['docs/Features/assets/effects/demo.webp']],
      ['strip', 'demo-blur', ['demo-blur'], ['docs/Features/assets/effects/presets/demo-blur.webp']],
    ]);
    expect(shotListRecipes('graph', 'scripts/effect-graph-shots/demo.json', { root: scratch }).map((recipe) => recipe.outputs[0]))
      .toEqual(['docs/Features/assets/effects/graphs/demo-blur.webp', 'docs/Features/assets/effects/graphs/demo-blur-a.webp']);
    const editor = shotListRecipes('editor', 'scripts/effect-editor-shots/demo.json', { root: scratch });
    expect(editor.map((recipe) => [recipe.outputs[0], recipe.theme])).toEqual([
      ['docs/Features/assets/effects/editor/demo-inspector.webp', 'dark'], ['docs/Features/assets/effects/demo-scene.webp', undefined]]);
    const clips = shotListRecipes('clip', 'scripts/doc-clips/demo.json', { root: scratch });
    expect(clips.map((recipe) => [recipe.outputs, recipe.effects, recipe.theme])).toEqual([
      [['docs/Features/assets/effects/clips/demo-loop.mp4', 'docs/Features/assets/effects/clips/demo-loop.webp'], ['demo-blur'], undefined],
      [['docs/Features/assets/effects/clips/add-demo.mp4', 'docs/Features/assets/effects/clips/add-demo.webp'], ['demo-blur'], 'dark'],
    ]);
    // The clips read the footage in the repository by default.
    expect(clips[0].inputs[0]).toBe(path.join(root, 'tests/browser/effect-lab/footage/dancer_stage_motion.mp4'));
    expect(parseGraphShot('drift-lines?focus=bands&marks=row:above@drift-lines-bands')).toEqual({ effect: 'drift-lines', name: 'drift-lines-bands' });
  });

  it('flags an asset without a recipe, a recipe without its file and an unknown effect', () => {
    const recipe = { id: 'still x.json#a', kind: 'still', file: 'x.json', group: 'x', name: 'a', spec: {}, effects: ['nope'], inputs: [],
      outputs: ['docs/Features/assets/effects/a.webp'] };
    const problems = recipeProblems({ recipes: [recipe], assets: ['docs/Features/assets/effects/b.webp', 'docs/Features/assets/workflows/w.webp'],
      effectIds: new Set(['blur']), exists: () => false });
    expect(problems).toEqual([
      expect.stringMatching(/^docs\/Features\/assets\/effects\/b\.webp has no recipe/u),
      expect.stringMatching(/^still x\.json#a points to docs\/Features\/assets\/effects\/a\.webp, which does not exist/u),
      'still x.json#a names effect "nope", which the registry does not have',
    ]);
    expect(handMadeReason('docs/Features/assets/workflows/w.webp')).toMatch(/by hand/u);
  });

  it('selects recipes by effect id, picker group or shot list and names what matched nothing', () => {
    expect(selectRecipes(recipes, { ids: ['gaussian-blur'], snapshot }).recipes.map((recipe) => recipe.id))
      .toContain('still scripts/effect-lab-shots/blur.json#gaussian-blur');
    const lines = selectRecipes(recipes, { ids: ['lines'], kinds: ['clip'], snapshot }).recipes;
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((recipe) => recipe.kind === 'clip')).toBe(true);
    expect(selectRecipes(recipes, { ids: ['no-such-effect'], snapshot }).unknown).toEqual(['no-such-effect']);
  });

  it('changes the fingerprint when the recipe, the effect code or the media changes', () => {
    write('src/effects/demo/demoBlur.ts', "import shader from './demo.wgsl?raw';\nexport const demo = { id: 'demo-blur', name: 'Demo', shader };\n");
    write('src/effects/demo/demo.wgsl', 'fn main() {}\n');
    write('src/effects/other.ts', "export const other = { id: 'other', name: 'Other' };\n");
    write('src/services/operators/demoBlurGraph.ts', "export const graphOf = (type: string) => type === 'demo-blur';\n");
    write('media/frame.jpg', 'frame-1');
    const recipe = { id: 'still s.json#demo', kind: 'still', spec: { radius: 4 }, effects: ['demo-blur'], inputs: [path.join(scratch, 'media/frame.jpg')], outputs: ['a.webp'] };
    const index = effectCodeIndex(scratch);
    expect(index.codeFiles('demo-blur')).toEqual(['src/effects/demo/demo.wgsl', 'src/effects/demo/demoBlur.ts', 'src/services/operators/demoBlurGraph.ts']);
    const first = recipeFingerprint(recipe, { code: index });
    expect(recipeFingerprint({ ...recipe, spec: { radius: 5 } }, { code: index })).not.toBe(first);
    write('src/effects/other.ts', "export const other = { id: 'other', name: 'Other!' };\n");
    expect(recipeFingerprint(recipe, { code: effectCodeIndex(scratch) }), 'another effect changed').toBe(first);
    write('src/effects/demo/demo.wgsl', 'fn main() { return; }\n');
    const shaderChanged = recipeFingerprint(recipe, { code: effectCodeIndex(scratch) });
    expect(shaderChanged).not.toBe(first);
    // A Windows checkout (core.autocrlf) holds the same code with CRLF: same fingerprint.
    const lf = fs.readFileSync(path.join(scratch, 'src/effects/demo/demoBlur.ts'), 'utf8');
    write('src/effects/demo/demoBlur.ts', lf.replace(/\n/gu, '\r\n'));
    write('src/effects/demo/demo.wgsl', 'fn main() { return; }\r\n');
    expect(recipeFingerprint(recipe, { code: effectCodeIndex(scratch) }), 'CRLF line endings').toBe(shaderChanged);
    write('src/effects/demo/demoBlur.ts', lf);
    write('media/frame.jpg', 'frame-2');
    expect(recipeFingerprint(recipe, { code: effectCodeIndex(scratch) })).not.toBe(shaderChanged);
    // Status against a manifest: current, stale, unknown, missing.
    const code = effectCodeIndex(scratch);
    const manifest = { 'a.webp': { recipe: recipe.id, fingerprint: recipeFingerprint(recipe, { code }) } };
    const states = recipeStatus([recipe, { ...recipe, spec: { radius: 9 } }, { ...recipe, outputs: ['b.webp'] }, { ...recipe, outputs: ['gone.webp'] }],
      { code, manifest: { ...manifest, 'b.webp': undefined }, exists: (file: string) => file !== 'gone.webp' });
    expect([...states.values()]).toEqual(['current', 'stale', 'unknown', 'missing']);
    // A plain --adopt records only the unknown one and leaves the stale one stale; named ids adopt the stale one too.
    expect(adoptable([...states.keys()], states, { named: false }).map((entry) => states.get(entry))).toEqual(['unknown']);
    expect(adoptable([...states.keys()], states, { named: true }).map((entry) => states.get(entry))).toEqual(['current', 'stale', 'unknown']);
    expect(manifestText({ 'b.webp': { recipe: 'r', fingerprint: '1' }, 'a.webp': { recipe: 'r', fingerprint: '2' } }).split('\n').filter((line) => line.startsWith('    ')))
      .toEqual(['    "a.webp": {"recipe":"r","fingerprint":"2"},', '    "b.webp": {"recipe":"r","fingerprint":"1"}']);
  });

  it('cuts a thumbnail past the light divider of a split still, and only at inner edges', async () => {
    // 200 × 100: dark left half, a 5 px white band at columns 98-102, a mid-grey right half with noise.
    const width = 200, height = 100;
    const image = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) image[y * width + x] = x >= 98 && x <= 102 ? 252 : x < 100 ? 30 : 90 + ((x * 7 + y * 13) % 40);
    }
    const pixels = async (strip: { left: number; top: number; width: number; height: number }) => {
      const out = new Uint8Array(strip.width * strip.height);
      for (let y = 0; y < strip.height; y += 1) for (let x = 0; x < strip.width; x += 1) out[y * strip.width + x] = image[(strip.top + y) * width + strip.left + x];
      return out;
    };
    const right = await trimDividers(thumbRegion({ width, height }), { width, height }, pixels);
    expect(right.left).toBeGreaterThan(102);
    expect(right.left + right.width).toBe(width);
    expect(right.top).toBe(0);
    expect(right.height).toBe(height);
    // The left half of a detail poster: trimmed at its right (inner) edge only.
    const left = await trimDividers(thumbRegion({ width, height }, [0, 0, 0.5, 1]), { width, height }, pixels);
    expect(left.left).toBe(0);
    expect(left.left + left.width).toBeLessThanOrEqual(98);
    // A whole picture keeps every pixel.
    expect(await trimDividers(thumbRegion({ width, height }, [0, 0, 1, 1]), { width, height }, pixels)).toEqual({ left: 0, top: 0, width, height });
  });

  it('notices a reused Vite that serves older code than the disk holds, shaders included, and names what it could not check', async () => {
    write('src/effects/demo/fresh.ts', 'export const a = 1;\n');
    write('src/effects/demo/old.ts', 'export const a = 2;\n');
    write('src/effects/demo/old.wgsl', 'fn b() {}\n');
    write('src/effects/demo/demo.wgsl', 'fn a() {}\n');
    write('src/effects/demo/types.ts', 'export interface Demo { a: number }\n');
    write('src/effects/demo/gone.ts', 'export const c = 3;\n');
    const served: Record<string, string> = {
      '/src/effects/demo/fresh.ts': 'export const a = 1;\n',
      '/src/effects/demo/old.ts': 'export const a = 1;\n',
    };
    // Split so Vite does not read the comment as this test file's own source map.
    const map = (url: string, source: string) => `//# source${'MappingURL'}=data:application/json;base64,${
      Buffer.from(JSON.stringify({ version: 3, sources: [url], sourcesContent: [source], mappings: '' })).toString('base64')}`;
    const server = http.createServer((request, response) => {
      const url = request.url ?? '';
      // The real Vite shape: the shader as a string literal, then the inline source map comment it appends to every module.
      if (url.endsWith('?import&raw')) { response.end(`export default ${JSON.stringify('fn a() {}\n')}\n${map(url, 'fn a() {}\n')}`); return; }
      // A file of types only compiles to an empty module without a map.
      if (url === '/src/effects/demo/types.ts') { response.end(''); return; }
      const source = served[url];
      if (source === undefined) { response.statusCode = 404; response.end(); return; }
      response.end(`export const a = 0;\n${map(url, source)}\n`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as { port: number };
      const files = ['src/effects/demo/fresh.ts', 'src/effects/demo/old.ts', 'src/effects/demo/old.wgsl', 'src/effects/demo/demo.wgsl',
        'src/effects/demo/types.ts', 'src/effects/demo/gone.ts'];
      expect(await oldModules(`http://127.0.0.1:${port}`, scratch, files))
        .toEqual({ old: ['src/effects/demo/old.ts', 'src/effects/demo/old.wgsl'], unchecked: ['src/effects/demo/gone.ts (HTTP 404)'] });
      // A file that held only types and gained code Vite did not see is old.
      write('src/effects/demo/types.ts', 'export interface Demo { a: number }\nexport const b = 1;\n');
      expect((await oldModules(`http://127.0.0.1:${port}`, scratch, ['src/effects/demo/types.ts'])).old).toEqual(['src/effects/demo/types.ts']);
    } finally {
      server.close();
    }
  });

  it('records a shot only for the file it wrote, and keeps the code and footage of a kept export', () => {
    write('scripts/effect-graph-shots/rec.json', JSON.stringify({ shots: ['demo-blur'] }));
    write('docs/Features/assets/effects/graphs/demo-blur.webp', 'x');
    const manifestFile = path.join(scratch, 'scripts/docs-media-manifest.json');
    fs.rmSync(manifestFile, { force: true });
    const env = process.env.DOCS_MEDIA_OUT_ROOT;
    delete process.env.DOCS_MEDIA_OUT_ROOT;
    try {
      // An explicit --out elsewhere: the asset in the repository stays as it was recorded.
      recordShotList('graph', path.join(scratch, 'scripts/effect-graph-shots/rec.json'), ['demo-blur'], { root: scratch, written: path.join(scratch, 'elsewhere/demo-blur.webp') });
      expect(readManifest(scratch)).toEqual({});
      recordShotList('graph', path.join(scratch, 'scripts/effect-graph-shots/rec.json'), ['demo-blur'], { root: scratch, written: path.join(scratch, 'docs/Features/assets/effects/graphs/demo-blur.webp') });
      const [recipe] = shotListRecipes('graph', 'scripts/effect-graph-shots/rec.json', { root: scratch });
      const today = recipeFingerprint(recipe, { code: effectCodeIndex(scratch) });
      expect(readManifest(scratch)['docs/Features/assets/effects/graphs/demo-blur.webp'].fingerprint).toBe(today);
      // Encoded again from an export made with older code: the older code is recorded, so the asset stays stale.
      const older = { ...fingerprintParts(recipe, { code: effectCodeIndex(scratch) }), code: 'older-code' };
      recordShotList('graph', path.join(scratch, 'scripts/effect-graph-shots/rec.json'), ['demo-blur'], { root: scratch, written: path.join(scratch, 'docs/Features/assets/effects/graphs/demo-blur.webp'), parts: older });
      expect(readManifest(scratch)['docs/Features/assets/effects/graphs/demo-blur.webp'].fingerprint).not.toBe(today);
      expect(recipeStatus([recipe], { code: effectCodeIndex(scratch), manifest: readManifest(scratch), exists: () => true }).get(recipe)).toBe('stale');
    } finally {
      if (env !== undefined) process.env.DOCS_MEDIA_OUT_ROOT = env;
    }
  });

  it('cuts a thumbnail from the loop the page plays, and takes a single picture whole', () => {
    const { still, poster, clip } = effectAssets('demo');
    const has = (...files: string[]) => (file: string) => files.includes(file);
    expect(thumbSource('demo', { exists: has(still), page: `![x](../${still})` })).toBe(still);
    // The page plays its loop (the model page): the poster, even when an older still is around.
    expect(thumbSource('demo', { exists: has(still, poster), page: `<video src="../${clip}">` })).toBe(poster);
    // A still the page does not show is out of date.
    expect(thumbSource('demo', { exists: has(still, poster), page: 'text' })).toBe(poster);
    expect(thumbSource('demo', { exists: has(still, poster), page: `![x](../${still}) <video src="../assets/effects/clips/other.mp4">` })).toBe(still);
    expect(thumbSource('demo', { exists: has(still, poster), page: undefined, override: poster })).toBe(poster);
    expect(thumbRecipe('demo', { source: poster, layout: 'compare' }).spec).toEqual({ source: poster, fit: 'whole' });
    expect(thumbRecipe('demo', { source: poster, layout: 'single' }).spec.region).toEqual([0, 0, 1, 1]);
    expect(thumbRecipe('demo', { source: still, layout: 'single' }).spec.region).toEqual([0, 0, 1, 1]);
    expect(thumbRecipe('demo', { source: still, layout: 'still' }).spec.region).toBeUndefined();
    // A detail poster (whole frame | enlargement): the whole frame, not the blurred enlargement.
    expect(thumbRecipe('demo', { source: poster, layout: 'detail' }).spec.region).toEqual([0, 0, 0.5, 1]);
    // The model page Drift Lines: its card comes from the loop's poster.
    expect(collectRecipes({ root, snapshot }).find((recipe) => recipe.id === 'thumb scripts/effect-docs.mjs#drift-lines')?.spec.source)
      .toBe('assets/effects/clips/drift-lines.webp');
  });

  it('shows a new generator alone on black and can turn a split still into a compare pair', () => {
    const generator = { id: 'demo-gen', name: 'Demo Gen', group: 'generate' };
    expect(labShot(generator).layout).toBe('single');
    expect(labPair(generator)).toMatchObject({ image: 'black', layout: 'single', right: { effect: 'demo-gen' } });
    expect(fs.existsSync(path.join(root, 'tests/browser/effect-lab/images/black.jpg'))).toBe(true);
    const filter = { id: 'demo-filter', name: 'Demo', group: 'blur' };
    expect(labShot(filter, { width: 1200, height: 675 }).layout).toBe('split');
    expect(labShot(filter, undefined).layout).toBe('compare');
  });

  it('splits a long contact sheet into pages', () => {
    expect(sheetPages('/x/contact-sheet.jpg', 1)).toEqual(['/x/contact-sheet.jpg']);
    expect(sheetPages('/x/contact-sheet.jpg', 2)).toEqual(['/x/contact-sheet-1.jpg', '/x/contact-sheet-2.jpg']);
  });

  it('writes a scratch run under its own folder and finds footage in the repository', () => {
    const env = { DOCS_MEDIA_OUT_ROOT: scratch };
    const written = docOutput('docs/Features/assets/effects/x.webp', env);
    expect(written).toBe(path.join(scratch, 'docs/Features/assets/effects/x.webp'));
    expect(docLogicalPath(written, env)).toBe(path.join(root, 'docs/Features/assets/effects/x.webp'));
    expect(docOutput('docs/Features/assets/effects/x.webp', {})).toBe(path.join(root, 'docs/Features/assets/effects/x.webp'));
    expect(findMedia('dancer_stage_motion.mp4', { env: {} })).toBe(path.join(root, 'tests/browser/effect-lab/footage/dancer_stage_motion.mp4'));
    // CRF 21 keeps the pleats and the dark curtain for the 2× detail loops; the repository copy stays under 4 MB.
    expect(fs.statSync(path.join(root, 'tests/browser/effect-lab/footage/dancer_stage_motion.mp4')).size).toBeLessThanOrEqual(4_000_000);
    expect(findMedia('greenscreen_dancer.jpg', { env: {} })).toBe(path.join(root, 'tests/browser/effect-lab/images/greenscreen_dancer.jpg'));
  });

  const hasFfprobe = (() => { try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
  it.skipIf(!hasFfprobe)('keeps the colours of the original footage (no colour conversion in the re-encode)', () => {
    const footage = path.join(root, 'tests/browser/effect-lab/footage/dancer_stage_motion.mp4');
    // Mean Y, U, V of frames 0, 72 and 144 of the untagged Kling original. A re-encode that tags the output with
    // -colorspace/-color_range converts through RGB and moves Y by about 2 (the footage README has the right command).
    const original = [[55.49, 122.48, 133.55], [50.51, 123.36, 132.44], [50.21, 123.12, 132.83]];
    const measured = execFileSync('ffprobe', ['-v', 'error', '-f', 'lavfi', '-i',
      `movie=${footage.replace(/[\\:']/gu, '\\$&')},select='eq(n\\,0)+eq(n\\,72)+eq(n\\,144)',signalstats`,
      '-show_entries', 'frame_tags=lavfi.signalstats.YAVG,lavfi.signalstats.UAVG,lavfi.signalstats.VAVG', '-of', 'json'], { encoding: 'utf8' });
    const frames = (JSON.parse(measured).frames as { tags: Record<string, string> }[])
      .map(({ tags }) => ['YAVG', 'UAVG', 'VAVG'].map((key) => Number(tags[`lavfi.signalstats.${key}`])));
    expect(frames).toHaveLength(3);
    frames.forEach((frame, index) => frame.forEach((value, channel) => expect(Math.abs(value - original[index][channel]), `frame ${[0, 72, 144][index]} channel ${'YUV'[channel]}: ${value}`).toBeLessThan(0.3)));
  });
});
