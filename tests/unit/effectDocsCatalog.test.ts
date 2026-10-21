// Effect docs drift test: docs/Features/effects (catalog.json, the generated controls tables and
// the basic pages) must match the effect registry. Fix a failure with `node scripts/effect-docs.mjs`.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EFFECTS_HIDDEN_FROM_CATALOG, EFFECT_GROUPS, effectEngine, effectEngineMembers, effectExperimentalNote, getAllEffects,
} from '../../src/effects';
import { effectParamDisplay } from '../../src/effects/paramDisplay';
import { catalogText } from '../../src/services/nodeGraph/catalogText';
import {
  CATALOG_FILE, CONTROLS_END, CONTROLS_START, PICTURE_PENDING, THUMB_MAX_BYTES, basicPage, cardText, controlsTable, firstSentence,
  generatedBlockProblem, isBasicPage, pageLead, planEffectDocs, refreshGeneratedBlocks, snapshotRegistry,
} from '../../scripts/effectDocsCatalog.mjs';
import { BUDGETS } from '../../docs-site/scripts/lib/media.mjs';
import { controlParagraphSkeletons, handWrittenPageProblems } from '../../scripts/effectDocsPageCheck.mjs';

const featuresDir = path.resolve(__dirname, '../../docs/Features');
const read = (file: string) => (fs.existsSync(path.join(featuresDir, file)) ? fs.readFileSync(path.join(featuresDir, file), 'utf8') : undefined);
const exists = (file: string) => fs.existsSync(path.join(featuresDir, file));
const pages = fs.readdirSync(path.join(featuresDir, 'effects'))
  .filter((name) => name.endsWith('.md') && name !== 'index.md').map((name) => name.slice(0, -3)).toSorted();

const snapshot = snapshotRegistry({
  effects: getAllEffects(), groups: EFFECT_GROUPS, hidden: EFFECTS_HIDDEN_FROM_CATALOG, engineOf: effectEngine,
  engineMembers: effectEngineMembers, text: catalogText, display: effectParamDisplay, experimental: effectExperimentalNote,
});
const plan = planEffectDocs(snapshot, { read, exists, pages });
const rerun = 'out of date: run node scripts/effect-docs.mjs';

describe('effect docs match the registry', () => {
  it('catalog.json lists every registry effect in picker order', () => {
    expect(read(CATALOG_FILE), rerun).toBe(plan.texts.get(CATALOG_FILE));
    expect(plan.catalog.effects.map((entry) => entry.id).toSorted()).toEqual(getAllEffects().map((effect) => effect.id).toSorted());
  });

  it('every effect page is named after an effect id and its generated parts are current', () => {
    expect(plan.unknownPages, 'effects/<id>.md must use a registry id').toEqual([]);
    expect(plan.problems.map((problem: { text: string }) => problem.text)).toEqual([]);
    const stale = [...plan.texts].filter(([file, text]) => file !== CATALOG_FILE && read(file) !== text).map(([file]) => file);
    expect(stale, rerun).toEqual([]);
  });

  it('hand-written pages describe every control and preset of the card with its current limits', () => {
    const problems = pages.flatMap((id) => {
      const effect = snapshot.effects.find((entry: { id: string }) => entry.id === id), text = read(`effects/${id}.md`);
      if (!effect || text === undefined || isBasicPage(text)) return [];
      return handWrittenPageProblems(effect, text, { exists }).map((problem: string) => `effects/${id}.md ${problem}`);
    });
    expect(problems, 'node scripts/effect-docs.mjs --controls <id> prints the paragraphs and limits').toEqual([]);
  });

  it('every visible effect has its own page', () => {
    expect(plan.uncovered.map((effect) => effect.id), 'write effects/<id>.md, or run node scripts/effect-docs.mjs --basic').toEqual([]);
  });

  it('every effect has a still and a gallery thumbnail within budget, unless its picture is pending', () => {
    expect(THUMB_MAX_BYTES).toBe(BUDGETS.thumbBytes);
    const missing = plan.catalog.effects.filter((entry) => !entry.hidden && !PICTURE_PENDING[entry.id] && (!entry.still || !entry.thumb));
    expect(missing.map((entry) => entry.id), 'render a still (effect-lab --pairs), then node scripts/effect-docs.mjs --thumbs').toEqual([]);
    for (const entry of plan.catalog.effects.filter((item) => item.thumb)) {
      expect(fs.statSync(path.join(featuresDir, entry.thumb)).size, entry.thumb).toBeLessThanOrEqual(THUMB_MAX_BYTES);
    }
    const stalePending = Object.keys(PICTURE_PENDING).filter((id) => plan.catalog.effects.find((entry) => entry.id === id)?.thumb);
    expect(stalePending, 'these effects have pictures now: remove them from PICTURE_PENDING').toEqual([]);
  });
});

describe('effect docs helpers', () => {
  const effect = {
    id: 'demo', name: 'Demo', group: 'blur', description: 'Softens the picture; Radius sets how much.', engine: undefined, styles: [],
    experimental: undefined, kind: 'fullscreen', ownControls: false, nodeValues: false, moving: false, live: false, feedback: false, hidden: false,
    hiddenParams: [],
    params: [
      { key: 'radius', label: 'Radius', type: 'number', section: '', min: 0, max: 100, default: 10, display: { scale: 1, suffix: 'px', decimals: 0 } },
      { key: 'turn', label: 'Turn', type: 'number', section: '', min: 0, max: 1, default: 0.25, display: { scale: 360, suffix: '°', decimals: 0 } },
      { key: 'mode', label: 'Mode', type: 'select', section: 'Quality', default: 'b', options: [{ value: 'a', label: 'Fast' }, { value: 'b', label: 'Fine' }] },
      { key: 'angle', label: 'Angle', type: 'number', section: '', min: -1, max: 1, default: 0, onlyWhen: 'Only in Offset mode.' },
    ],
  };

  it('writes the controls table in the units of the effect card, Quality last', () => {
    const table = controlsTable({ ...effect, params: [effect.params[2], effect.params[0], effect.params[1], effect.params[3]] });
    expect(table).toContain('| Radius | 0 to 100 px | 10 px |');
    expect(table).toContain('| Turn | 0 to 360° | 90° |');
    expect(table).toContain('| Angle (Only in Offset mode) | −1 to 1 | 0 |');
    expect(table.indexOf('**Quality**')).toBeGreaterThan(table.indexOf('| Radius'));
    expect(table).toContain('| Mode | Fast, Fine | Fine |');
  });

  it('shows range ends and defaults with the decimals they need', () => {
    const table = controlsTable({ ...effect, params: [
      { key: 'feather', label: 'Feather', type: 'number', section: '', min: 0.001, max: 1, default: 0.15, display: { scale: 1, step: 0.01, decimals: 2 } },
      { key: 'angle', label: 'Angle', type: 'number', section: '', min: 0, max: 6.28318, default: 2, display: { scale: 180 / Math.PI, step: 1, suffix: '°', decimals: 0 } },
    ] });
    expect(table).toContain('| Feather | 0.001 to 1 | 0.15 |');
    expect(table).toContain('| Angle | 0 to 360° | 114.59° |');
  });

  it('keeps "$&" in a table literal and reports broken markers', () => {
    const odd = { ...effect, params: [{ ...effect.params[0], label: "Cost $& $' $$" }] };
    const refreshed = refreshGeneratedBlocks(`# Demo\n\n${CONTROLS_START}\nold\n${CONTROLS_END}\n`, odd);
    expect(refreshed).toContain("| Cost $& $' $$ |");
    expect(generatedBlockProblem(`# Demo\n\n${CONTROLS_START}\nno end\n`)).toMatch(/1 .* and 0 /u);
    expect(generatedBlockProblem(`${CONTROLS_START}\na\n${CONTROLS_END}\n${CONTROLS_START}\nb\n${CONTROLS_END}`)).toMatch(/2 generated/u);
    expect(generatedBlockProblem(`${CONTROLS_START}\na\n${CONTROLS_END}`)).toBeUndefined();
  });

  it('never overwrites a basic page that was edited under its marker', () => {
    const snap = { groups: [{ id: 'blur', label: 'Blur & Sharpen', effects: ['demo'] }], effects: [effect] };
    const page = basicPage(effect, { groupLabel: 'Blur & Sharpen', overview: undefined, still: undefined, names: new Map() });
    const files = (text: string) => ({ read: (file: string) => (file === 'effects/demo.md' ? text : undefined), exists: () => false, pages: ['demo'] });
    expect(planEffectDocs(snap, files(page)).problems).toEqual([]);
    const edited = `${page}\n**Tip:** a hand-written tip.\n`;
    const result = planEffectDocs(snap, files(edited));
    expect(result.texts.has('effects/demo.md')).toBe(false);
    expect(result.problems[0].text).toMatch(/effects\/demo\.md was edited by hand: delete its marker line/u);
    // The marker counts only as the first line under the title.
    expect(isBasicPage(page)).toBe(true);
    expect(isBasicPage(`# Demo\n\nA hand-written lead.\n\n<!-- effect-docs: basic page sha=0, quoted -->\n`)).toBe(false);
  });

  it('refreshes only the generated block of a hand-written page', () => {
    const page = `# Demo\n\nHand-written lead.\n\n${CONTROLS_START}\nold table\n${CONTROLS_END}\n\n**Tip:** keep this.\n`;
    const refreshed = refreshGeneratedBlocks(page, effect);
    expect(refreshed).toContain('Hand-written lead.');
    expect(refreshed).toContain('**Tip:** keep this.');
    expect(refreshed).not.toContain('old table');
    expect(refreshed).toContain('| Radius | 0 to 100 px | 10 px |');
    expect(refreshGeneratedBlocks('# Demo\n\nNo block.\n', effect)).toBe('# Demo\n\nNo block.\n');
  });

  it('never replaces a hand-written page with a basic page', () => {
    const handWritten = `# Demo\n\nA smooth softening. **Blur & Sharpen**\n\n${CONTROLS_START}\nold\n${CONTROLS_END}\n`;
    const files = { read: (file: string) => (file === 'effects/demo.md' ? handWritten : undefined), exists: () => false, pages: ['demo'] };
    const result = planEffectDocs({ groups: [{ id: 'blur', label: 'Blur & Sharpen', effects: ['demo'] }], effects: [effect] }, files, { basic: ['demo'] });
    const text = result.texts.get('effects/demo.md');
    expect(text).toContain('A smooth softening.');
    expect(text).not.toContain('effect-docs: basic page');
    expect(result.catalog.effects[0]).toMatchObject({ page: 'effects/demo.md', description: 'A smooth softening.' });
    expect(result.catalog.effects[0].basic).toBeUndefined();
  });

  it('writes a marked basic page that links its group and the add-an-effect section', () => {
    const page = basicPage(effect, { groupLabel: 'Blur & Sharpen', overview: 'Effects-Blur.md', still: undefined, names: new Map() });
    expect(page.startsWith('# Demo\n\n<!-- effect-docs: basic page sha=')).toBe(true);
    expect(page).toContain('[Blur & Sharpen](../Effects-Blur.md)');
    expect(page).toContain('(../Effects.md#add-an-effect)');
    expect(page).toContain('## Controls');
    expect(page).toContain('## Technical details');
  });

  it('shortens catalog text and reads a page lead for gallery cards', () => {
    expect(cardText('Turns the picture into a watercolour painting: flat washes; Wash sets the softness.')).toBe('Turns the picture into a watercolour painting.');
    expect(cardText('Adjusts exposure in stops (+1 doubles the light), with a Gamma curve; Offset adds.')).toBe('Adjusts exposure in stops, with a Gamma curve.');
    expect(firstSentence(pageLead('# Glow\n\n<!-- note -->\n\n<figure>\n<img>\n</figure>\n\nA soft [halo](./x.md) around light. It **blooms**.\n') ?? '')).toBe('A soft halo around light.');
  });

  it('checks control and preset paragraphs of a hand-written page against the card', () => {
    const demo = { ...effect, params: [{ ...effect.params[0], section: 'Shape' }, { ...effect.params[1], section: 'Shape' }],
      presets: [{ id: 'soft', name: 'Soft', params: { radius: 4 } }, { id: 'hard', name: 'Hard', params: { radius: 90 } }] };
    expect(controlParagraphSkeletons(demo)).toContain('### Shape\n\n**Radius** – what it does to the picture; how its values feel. 0 to 100 px, default 10 px.');
    const page = (controls: string, presets = '**Soft** – gentle.\n\n**Hard** – strong.') => `# Demo\n\nLead.\n\n## Presets\n\n`
      + `![strip](../assets/effects/presets/demo.webp)\n\n${presets}\n\n## Controls\n\n${controls}\n\n## Technical details\n\nFacts.\n`;
    const good = '### Shape\n\n**Radius** – softness. 0 to 100 px, default 10 px.\n\n**Turn** – rotation. 0 to 360°, default 90°.';
    const files = { exists: () => true };
    expect(handWrittenPageProblems(demo, page(good), files)).toEqual([]);
    expect(handWrittenPageProblems(demo, page(good.replace('default 10 px', 'default 12 px')), files))
      .toEqual(['## Controls: the paragraph for **Radius** must state "0 to 100 px, default 10 px"']);
    expect(handWrittenPageProblems(demo, page('### Shape\n\n**Turn** – rotation. 0 to 360°, default 90°.\n\n**Radius** – softness. 0 to 100 px, default 10 px.'), files))
      .toEqual(['## Controls: put the paragraphs in card order (Radius, Turn)']);
    expect(handWrittenPageProblems(demo, page(`${good}\n\n**Gone** – an old control.`), files)).toEqual(['## Controls describes **Gone**, which the card does not show']);
    expect(handWrittenPageProblems(demo, page(good.replace('### Shape\n\n', '')), files)).toEqual([
      '## Controls: **Radius** belongs under "### Shape"', '## Controls: **Turn** belongs under "### Shape"']);
    expect(handWrittenPageProblems(demo, page(good, '**Soft** – gentle.\n\n**Medium** – old.'), files)).toEqual([
      '## Presets has no paragraph for the preset **Hard**', '## Presets describes **Medium**, which is no preset of Demo']);
    expect(handWrittenPageProblems(demo, page(good), { exists: () => false })[0]).toMatch(/has no preset strip assets\/effects\/presets\/demo\.webp/u);
    // A page that still carries the generated table is checked by the table; presets are checked either way.
    expect(handWrittenPageProblems({ ...demo, presets: [] }, `# Demo\n\n${CONTROLS_START}\nx\n${CONTROLS_END}\n`, files)).toEqual([]);
  });
});
