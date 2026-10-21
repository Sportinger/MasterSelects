import type { BoundOperatorNode, EffectOperatorGraph } from '../../types/operatorGraph';
import { expandOperatorCompositions } from './operatorComposition';
import { literal, literalKey } from './effectFamilyPresentation';

const nodeText = (node: BoundOperatorNode) => JSON.stringify(Object.entries(node)
  .filter(([name]) => !['id', 'operatorVersion', 'composition'].includes(name))
  .toSorted(([a], [b]) => a.localeCompare(b)));

/** cyrb53: a fast 53-bit string hash, enough to tell recipe versions apart. */
function hash53(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761); h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/**
 * Presentation-free fingerprint of a graph, equal for graphs `matchesEffectRecipe` treats as the
 * same recipe (layout, folders, packed compositions and duplicated constants ignored). Lets an
 * upgrade recognize an untouched saved recipe from a short frozen constant instead of keeping a
 * full copy of a large retired recipe. Undefined when packed compositions no longer expand.
 */
export function effectRecipeFingerprint(graph: EffectOperatorGraph): string | undefined {
  let actual: EffectOperatorGraph;
  try { actual = expandOperatorCompositions(graph); } catch { return undefined; }
  const names = new Map(actual.nodes.map(node => [node.id, literal(node) ? literalKey(node) : node.id]));
  const nodes = actual.nodes.filter(node => !literal(node)).map(node => `${node.id}|${node.operatorVersion ?? 1}|${nodeText(node)}`).toSorted();
  const literals = [...new Set(actual.nodes.filter(literal).map(literalKey))].toSorted();
  const edges = actual.edges.map(edge => JSON.stringify([names.get(edge.from), edge.output, names.get(edge.to), edge.input])).toSorted();
  return `${actual.nodes.length > 0 ? hash53(JSON.stringify([nodes, literals, edges])) : 'empty'}`;
}
