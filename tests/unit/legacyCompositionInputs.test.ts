import { describe, expect, it } from 'vitest';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { createLegacyAlphaGlowGraph } from '../../src/services/operators/legacyAlphaGlowGraph';
import { expandOperatorCompositions } from '../../src/services/operators/operatorComposition';
import { matchesEffectRecipe } from '../../src/services/operators/effectFamilyPresentation';
import { upgradeGlowGraph } from '../../src/services/operators/glowGraphUpgrade';
import { createRingGlowGraph } from '../../src/services/operators/glowEffectGraph';

const BRIGHT_PASS = ['sample-luma', 'sample-bright', 'bright-sample'];

/** The form a Glow graph was saved in while Bright Pass was extracted from the alpha-aware
 * recipe: one packed instance whose ports are named after the external source endpoints. */
function savedAlphaEraGraph(): EffectOperatorGraph {
  const graph = structuredClone(createLegacyAlphaGlowGraph());
  const members = new Set(BRIGHT_PASS);
  // Saved instances keep their leaf identities (recognizeOperatorCompositions stores nodeIds).
  const instance = { id: 'bright-pass', operator: 'color.soft-bright-pass', operatorVersion: 1, bindings: {},
    composition: { nodeIds: Object.fromEntries(BRIGHT_PASS.map(id => [id, id])), layout: {} } };
  graph.edges = graph.edges.filter(edge => !(members.has(edge.from) && members.has(edge.to))).map(edge => {
    if (members.has(edge.to)) return { ...edge, to: instance.id, input: `${edge.from}-${edge.output}` };
    if (members.has(edge.from)) return { ...edge, from: instance.id, output: `${edge.from}-${edge.output}` };
    return edge;
  });
  // One saved edge per exposed input port.
  graph.edges = graph.edges.filter((edge, index, edges) => edge.to !== instance.id
    || edges.findIndex(other => other.to === instance.id && other.input === edge.input) === index);
  graph.nodes = [...graph.nodes.filter(node => !members.has(node.id)), instance];
  graph.layout = { ...graph.layout, [instance.id]: { x: 0, y: 0 } };
  for (const id of members) delete graph.layout[id];
  return graph;
}

// Production: Qualle project failed to open with "Unknown composition input: sample-energy-value".
describe('legacy composition input ports', () => {
  it('expands a saved alpha-era Bright Pass instance into the original wiring', () => {
    const saved = savedAlphaEraGraph();
    expect(saved.edges.some(edge => edge.input === 'sample-energy-value')).toBe(true);
    const expanded = expandOperatorCompositions(saved);
    const into = (nodeSuffix: string, port: string) => expanded.edges.filter(edge => edge.to.endsWith(nodeSuffix) && edge.input === port)
      .map(edge => `${edge.from}:${edge.output}`);
    // The alpha-weighted energy feeds the multiply; the raw sample only feeds luminance.
    expect(into('bright-sample', 'a')).toEqual(['sample-energy:value']);
    expect(into('sample-luma', 'image')).toEqual(['sample:image']);
    expect(matchesEffectRecipe(saved, createLegacyAlphaGlowGraph())).toBe(true);
  });

  it('upgrades the untouched saved alpha-era Glow to the current recipe', () => {
    expect(upgradeGlowGraph(savedAlphaEraGraph())).toEqual(createRingGlowGraph());
  });

  it('answers "not this recipe" instead of throwing for graphs that cannot expand', () => {
    const broken = savedAlphaEraGraph();
    broken.edges.push({ id: 'stale', from: 'sample', output: 'image', to: 'bright-pass', input: 'no-such-port' });
    expect(matchesEffectRecipe(broken, createLegacyAlphaGlowGraph())).toBe(false);
    expect(() => expandOperatorCompositions(broken)).toThrow(/Unknown composition input: no-such-port/);
  });
});
