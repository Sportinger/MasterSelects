import { useCallback, useEffect, useRef } from 'react';
import { engine } from '../../engine/WebGPUEngine';
import { Logger } from '../../services/logger';
import { useMediaStore } from '../../stores/mediaStore';
import { useSAM2Store, maskToImageData } from '../../stores/sam2Store';
import { useTimelineStore } from '../../stores/timeline';
import { applyClipDragPreview } from '../../stores/timeline/clipDragPreview';
import type { ClipMask, MaskVertex } from '../../types/masks';
import { generateMaskTexture } from '../../utils/maskRenderer';

const log = Logger.create('Engine');
const MASK_TEXTURE_DRAG_THROTTLE_MS = 80;
const MASK_TEXTURE_DRAG_MAX_EDGE = 640;

function getMaskShapeHash(masks: ClipMask[]): string {
  return masks.map(m =>
    `${m.enabled !== false}|${m.inverted}|${m.closed}|${m.mode}|` +
    `${m.vertices.map((v: MaskVertex) => [
      v.x.toFixed(4),
      v.y.toFixed(4),
      v.handleIn.x.toFixed(4),
      v.handleIn.y.toFixed(4),
      v.handleOut.x.toFixed(4),
      v.handleOut.y.toFixed(4),
    ].join(',')).join(';')}|` +
    `${m.position.x.toFixed(4)},${m.position.y.toFixed(4)}|` +
    `${(m.feather || 0).toFixed(2)}|${m.featherQuality ?? 50}`
  ).join('||');
}

interface MaskRenderOptions {
  cacheSuffix?: string;
  featherScale?: number;
  maxFeatherQualityScale?: number;
}

export function useEngineMaskTextureSync(isEngineReady: boolean): (
  force?: boolean,
  timelineTime?: number,
) => void {
  const maskVersionRef = useRef<Map<string, string>>(new Map());

  const processClipMask = useCallback((
    clip: { id: string; masks?: ClipMask[] },
    engineDimensions: { width: number; height: number },
    options: MaskRenderOptions = {},
  ): boolean => {
    const sam2State = useSAM2Store.getState();
    if (sam2State.isActive && sam2State.currentClipId === clip.id && sam2State.liveMask) {
      const mask = sam2State.liveMask;
      const maskImageData = maskToImageData(mask.maskData, mask.width, mask.height, sam2State.inverted);
      const cacheKey = clip.id;
      const sam2Version = `sam2_${mask.maskData.length}_${sam2State.inverted}_${engineDimensions.width}x${engineDimensions.height}`;
      if (maskVersionRef.current.get(cacheKey) !== sam2Version) {
        maskVersionRef.current.set(cacheKey, sam2Version);
        engine.updateMaskTexture(clip.id, maskImageData);
        return true;
      }
      return false;
    }

    if (clip.masks && clip.masks.length > 0) {
      const maskVersion = `${getMaskShapeHash(clip.masks)}_${engineDimensions.width}x${engineDimensions.height}_${options.cacheSuffix ?? 'full'}`;
      const cacheKey = clip.id;
      const prevVersion = maskVersionRef.current.get(cacheKey);

      if (maskVersion !== prevVersion) {
        maskVersionRef.current.set(cacheKey, maskVersion);

        const maskImageData = generateMaskTexture(
          clip.masks,
          engineDimensions.width,
          engineDimensions.height,
          {
            featherScale: options.featherScale,
            maxFeatherQualityScale: options.maxFeatherQualityScale,
          },
        );

        if (maskImageData) {
          log.debug(`Generated mask texture for clip ${clip.id}: ${engineDimensions.width}x${engineDimensions.height}, masks: ${clip.masks.length}`);
          engine.updateMaskTexture(clip.id, maskImageData);
        } else {
          engine.removeMaskTexture(clip.id);
        }
        return true;
      }
    } else if (clip.id) {
      const cacheKey = clip.id;
      if (maskVersionRef.current.has(cacheKey)) {
        maskVersionRef.current.delete(cacheKey);
        engine.removeMaskTexture(clip.id);
        return true;
      }
    }
    return false;
  }, []);

  const lastMaskTextureUpdate = useRef(0);

  const updateMaskTextures = useCallback((force = false, timelineTime?: number) => {
    const { clips: storeClips, playheadPosition, maskDragging, clipDragPreview, getInterpolatedMasks } = useTimelineStore.getState();
    const clips = applyClipDragPreview(storeClips, clipDragPreview);
    const effectivePlayheadPosition = timelineTime ?? playheadPosition;

    if (maskDragging && !force) {
      const now = performance.now();
      if (now - lastMaskTextureUpdate.current < MASK_TEXTURE_DRAG_THROTTLE_MS) {
        return;
      }
      lastMaskTextureUpdate.current = now;
    }

    const engineDimensions = engine.getOutputDimensions();
    const dragScale = maskDragging
      ? Math.min(1, MASK_TEXTURE_DRAG_MAX_EDGE / Math.max(engineDimensions.width, engineDimensions.height))
      : 1;
    const maskDimensions = dragScale < 1
      ? {
          width: Math.max(1, Math.round(engineDimensions.width * dragScale)),
          height: Math.max(1, Math.round(engineDimensions.height * dragScale)),
        }
      : engineDimensions;
    const renderOptions = maskDragging
      ? {
          cacheSuffix: `drag_${maskDimensions.width}x${maskDimensions.height}`,
          featherScale: dragScale,
          maxFeatherQualityScale: 0.5,
        }
      : undefined;

    const clipsAtTime = clips.filter(c =>
      effectivePlayheadPosition >= c.startTime && effectivePlayheadPosition < c.startTime + c.duration
    );

    let changed = false;
    for (const clip of clipsAtTime) {
      const clipLocalTime = effectivePlayheadPosition - clip.startTime;
      const masks = getInterpolatedMasks(clip.id, clipLocalTime);
      changed = processClipMask({ id: clip.id, masks }, maskDimensions, renderOptions) || changed;

      if (clip.nestedClips && clip.nestedClips.length > 0) {
        const clipTime = clipLocalTime;
        for (const nestedClip of clip.nestedClips) {
          if (clipTime >= nestedClip.startTime && clipTime < nestedClip.startTime + nestedClip.duration) {
            const nestedClipLocalTime = clipTime - nestedClip.startTime;
            const nestedMasks = getInterpolatedMasks(nestedClip.id, nestedClipLocalTime);
            changed = processClipMask({ id: nestedClip.id, masks: nestedMasks }, maskDimensions, renderOptions) || changed;
          }
        }
      }
    }
    if (changed) {
      engine.requestRender();
    }
  }, [processClipMask]);

  useEffect(() => {
    if (!isEngineReady) return;

    updateMaskTextures();

    const unsubscribeClips = useTimelineStore.subscribe(
      (state) => state.clips,
      () => updateMaskTextures()
    );

    const unsubscribeTracks = useTimelineStore.subscribe(
      (state) => state.tracks,
      () => updateMaskTextures()
    );

    const unsubscribeKeyframes = useTimelineStore.subscribe(
      (state) => state.clipKeyframes,
      () => updateMaskTextures()
    );

    const unsubscribeComp = useMediaStore.subscribe(
      (state) => state.activeCompositionId,
      () => {
        maskVersionRef.current.clear();
        updateMaskTextures();
      }
    );

    let wasDragging = false;
    const unsubscribeDragging = useTimelineStore.subscribe(
      (state) => state.maskDragging,
      (maskDragging) => {
        if (wasDragging && !maskDragging) {
          const { activeMaskId, clips } = useTimelineStore.getState();
          if (activeMaskId) {
            const activeClip = clips.find(c => c.masks?.some(m => m.id === activeMaskId));
            if (activeClip) {
              maskVersionRef.current.delete(activeClip.id);
            }
          }
          updateMaskTextures(true);
        }
        wasDragging = maskDragging;
      }
    );

    const unsubscribeSAM2 = useSAM2Store.subscribe(
      (state) => state.liveMask,
      () => {
        const clipId = useSAM2Store.getState().currentClipId;
        if (clipId) maskVersionRef.current.delete(clipId);
        updateMaskTextures();
      }
    );

    return () => {
      unsubscribeClips();
      unsubscribeTracks();
      unsubscribeKeyframes();
      unsubscribeComp();
      unsubscribeDragging();
      unsubscribeSAM2();
    };
  }, [isEngineReady, updateMaskTextures]);

  return updateMaskTextures;
}
