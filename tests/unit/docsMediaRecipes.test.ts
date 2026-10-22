// Docs media recipes: every picture and clip under docs/Features/assets has a recipe that makes it again
// (node scripts/docs-media.mjs), and every recipe points to a file and an effect that exist. Stale assets
// (recipe, effect code or footage changed since the render) are reported as a warning, not a failure.
import fs from 'node:fs';
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
  HAND_MADE, RECIPE_PENDING, assetFiles, collectRecipes, handMadeReason, parseGraphShot, recipeProblems, selectRecipes, shotListRecipes,
} from '../../scripts/docsMediaRecipes.mjs';
import { effectCodeIndex, manifestText, readManifest, recipeFingerprint, recipeStatus } from '../../scripts/docsMediaFingerprint.mjs';

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
    write('src/services/operators/demoBlurGraph.ts', "export const graphOf = { 'demo-blur': 1 };\n");
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
    write('media/frame.jpg', 'frame-2');
    expect(recipeFingerprint(recipe, { code: effectCodeIndex(scratch) })).not.toBe(shaderChanged);
    // Status against a manifest: current, stale, unknown, missing.
    const code = effectCodeIndex(scratch);
    const manifest = { 'a.webp': { recipe: recipe.id, fingerprint: recipeFingerprint(recipe, { code }) } };
    const states = recipeStatus([recipe, { ...recipe, spec: { radius: 9 } }, { ...recipe, outputs: ['b.webp'] }, { ...recipe, outputs: ['gone.webp'] }],
      { code, manifest: { ...manifest, 'b.webp': undefined }, exists: (file: string) => file !== 'gone.webp' });
    expect([...states.values()]).toEqual(['current', 'stale', 'unknown', 'missing']);
    expect(manifestText({ 'b.webp': { recipe: 'r', fingerprint: '1' }, 'a.webp': { recipe: 'r', fingerprint: '2' } }).split('\n').filter((line) => line.startsWith('    ')))
      .toEqual(['    "a.webp": {"recipe":"r","fingerprint":"2"},', '    "b.webp": {"recipe":"r","fingerprint":"1"}']);
  });

  it('writes a scratch run under its own folder and finds footage in the repository', () => {
    const env = { DOCS_MEDIA_OUT_ROOT: scratch };
    const written = docOutput('docs/Features/assets/effects/x.webp', env);
    expect(written).toBe(path.join(scratch, 'docs/Features/assets/effects/x.webp'));
    expect(docLogicalPath(written, env)).toBe(path.join(root, 'docs/Features/assets/effects/x.webp'));
    expect(docOutput('docs/Features/assets/effects/x.webp', {})).toBe(path.join(root, 'docs/Features/assets/effects/x.webp'));
    expect(findMedia('dancer_stage_motion.mp4', { env: {} })).toBe(path.join(root, 'tests/browser/effect-lab/footage/dancer_stage_motion.mp4'));
    expect(fs.statSync(path.join(root, 'tests/browser/effect-lab/footage/dancer_stage_motion.mp4')).size).toBeLessThanOrEqual(3_000_000);
    expect(findMedia('greenscreen_dancer.jpg', { env: {} })).toBe(path.join(root, 'tests/browser/effect-lab/images/greenscreen_dancer.jpg'));
  });
});
