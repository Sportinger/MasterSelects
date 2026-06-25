import { useTimelineStore } from '../../../stores/timeline';
import type { ToolResult } from '../types';
import { selectClipAndOpenTab } from '../aiFeedback';
import { createMaskPathProperty } from '../../../types';
import type { ClipMask, MaskPathKeyframeValue, MaskVertex, MaskVertexHandleMode } from '../../../types';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

interface VertexInput {
  x: number;
  y: number;
  handleIn?: { x: number; y: number };
  handleOut?: { x: number; y: number };
  handleMode?: 'none' | 'mirrored' | 'split';
}

interface MaskPathVertexInput extends VertexInput {
  id?: string;
}

export async function handleGetMasks(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const masks = clip.masks || [];
  return {
    success: true,
    data: {
      clipId,
      masks: masks.map(m => ({
        id: m.id,
        name: m.name,
        closed: m.closed,
        opacity: m.opacity,
        feather: m.feather,
        edgeFeathers: m.edgeFeathers,
        featherQuality: m.featherQuality,
        inverted: m.inverted,
        enabled: m.enabled !== false,
        mode: m.mode,
        visible: m.visible,
        position: m.position,
        vertices: m.vertices.map(v => ({
          id: v.id,
          x: v.x,
          y: v.y,
          handleIn: v.handleIn,
          handleOut: v.handleOut,
          handleMode: v.handleMode,
        })),
      })),
    },
  };
}

export async function handleAddRectangleMask(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const { addRectangleMask } = useTimelineStore.getState();
  const maskId = addRectangleMask(clipId);

  // Visual feedback: select clip and open masks tab
  selectClipAndOpenTab(clipId, 'masks');

  return {
    success: true,
    data: { clipId, maskId, type: 'rectangle' },
  };
}

export async function handleAddEllipseMask(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const { addEllipseMask } = useTimelineStore.getState();
  const maskId = addEllipseMask(clipId);

  // Visual feedback: select clip and open masks tab
  selectClipAndOpenTab(clipId, 'masks');

  return {
    success: true,
    data: { clipId, maskId, type: 'ellipse' },
  };
}

export async function handleAddMask(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const vertices = (args.vertices as VertexInput[] | undefined) || [];
  const maskData: Record<string, unknown> = {
    name: args.name as string | undefined,
    closed: args.closed ?? true,
    feather: args.feather as number | undefined,
    opacity: args.opacity as number | undefined,
    inverted: args.inverted as boolean | undefined,
    enabled: args.enabled as boolean | undefined,
    visible: args.visible as boolean | undefined,
    mode: args.mode as string | undefined,
  };

  // Clean undefined values
  for (const key of Object.keys(maskData)) {
    if (maskData[key] === undefined) delete maskData[key];
  }

  const { addMask, invalidateCache } = useTimelineStore.getState();
  const maskId = addMask(clipId, maskData as never);

  // Add vertices if provided
  if (vertices.length > 0) {
    const { addVertex } = useTimelineStore.getState();
    for (const v of vertices) {
      addVertex(clipId, maskId, {
        x: v.x,
        y: v.y,
        handleIn: v.handleIn || { x: 0, y: 0 },
        handleOut: v.handleOut || { x: 0, y: 0 },
        handleMode: v.handleMode,
      });
    }
    // Close the mask if requested
    if (args.closed !== false) {
      const { closeMask } = useTimelineStore.getState();
      closeMask(clipId, maskId);
    }
    invalidateCache();
  }

  // Visual feedback: select clip and open masks tab
  selectClipAndOpenTab(clipId, 'masks');

  return {
    success: true,
    data: { clipId, maskId, vertexCount: vertices.length },
  };
}

export async function handleRemoveMask(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const maskId = args.maskId as string;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const mask = (clip.masks || []).find(m => m.id === maskId);
  if (!mask) return { success: false, error: `Mask not found: ${maskId}` };

  const { removeMask } = useTimelineStore.getState();
  removeMask(clipId, maskId);

  // Visual feedback: select clip and open masks tab
  selectClipAndOpenTab(clipId, 'masks');

  return {
    success: true,
    data: { clipId, removedMaskId: maskId },
  };
}

export async function handleUpdateMask(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const maskId = args.maskId as string;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const mask = (clip.masks || []).find(m => m.id === maskId);
  if (!mask) return { success: false, error: `Mask not found: ${maskId}` };

  const updates: Record<string, unknown> = {};
  if (args.name !== undefined) updates.name = args.name;
  if (args.feather !== undefined) updates.feather = args.feather;
  if (args.featherQuality !== undefined) updates.featherQuality = args.featherQuality;
  if (args.opacity !== undefined) updates.opacity = args.opacity;
  if (args.inverted !== undefined) updates.inverted = args.inverted;
  if (args.enabled !== undefined) updates.enabled = args.enabled;
  if (args.mode !== undefined) updates.mode = args.mode;
  if (args.visible !== undefined) updates.visible = args.visible;
  if (args.closed !== undefined) updates.closed = args.closed;
  if (args.positionX !== undefined || args.positionY !== undefined) {
    const currentPos = mask.position || { x: 0, y: 0 };
    updates.position = {
      x: args.positionX !== undefined ? args.positionX as number : currentPos.x,
      y: args.positionY !== undefined ? args.positionY as number : currentPos.y,
    };
  }

  if (Object.keys(updates).length === 0) {
    return { success: false, error: 'No mask properties provided' };
  }

  const { updateMask } = useTimelineStore.getState();
  updateMask(clipId, maskId, updates as never);

  return {
    success: true,
    data: { clipId, maskId, updatedProperties: Object.keys(updates) },
  };
}

export async function handleAddVertex(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const maskId = args.maskId as string;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const mask = (clip.masks || []).find(m => m.id === maskId);
  if (!mask) return { success: false, error: `Mask not found: ${maskId}` };

  const { addVertex } = useTimelineStore.getState();
  const vertexId = addVertex(clipId, maskId, {
    x: args.x as number,
    y: args.y as number,
    handleIn: { x: (args.handleInX as number) || 0, y: (args.handleInY as number) || 0 },
    handleOut: { x: (args.handleOutX as number) || 0, y: (args.handleOutY as number) || 0 },
    handleMode: args.handleMode as 'none' | 'mirrored' | 'split' | undefined,
  }, args.index as number | undefined);

  return {
    success: true,
    data: { clipId, maskId, vertexId, x: args.x, y: args.y },
  };
}

export async function handleRemoveVertex(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const maskId = args.maskId as string;
  const vertexId = args.vertexId as string;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const mask = (clip.masks || []).find(m => m.id === maskId);
  if (!mask) return { success: false, error: `Mask not found: ${maskId}` };

  const vertex = mask.vertices.find(v => v.id === vertexId);
  if (!vertex) return { success: false, error: `Vertex not found: ${vertexId}` };

  const { removeVertex } = useTimelineStore.getState();
  removeVertex(clipId, maskId, vertexId);

  return {
    success: true,
    data: { clipId, maskId, removedVertexId: vertexId },
  };
}

export async function handleUpdateVertex(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const maskId = args.maskId as string;
  const vertexId = args.vertexId as string;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const mask = (clip.masks || []).find(m => m.id === maskId);
  if (!mask) return { success: false, error: `Mask not found: ${maskId}` };

  const vertex = mask.vertices.find(v => v.id === vertexId);
  if (!vertex) return { success: false, error: `Vertex not found: ${vertexId}` };

  const updates: Record<string, unknown> = {};
  if (args.x !== undefined) updates.x = args.x;
  if (args.y !== undefined) updates.y = args.y;
  if (args.handleInX !== undefined || args.handleInY !== undefined) {
    updates.handleIn = {
      x: args.handleInX !== undefined ? args.handleInX as number : vertex.handleIn.x,
      y: args.handleInY !== undefined ? args.handleInY as number : vertex.handleIn.y,
    };
  }
  if (args.handleOutX !== undefined || args.handleOutY !== undefined) {
    updates.handleOut = {
      x: args.handleOutX !== undefined ? args.handleOutX as number : vertex.handleOut.x,
      y: args.handleOutY !== undefined ? args.handleOutY as number : vertex.handleOut.y,
    };
  }
  if (args.handleMode !== undefined) updates.handleMode = args.handleMode;

  if (Object.keys(updates).length === 0) {
    return { success: false, error: 'No vertex properties provided' };
  }

  const { updateVertex } = useTimelineStore.getState();
  updateVertex(clipId, maskId, vertexId, updates as never);

  return {
    success: true,
    data: { clipId, maskId, vertexId, updatedProperties: Object.keys(updates) },
  };
}

export async function handleAddMaskPathKeyframe(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const maskId = args.maskId as string;
  const time = typeof args.time === 'number' ? args.time : undefined;
  const easing = typeof args.easing === 'string' ? args.easing : undefined;
  const property = createMaskPathProperty(maskId);
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const mask = (clip.masks || []).find(m => m.id === maskId);
  if (!mask) return { success: false, error: `Mask not found: ${maskId}` };

  const pathValue = normalizeMaskPathValue(args.pathValue, mask);
  const { addMaskPathKeyframe, invalidateCache } = useTimelineStore.getState();
  addMaskPathKeyframe(clipId, maskId, pathValue, time, easing);
  invalidateCache();

  const keyframes = useTimelineStore.getState().getClipKeyframes(clipId)
    .filter((keyframe) => keyframe.property === property);
  const targetTime = typeof time === 'number'
    ? Math.max(0, Math.min(time, clip.duration))
    : undefined;
  const newKeyframe = typeof targetTime === 'number'
    ? keyframes.find((keyframe) => keyframe.time === targetTime) ?? keyframes[keyframes.length - 1]
    : keyframes[keyframes.length - 1];

  selectClipAndOpenTab(clipId, 'masks');

  return {
    success: true,
    data: {
      clipId,
      maskId,
      keyframeId: newKeyframe?.id,
      property,
      time: newKeyframe?.time ?? time,
      vertexCount: newKeyframe?.pathValue?.vertices.length ?? pathValue?.vertices.length ?? mask.vertices.length,
      pathValue: newKeyframe?.pathValue ?? pathValue,
    },
  };
}

function normalizeMaskPathValue(value: unknown, mask: ClipMask): MaskPathKeyframeValue | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const verticesInput = Array.isArray(record.vertices) ? record.vertices : null;
  if (!verticesInput) {
    return undefined;
  }

  const currentVerticesById = new Map(mask.vertices.map((vertex) => [vertex.id, vertex]));
  const vertices = verticesInput.map((vertexInput, index) => {
    const vertex = vertexInput as MaskPathVertexInput;
    const fallback = vertex.id ? currentVerticesById.get(vertex.id) : mask.vertices[index];
    const normalizedVertex: MaskVertex = {
      id: typeof vertex.id === 'string' ? vertex.id : fallback?.id ?? `vertex-path-${index}`,
      x: typeof vertex.x === 'number' ? vertex.x : fallback?.x ?? 0,
      y: typeof vertex.y === 'number' ? vertex.y : fallback?.y ?? 0,
      handleIn: normalizeHandle(vertex.handleIn, fallback?.handleIn),
      handleOut: normalizeHandle(vertex.handleOut, fallback?.handleOut),
      handleMode: (vertex.handleMode ?? fallback?.handleMode ?? 'none') as MaskVertexHandleMode,
    };
    return normalizedVertex;
  });

  return {
    closed: typeof record.closed === 'boolean' ? record.closed : mask.closed,
    vertices,
  };
}

function normalizeHandle(
  value: { x: number; y: number } | undefined,
  fallback: { x: number; y: number } | undefined
): { x: number; y: number } {
  return {
    x: typeof value?.x === 'number' ? value.x : fallback?.x ?? 0,
    y: typeof value?.y === 'number' ? value.y : fallback?.y ?? 0,
  };
}
