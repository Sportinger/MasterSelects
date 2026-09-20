import type { ClipMask } from '../../../types/masks';
import { createMaskEdgeFeatherProperty, parseMaskProperty } from '../../../types/animationProperties';

/** A pasted mask owns fresh mask/vertex identities. Node animation bindings must
 * reference those same identities, including both endpoints of feather edges.
 */
export function createPastedMasks(source: readonly ClipMask[] | undefined, createId: (kind: 'mask' | 'vertex') => string) {
  const ids = new Map<string, string>();
  const masks = source?.map(mask => {
    const id = createId('mask'); ids.set(mask.id, id);
    return { ...mask, id, vertices: mask.vertices.map(vertex => {
      const vertexId = createId('vertex'); ids.set(vertex.id, vertexId);
      return { ...vertex, id: vertexId };
    }) };
  });
  const remapProperty = (property: string): string => {
    const mask = parseMaskProperty(property);
    if (!mask) return property;
    const id = ids.get(mask.maskId) ?? mask.maskId;
    return mask.property === 'edgeFeather'
      ? createMaskEdgeFeatherProperty(id, mask.edgeId.split('->').map(vertex => ids.get(vertex) ?? vertex).join('->'))
      : `mask.${id}.${mask.property}`;
  };
  return { masks, remapProperty };
}
