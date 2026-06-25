import {
  createMaskEdgeFeatherProperty,
  parseMaskProperty,
} from '../../types/animationProperties';
import { createMaskEdgeId } from '../../utils/maskEdgeFeathers';

type RuntimeMaskEdgeSource = {
  id: string;
  edgeFeathers?: Record<string, number>;
  vertices?: readonly { id?: string }[];
};

type ProjectMaskEdgeSource = {
  id: string;
  edgeFeathers?: Record<string, number>;
  vertices?: readonly unknown[];
};

function runtimeEdgeToIndexEdge(edgeId: string, vertices: readonly { id?: string }[] | undefined): string | null {
  const [fromVertexId, toVertexId] = edgeId.split('->');
  const fromIndex = (vertices ?? []).findIndex(vertex => vertex.id === fromVertexId);
  const toIndex = (vertices ?? []).findIndex(vertex => vertex.id === toVertexId);
  return fromIndex >= 0 && toIndex >= 0 ? `${fromIndex}->${toIndex}` : null;
}

function indexEdgeToRuntimeEdge(edgeId: string, mask: ProjectMaskEdgeSource): string | null {
  const [fromIndexText, toIndexText] = edgeId.split('->');
  const fromIndex = Number(fromIndexText);
  const toIndex = Number(toIndexText);
  const vertices = mask.vertices ?? [];
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return null;
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= vertices.length || toIndex >= vertices.length) return null;
  return createMaskEdgeId(`${mask.id}-v-${fromIndex}`, `${mask.id}-v-${toIndex}`);
}

export function serializeMaskEdgeFeathers(mask: RuntimeMaskEdgeSource): Record<string, number> | undefined {
  if (!mask.edgeFeathers) return undefined;
  const entries = Object.entries(mask.edgeFeathers).flatMap(([edgeId, feather]) => {
    const indexEdge = runtimeEdgeToIndexEdge(edgeId, mask.vertices);
    return indexEdge && feather > 0 ? [[indexEdge, feather] as const] : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function hydrateMaskEdgeFeathers(mask: ProjectMaskEdgeSource): Record<string, number> | undefined {
  if (!mask.edgeFeathers) return undefined;
  const entries = Object.entries(mask.edgeFeathers).flatMap(([edgeId, feather]) => {
    const runtimeEdge = indexEdgeToRuntimeEdge(edgeId, mask);
    return runtimeEdge ? [[runtimeEdge, Math.max(0, feather)] as const] : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function serializeMaskKeyframeProperty(
  property: string,
  masks: readonly RuntimeMaskEdgeSource[] | undefined,
): string {
  const parsed = parseMaskProperty(property);
  if (parsed?.property !== 'edgeFeather') return property;
  const mask = masks?.find(candidate => candidate.id === parsed.maskId);
  const indexEdge = mask ? runtimeEdgeToIndexEdge(parsed.edgeId, mask.vertices) : null;
  return indexEdge ? createMaskEdgeFeatherProperty(parsed.maskId, indexEdge) : property;
}

export function hydrateMaskKeyframeProperty(
  property: string,
  masks: readonly ProjectMaskEdgeSource[] | undefined,
): string {
  const parsed = parseMaskProperty(property);
  if (parsed?.property !== 'edgeFeather') return property;
  const mask = masks?.find(candidate => candidate.id === parsed.maskId);
  const runtimeEdge = mask ? indexEdgeToRuntimeEdge(parsed.edgeId, mask) : null;
  return runtimeEdge ? createMaskEdgeFeatherProperty(parsed.maskId, runtimeEdge) : property;
}
