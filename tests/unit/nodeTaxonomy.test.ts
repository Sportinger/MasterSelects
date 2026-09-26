import { describe, expect, it } from 'vitest';
import { EFFECT_REGISTRY, getCategoriesWithEffects } from '../../src/effects';
import { getAllAudioEffects } from '../../src/engine/audio/AudioEffectRegistry';
import { effectGroup } from '../../src/effects/effectCatalogGroups';
import { catalogText } from '../../src/services/nodeGraph/catalogText';
import { buildAgentNodeCatalogText } from '../../src/services/nodeGraph/agentNodeCatalog';
import { EFFECT_OPERATORS } from '../../src/services/operators/operatorRegistry';
import { addableEffectOperators } from '../../src/services/operators/effectGraphOwner';
import { listNodeCatalog } from '../../src/services/operators/operatorCatalog';
import { collapseOperatorFamilies, groupOperatorMenu, operatorCategoryId, operatorVisibility } from '../../src/services/operators/operatorTaxonomy';
import { effectStyleOptions } from '../../src/services/effects/effectStyles';

const OWNERS = ['invert', 'analog-signal-lab', 'voronoi', 'voxel-relief', 'face-cables', 'splat-exploration', 'audio-math'];

describe('node catalog taxonomy', () => {
  it('assigns every operator a category', () => {
    expect(EFFECT_OPERATORS.filter(operator => !operatorCategoryId(operator)).map(operator => operator.id)).toEqual([]);
  });

  it('gives each graph menu unique labels once families are collapsed', () => {
    for (const owner of OWNERS) {
      const labels = collapseOperatorFamilies(addableEffectOperators(owner).filter(operator => operatorVisibility(operator) !== 'internal'))
        .map(operator => `${operator.composition ? 'group:' : ''}${operator.label}`);
      const duplicates = labels.filter((label, index) => labels.indexOf(label) !== index);
      expect({ owner, duplicates }).toEqual({ owner, duplicates: [] });
    }
  });

  it('keeps compiler jargon and type suffixes out of public labels', () => {
    const publicLabels = EFFECT_OPERATORS.filter(operator => operatorVisibility(operator) === 'public').map(operator => operator.label);
    expect(publicLabels.filter(label => /Legacy|IEEE|VEC\d|Materiali[sz]e|MediaPipe/.test(label))).toEqual([]);
  });

  it('hides effect building parts unless advanced nodes are requested', () => {
    const operators = addableEffectOperators('invert');
    const labels = (advanced: boolean) => groupOperatorMenu(operators, { advanced }).flatMap(group => group.entries.map(entry => entry.id));
    expect(labels(false)).not.toContain('fisheye.jitter-pattern');
    expect(labels(true)).toContain('fisheye.jitter-pattern');
    expect(labels(false)).toContain('fisheye.vignette');
  });

  it('describes and groups every effect by look, with curated order and hidden legacy styles', () => {
    for (const effect of EFFECT_REGISTRY.values()) {
      expect({ id: effect.id, group: effectGroup(effect.id).id }).not.toEqual({ id: effect.id, group: 'other' });
      expect(catalogText(`effect:${effect.id}`).description, effect.id).toBeTruthy();
    }
    for (const effect of getAllAudioEffects()) expect(catalogText(`audio:${effect.id}`).description, effect.id).toBeTruthy();
    const groups = getCategoriesWithEffects();
    expect(groups[0]).toMatchObject({ category: 'Color & Tone' });
    expect(groups[0].effects[0].id).toBe('brightness');
    expect(groups.flatMap(group => group.effects.map(effect => effect.id))).not.toContain('rom1');
    expect(groups.every(group => !/^[a-z]+$/.test(group.category))).toBe(true);
  });

  it('attributes nodes to the graphs that actually offer them', () => {
    const entries = new Map(listNodeCatalog().map(entry => [entry.id, entry]));
    expect(entries.get('analog.pal-encode')?.domains).toEqual(['Image']);
    expect(entries.get('values.number')?.domains).toEqual(expect.arrayContaining(['Image', '3D']));
    expect(entries.get('math.multiply.audio-scalar')?.domains).toEqual(['Audio']);
    expect(entries.get('splat.scale')?.domains).toEqual(['Splat']);
    expect([...entries.values()].some(entry => entry.context.includes('Face Cables'))).toBe(false);
  });

  it('offers styles only between looks that share every parameter', () => {
    expect(effectStyleOptions('acuarela').map(option => option.value)).toEqual(['acuarela', 'rom1']);
    expect(effectStyleOptions('halftone').map(option => option.value)).toEqual(expect.arrayContaining(['riso', 'dither', 'crosshatch']));
    expect(effectStyleOptions('halftone').map(option => option.value)).not.toContain('glitch');
    expect(effectStyleOptions('chroma-key')).toEqual([]);
  });

  it('lists the agent inventory by graph and category', () => {
    const text = buildAgentNodeCatalogText();
    expect(text).toContain('## Image › Math\n');
    expect(text).toContain('## Clip effects › Keying\n');
    expect(text.indexOf('## Image › Inputs')).toBeLessThan(text.indexOf('## Image › Math'));
  });
});
