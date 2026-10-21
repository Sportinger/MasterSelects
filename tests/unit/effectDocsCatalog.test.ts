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
  CATALOG_FILE, CONTROLS_END, CONTROLS_START, THUMB_MAX_BYTES, basicPage, cardText, controlsTable, firstSentence, pageLead,
  planEffectDocs, refreshGeneratedBlocks, snapshotRegistry,
} from '../../scripts/effectDocsCatalog.mjs';

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
    const stale = [...plan.texts].filter(([file, text]) => file !== CATALOG_FILE && read(file) !== text).map(([file]) => file);
    expect(stale, rerun).toEqual([]);
  });

  it('every visible effect has a page or is described on an effect group page', () => {
    expect(plan.uncovered.map((effect) => effect.id)).toEqual([]);
  });

  it('pictures the catalog names exist and thumbnails fit their budget', () => {
    for (const entry of plan.catalog.effects) {
      for (const asset of [entry.still, entry.thumb, entry.clip].filter(Boolean)) expect(exists(asset), asset).toBe(true);
      if (entry.thumb) expect(fs.statSync(path.join(featuresDir, entry.thumb)).size, entry.thumb).toBeLessThanOrEqual(THUMB_MAX_BYTES);
    }
  });
});

describe('effect docs helpers', () => {
  const effect = {
    id: 'demo', name: 'Demo', group: 'blur', description: 'Softens the picture; Radius sets how much.', engine: undefined, styles: [],
    experimental: undefined, kind: 'fullscreen', ownControls: false, nodeValues: false, moving: false, live: false, hidden: false,
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
    expect(page.startsWith('# Demo\n\n<!-- effect-docs: basic page')).toBe(true);
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
});
