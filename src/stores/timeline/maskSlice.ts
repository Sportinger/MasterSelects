// Mask-related actions slice

import type { MaskActions, SliceCreator, ClipMask, MaskVertex, MaskEditMode, Keyframe, ClipboardClipMaskData } from './types';
import { createMaskEdgeFeatherProperty, createMaskNumericProperty, createMaskPathProperty, parseMaskProperty } from '../../types';
import { createMaskEdgeId, setMaskEdgeFeatherValue } from '../../utils/maskEdgeFeathers';
import { getMaskVerticesHandleModeUpdates, inferMaskVertexHandleMode } from '../../utils/maskVertexHandles';
import { captureSnapshot } from '../historyStore';

const DEFAULT_MASK_OUTLINE_COLORS = ['#2997E5', '#ff9900', '#7ddc7a', '#d16bff', '#ff5f6d', '#f8d34f'];

function randomSuffix(): string {
  return Math.random().toString(36).substr(2, 5);
}

function createMaskId(): string {
  return `mask-${Date.now()}-${randomSuffix()}`;
}

function createVertexId(): string {
  return `vertex-${Date.now()}-${randomSuffix()}`;
}

function remapMaskForPaste(clipboardMask: ClipboardClipMaskData, clipId: string, duration: number): { mask: ClipMask; keyframes: Keyframe[] } {
  const nextMaskId = createMaskId();
  const vertexIdMap = new Map<string, string>();
  const mapVertexId = (id: string) => {
    const existing = vertexIdMap.get(id);
    if (existing) return existing;
    const next = createVertexId();
    vertexIdMap.set(id, next);
    return next;
  };
  const cloneVertex = (vertex: MaskVertex): MaskVertex => ({
    ...vertex,
    id: mapVertexId(vertex.id),
    handleIn: { ...vertex.handleIn },
    handleOut: { ...vertex.handleOut },
  });
  const mask: ClipMask = {
    ...structuredClone(clipboardMask.mask),
    id: nextMaskId,
    vertices: clipboardMask.mask.vertices.map(cloneVertex),
    edgeFeathers: clipboardMask.mask.edgeFeathers
      ? Object.fromEntries(
          Object.entries(clipboardMask.mask.edgeFeathers).map(([edgeId, feather]) => {
            const [fromId, toId] = edgeId.split('->');
            return [
              fromId && toId ? createMaskEdgeId(mapVertexId(fromId), mapVertexId(toId)) : edgeId,
              feather,
            ];
          }),
        )
      : undefined,
    expanded: true,
  };
  const keyframes = clipboardMask.keyframes.flatMap((keyframe): Keyframe[] => {
    const parsed = parseMaskProperty(keyframe.property);
    if (!parsed) return [];
    const property = parsed.property === 'path'
      ? createMaskPathProperty(nextMaskId)
      : parsed.property === 'edgeFeather'
        ? createMaskEdgeFeatherProperty(
            nextMaskId,
            (() => {
              const [fromId, toId] = parsed.edgeId.split('->');
              return fromId && toId ? createMaskEdgeId(mapVertexId(fromId), mapVertexId(toId)) : parsed.edgeId;
            })(),
          )
        : createMaskNumericProperty(nextMaskId, parsed.property);
    return [{
      ...structuredClone(keyframe),
      id: `kf_${Date.now()}_${randomSuffix()}`,
      clipId,
      time: Math.max(0, Math.min(duration, keyframe.time)),
      property,
      pathValue: keyframe.pathValue
        ? {
            closed: keyframe.pathValue.closed,
            vertices: keyframe.pathValue.vertices.map(cloneVertex),
          }
        : undefined,
    }];
  });

  return { mask, keyframes };
}

export const createMaskSlice: SliceCreator<MaskActions> = (set, get) => ({
  setMaskEditMode: (mode: MaskEditMode) => {
    set({ maskEditMode: mode, maskDrawStart: null });
    if (mode === 'none') {
      set({ activeMaskId: null, selectedVertexIds: new Set(), selectedMaskEdgeId: null });
    }
  },

  setMaskPanelActive: (active: boolean) => {
    set({ maskPanelActive: active });
  },

  setMaskDragging: (dragging: boolean) => {
    set({ maskDragging: dragging });
  },

  setMaskDrawStart: (point) => {
    set({ maskDrawStart: point });
  },

  setActiveMask: (clipId, maskId) => {
    set({ activeMaskId: maskId, selectedVertexIds: new Set(), selectedMaskEdgeId: null });
    if (clipId && maskId) {
      set({ maskEditMode: 'editing' });
    }
  },

  selectVertex: (vertexId, addToSelection = false) => {
    const { selectedVertexIds } = get();
    if (addToSelection) {
      const newSet = new Set(selectedVertexIds);
      if (newSet.has(vertexId)) {
        newSet.delete(vertexId);
      } else {
        newSet.add(vertexId);
      }
      set({ selectedVertexIds: newSet, selectedMaskEdgeId: null });
    } else {
      set({ selectedVertexIds: new Set([vertexId]), selectedMaskEdgeId: null });
    }
  },

  selectVertices: (vertexIds) => {
    set({ selectedVertexIds: new Set(vertexIds), selectedMaskEdgeId: null });
  },

  selectMaskEdge: (edgeId) => {
    set({ selectedMaskEdgeId: edgeId, selectedVertexIds: new Set() });
  },

  deselectAllVertices: () => {
    set({ selectedVertexIds: new Set(), selectedMaskEdgeId: null });
  },

  showMaskFeatherPreview: (maskId, edgeId = null) => {
    set({ maskFeatherPreview: { maskId, edgeId, changedAt: performance.now() } });
  },

  // Mask CRUD
  addMask: (clipId, maskData) => {
    const { clips, invalidateCache } = get();
    const maskId = `mask-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

    const existingMasks = clips.find(c => c.id === clipId)?.masks || [];
    const maskCount = existingMasks.length + 1;

    const newMask: ClipMask = {
      id: maskId,
      name: maskData?.name || `Mask ${maskCount}`,
      vertices: maskData?.vertices || [],
      closed: maskData?.closed ?? false,
      opacity: maskData?.opacity ?? 1,
      feather: maskData?.feather ?? 0,
      featherQuality: maskData?.featherQuality ?? 50, // 1-100 (1-33=low, 34-66=medium, 67-100=high)
      inverted: maskData?.inverted ?? false,
      mode: maskData?.mode ?? 'add',
      expanded: maskData?.expanded ?? true,
      position: maskData?.position ?? { x: 0, y: 0 },
      enabled: maskData?.enabled ?? true,
      visible: maskData?.visible ?? true,
      outlineColor: maskData?.outlineColor ?? DEFAULT_MASK_OUTLINE_COLORS[(maskCount - 1) % DEFAULT_MASK_OUTLINE_COLORS.length],
    };

    set({
      clips: clips.map(c =>
        c.id === clipId
          ? { ...c, masks: [...(c.masks || []), newMask] }
          : c
      ),
    });

    invalidateCache();
    return maskId;
  },

  removeMask: (clipId, maskId) => {
    const { clips, activeMaskId, clipKeyframes, keyframeRecordingEnabled, selectedKeyframeIds, invalidateCache } = get();
    const keyframes = clipKeyframes.get(clipId) || [];
    const removedKeyframeIds = new Set<string>();
    const retainedKeyframes = keyframes.filter(keyframe => {
      if (parseMaskProperty(keyframe.property)?.maskId !== maskId) return true;
      removedKeyframeIds.add(keyframe.id);
      return false;
    });
    const nextClipKeyframes = removedKeyframeIds.size > 0 ? new Map(clipKeyframes) : clipKeyframes;
    if (removedKeyframeIds.size > 0) {
      if (retainedKeyframes.length > 0) {
        nextClipKeyframes.set(clipId, retainedKeyframes);
      } else {
        nextClipKeyframes.delete(clipId);
      }
    }
    const recordingPrefix = `${clipId}:mask.${maskId}.`;

    set({
      clips: clips.map(c =>
        c.id === clipId
          ? { ...c, masks: (c.masks || []).filter(m => m.id !== maskId) }
          : c
      ),
      clipKeyframes: nextClipKeyframes,
      keyframeRecordingEnabled: new Set(
        [...keyframeRecordingEnabled].filter(key => !key.startsWith(recordingPrefix))
      ),
      selectedKeyframeIds: new Set(
        [...selectedKeyframeIds].filter(keyframeId => !removedKeyframeIds.has(keyframeId))
      ),
      activeMaskId: activeMaskId === maskId ? null : activeMaskId,
      selectedMaskEdgeId: activeMaskId === maskId ? null : get().selectedMaskEdgeId,
    });

    invalidateCache();
  },

  updateMask: (clipId, maskId, updates) => {
    const { clips, invalidateCache, maskDragging } = get();

    set({
      clips: clips.map(c =>
        c.id === clipId
          ? {
              ...c,
              masks: (c.masks || []).map(m =>
                m.id === maskId ? { ...m, ...updates } : m
              ),
            }
          : c
      ),
    });

    if (!maskDragging) {
      invalidateCache();
    }
  },

  setMaskEdgeFeather: (clipId, maskId, edgeId, feather) => {
    const { clips, invalidateCache, showMaskFeatherPreview } = get();
    set({
      clips: clips.map(c =>
        c.id === clipId
          ? {
              ...c,
              masks: (c.masks || []).map(mask =>
                mask.id === maskId
                  ? {
                      ...mask,
                      edgeFeathers: setMaskEdgeFeatherValue(mask.edgeFeathers, edgeId, feather),
                    }
                  : mask
              ),
            }
          : c
      ),
    });
    showMaskFeatherPreview(maskId, edgeId);
    invalidateCache();
  },

  reorderMasks: (clipId, fromIndex, toIndex) => {
    const { clips, invalidateCache } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip?.masks) return;

    const masks = [...clip.masks];
    const [removed] = masks.splice(fromIndex, 1);
    masks.splice(toIndex, 0, removed);

    set({
      clips: clips.map(c =>
        c.id === clipId ? { ...c, masks } : c
      ),
    });

    invalidateCache();
  },

  getClipMasks: (clipId) => {
    const { clips } = get();
    return clips.find(c => c.id === clipId)?.masks || [];
  },

  // Vertex CRUD
  addVertex: (clipId, maskId, vertexData, index) => {
    const { clips, invalidateCache } = get();
    const vertexId = `vertex-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

    const newVertex: MaskVertex = {
      id: vertexId,
      x: vertexData.x,
      y: vertexData.y,
      handleIn: vertexData.handleIn || { x: 0, y: 0 },
      handleOut: vertexData.handleOut || { x: 0, y: 0 },
      handleMode: vertexData.handleMode ?? inferMaskVertexHandleMode({
        id: vertexId,
        x: vertexData.x,
        y: vertexData.y,
        handleIn: vertexData.handleIn || { x: 0, y: 0 },
        handleOut: vertexData.handleOut || { x: 0, y: 0 },
      }),
    };

    set({
      clips: clips.map(c => {
        if (c.id !== clipId) return c;
        return {
          ...c,
          masks: (c.masks || []).map(m => {
            if (m.id !== maskId) return m;
            const vertices = [...m.vertices];
            if (index !== undefined) {
              vertices.splice(index, 0, newVertex);
            } else {
              vertices.push(newVertex);
            }
            return { ...m, vertices };
          }),
        };
      }),
    });

    get().recordMaskPathKeyframe(clipId, maskId);
    invalidateCache();
    return vertexId;
  },

  removeVertex: (clipId, maskId, vertexId) => {
    const { clips, selectedVertexIds, invalidateCache } = get();

    set({
      clips: clips.map(c => {
        if (c.id !== clipId) return c;
        return {
          ...c,
          masks: (c.masks || []).map(m => {
            if (m.id !== maskId) return m;
            return {
              ...m,
              vertices: m.vertices.filter(v => v.id !== vertexId),
            };
          }),
        };
      }),
      selectedVertexIds: new Set(
        Array.from(selectedVertexIds).filter(id => id !== vertexId)
      ),
      selectedMaskEdgeId: null,
    });

    get().recordMaskPathKeyframe(clipId, maskId);
    invalidateCache();
  },

  updateVertex: (clipId, maskId, vertexId, updates, skipCacheInvalidation = false) => {
    const { clips, invalidateCache } = get();

    set({
      clips: clips.map(c => {
        if (c.id !== clipId) return c;
        return {
          ...c,
          masks: (c.masks || []).map(m => {
            if (m.id !== maskId) return m;
            return {
              ...m,
              vertices: m.vertices.map(v =>
                v.id === vertexId ? { ...v, ...updates } : v
              ),
            };
          }),
        };
      }),
    });

    // Skip cache invalidation during drag operations for performance
    // The caller should call invalidateCache() manually after drag ends
    if (!skipCacheInvalidation) {
      get().recordMaskPathKeyframe(clipId, maskId);
      invalidateCache();
    }
  },

  updateVertices: (clipId, maskId, vertexUpdates, skipCacheInvalidation = false) => {
    const { clips, invalidateCache } = get();
    const updatesById = new Map(vertexUpdates.map(({ id, updates }) => [id, updates]));

    set({
      clips: clips.map(c => {
        if (c.id !== clipId) return c;
        return {
          ...c,
          masks: (c.masks || []).map(m => {
            if (m.id !== maskId) return m;
            return {
              ...m,
              vertices: m.vertices.map(v => {
                const updates = updatesById.get(v.id);
                return updates ? { ...v, ...updates } : v;
              }),
            };
          }),
        };
      }),
    });

    if (!skipCacheInvalidation) {
      get().recordMaskPathKeyframe(clipId, maskId);
      invalidateCache();
    }
  },

  setVertexHandleMode: (clipId, maskId, vertexIds, mode) => {
    const { clips, updateVertices } = get();
    const clip = clips.find(c => c.id === clipId);
    const mask = clip?.masks?.find(m => m.id === maskId);
    if (!mask || vertexIds.length === 0) return;

    const vertexUpdates = getMaskVerticesHandleModeUpdates(mask.vertices, vertexIds, mode, mask.closed);
    if (vertexUpdates.length === 0) return;

    updateVertices(clipId, maskId, vertexUpdates);
  },

  closeMask: (clipId, maskId) => {
    const { updateMask } = get();
    updateMask(clipId, maskId, { closed: true });
    get().recordMaskPathKeyframe(clipId, maskId);
  },

  // Preset shapes
  addRectangleMask: (clipId) => {
    const { addMask, invalidateCache } = get();
    const maskId = addMask(clipId, { name: 'Rectangle Mask' });

    // Add rectangle vertices (normalized 0-1 coordinates)
    // Default rectangle covers 80% of the clip area, centered
    const margin = 0.1;
    const vertices: MaskVertex[] = [
      { id: `v-${Date.now()}-1`, x: margin, y: margin, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
      { id: `v-${Date.now()}-2`, x: 1 - margin, y: margin, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
      { id: `v-${Date.now()}-3`, x: 1 - margin, y: 1 - margin, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
      { id: `v-${Date.now()}-4`, x: margin, y: 1 - margin, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
    ];

    const currentClips = get().clips;
    set({
      clips: currentClips.map(c => {
        if (c.id !== clipId) return c;
        return {
          ...c,
          masks: (c.masks || []).map(m =>
            m.id === maskId ? { ...m, vertices, closed: true } : m
          ),
        };
      }),
    });

    invalidateCache();
    return maskId;
  },

  addEllipseMask: (clipId) => {
    const { addMask, invalidateCache } = get();
    const maskId = addMask(clipId, { name: 'Ellipse Mask' });

    // Create ellipse using bezier curves (approximation)
    // Control point offset for circular bezier (~0.5523)
    const k = 0.5523;
    const cx = 0.5;
    const cy = 0.5;
    const rx = 0.4;
    const ry = 0.4;

    const vertices: MaskVertex[] = [
      // Top
      {
        id: `v-${Date.now()}-1`,
        x: cx,
        y: cy - ry,
        handleIn: { x: -rx * k, y: 0 },
        handleOut: { x: rx * k, y: 0 },
        handleMode: 'mirrored',
      },
      // Right
      {
        id: `v-${Date.now()}-2`,
        x: cx + rx,
        y: cy,
        handleIn: { x: 0, y: -ry * k },
        handleOut: { x: 0, y: ry * k },
        handleMode: 'mirrored',
      },
      // Bottom
      {
        id: `v-${Date.now()}-3`,
        x: cx,
        y: cy + ry,
        handleIn: { x: rx * k, y: 0 },
        handleOut: { x: -rx * k, y: 0 },
        handleMode: 'mirrored',
      },
      // Left
      {
        id: `v-${Date.now()}-4`,
        x: cx - rx,
        y: cy,
        handleIn: { x: 0, y: ry * k },
        handleOut: { x: 0, y: -ry * k },
        handleMode: 'mirrored',
      },
    ];

    const currentClips = get().clips;
    set({
      clips: currentClips.map(c => {
        if (c.id !== clipId) return c;
        return {
          ...c,
          masks: (c.masks || []).map(m =>
            m.id === maskId ? { ...m, vertices, closed: true } : m
          ),
        };
      }),
    });

    invalidateCache();
    return maskId;
  },

  copyClipMask: (clipId, maskId) => {
    const { clips, clipKeyframes } = get();
    const clip = clips.find(c => c.id === clipId);
    const mask = clip?.masks?.find(m => m.id === maskId);
    if (!mask) return;

    const keyframes = (clipKeyframes.get(clipId) || [])
      .filter(keyframe => parseMaskProperty(keyframe.property)?.maskId === maskId)
      .map(keyframe => structuredClone(keyframe));

    set({
      clipboardMask: {
        sourceClipId: clipId,
        mask: structuredClone(mask),
        keyframes,
      },
    });
  },

  pasteClipMask: (targetClipIds) => {
    const { clipboardMask, selectedClipIds, clips, clipKeyframes, invalidateCache } = get();
    if (!clipboardMask) return;

    const targetIds = targetClipIds?.length ? targetClipIds : [...selectedClipIds];
    const targetIdSet = new Set(targetIds);
    const targetClips = clips.filter(clip => targetIdSet.has(clip.id));
    if (targetClips.length === 0) return;

    captureSnapshot(targetClips.length === 1 ? 'Paste mask' : 'Paste mask to clips');
    const nextKeyframes = new Map(clipKeyframes);
    let pastedMaskId: string | null = null;

    const nextClips = clips.map(clip => {
      if (!targetIdSet.has(clip.id)) return clip;
      const pasted = remapMaskForPaste(clipboardMask, clip.id, clip.duration);
      pastedMaskId ??= pasted.mask.id;

      const mergedKeyframes = [...(nextKeyframes.get(clip.id) || []), ...pasted.keyframes]
        .toSorted((a, b) => a.time - b.time);
      if (mergedKeyframes.length > 0) nextKeyframes.set(clip.id, mergedKeyframes);

      return {
        ...clip,
        masks: [...(clip.masks || []), pasted.mask],
      };
    });

    set({
      clips: nextClips,
      clipKeyframes: nextKeyframes,
      activeMaskId: targetClips.length === 1 ? pastedMaskId : get().activeMaskId,
      selectedVertexIds: new Set(),
      selectedMaskEdgeId: null,
    });
    invalidateCache();
  },

  hasClipboardMask: () => get().clipboardMask !== null,
});
