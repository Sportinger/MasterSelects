// Clipboard-related actions slice for copy/paste functionality

import type { ClipboardActions, SliceCreator, ClipboardClipData, ClipboardKeyframeData, Keyframe } from './types';
import type { EasingType, AnimatableProperty } from '../../types';
import {
  createEffectProperty,
  ensureColorCorrectionState,
} from '../../types';
import { Logger } from '../../services/logger';
import { captureSnapshot } from '../historyStore';
import { generateEffectId } from './helpers/idGenerator';
import { blobUrlManager } from './helpers/blobUrlManager';
import { cloneClipNodeGraph } from '../../services/nodeGraph';
import { getDataOnlyTimelineSource } from './sourceRuntimeSanitizer';
import {
  createTimelineSolidCanvasRuntime,
  createTimelineTextCanvasRuntime,
} from '../../services/timeline/timelineGeneratedCanvasRuntime';
import { createClipboardMediaReloadPatch } from '../../services/timeline/timelineMediaSourceRuntimeRestore';
import { createPastedClipboardClipsPlan } from './clipboard/clipboardClipPastePlanner';
import {
  clampClipboardKeyframeTime,
  cloneClipboardEffect,
  cloneClipboardKeyframe,
  generateClipboardKeyframeId,
  getClipboardTargetClipIds,
  parseClipboardEffectKeyframeProperty,
} from './clipboard/clipboardEffectKeyframes';

const log = Logger.create('Clipboard');

function randomSuffix(): string {
  return Math.random().toString(36).substr(2, 5);
}

export const createClipboardSlice: SliceCreator<ClipboardActions> = (set, get) => ({
  copyClips: () => {
    const { clips, selectedClipIds, clipKeyframes, tracks } = get();

    if (selectedClipIds.size === 0) {
      log.debug('No clips selected to copy');
      return;
    }

    // Get all selected clips
    const selectedClips = clips.filter(c => selectedClipIds.has(c.id));

    // Also include linked audio clips if a video clip is selected
    const linkedClipIds = new Set<string>();
    selectedClips.forEach(clip => {
      if (clip.linkedClipId) {
        linkedClipIds.add(clip.linkedClipId);
      }
    });

    // Add linked clips that aren't already selected
    const linkedClips = clips.filter(c => linkedClipIds.has(c.id) && !selectedClipIds.has(c.id));
    const allClipsToCopy = [...selectedClips, ...linkedClips];

    // Convert to clipboard format (serializable, without DOM elements)
    const clipboardData: ClipboardClipData[] = allClipsToCopy.map(clip => {
      const dataOnlySource = getDataOnlyTimelineSource(clip);
      // Get track type for this clip
      const track = tracks.find(t => t.id === clip.trackId);
      const trackType = track?.type || 'video';

      // Get keyframes for this clip
      const keyframes = clipKeyframes.get(clip.id) || [];

      return {
        id: clip.id,
        trackId: clip.trackId,
        trackType,
        name: clip.name,
        mediaFileId: dataOnlySource?.mediaFileId || clip.mediaFileId,
        signalAssetId: clip.signalAssetId,
        signalRefId: clip.signalRefId,
        signalRenderAdapterId: clip.signalRenderAdapterId,
        startTime: clip.startTime,
        duration: clip.duration,
        inPoint: clip.inPoint,
        outPoint: clip.outPoint,
        sourceType: dataOnlySource?.type || 'video',
        naturalDuration: dataOnlySource?.naturalDuration,
        vectorAnimationSettings: dataOnlySource?.vectorAnimationSettings
          ? { ...dataOnlySource.vectorAnimationSettings }
          : undefined,
        cameraSettings: dataOnlySource?.type === 'camera' && dataOnlySource.cameraSettings
          ? { ...dataOnlySource.cameraSettings }
          : undefined,
        meshType: clip.meshType || dataOnlySource?.meshType,
        threeDEffectorsEnabled: dataOnlySource?.threeDEffectorsEnabled,
        splatEffectorSettings: dataOnlySource?.type === 'splat-effector' && dataOnlySource.splatEffectorSettings
          ? { ...dataOnlySource.splatEffectorSettings }
          : undefined,
        transform: { ...clip.transform },
        effects: clip.effects.map(e => ({ ...e, params: { ...e.params } })),
        colorCorrection: clip.colorCorrection ? structuredClone(clip.colorCorrection) : undefined,
        nodeGraph: cloneClipNodeGraph(clip.nodeGraph),
        masks: clip.masks?.map(m => ({
          ...m,
          vertices: m.vertices.map(v => ({ ...v })),
        })),
        keyframes: keyframes.length > 0 ? keyframes.map(k => structuredClone(k)) : undefined,
        linkedClipId: clip.linkedClipId,
        reversed: clip.reversed,
        speed: clip.speed,
        preservesPitch: clip.preservesPitch,
        textProperties: clip.textProperties ? { ...clip.textProperties } : undefined,
        text3DProperties: clip.text3DProperties
          ? { ...clip.text3DProperties }
          : clip.source?.text3DProperties
            ? { ...clip.source.text3DProperties }
            : undefined,
        solidColor: dataOnlySource?.type === 'solid' ? (clip.solidColor || clip.name.replace('Solid ', '')) : undefined,
        transitionOverlay: dataOnlySource?.type === 'transition-overlay'
          ? structuredClone(clip.transitionOverlay ?? dataOnlySource.transitionOverlay)
          : undefined,
        mathScene: dataOnlySource?.type === 'math-scene' && clip.mathScene
          ? structuredClone(clip.mathScene)
          : undefined,
        motion: clip.motion ? structuredClone(clip.motion) : undefined,
        // Visual data - reuse existing thumbnails and waveforms
        thumbnails: clip.thumbnails ? [...clip.thumbnails] : undefined,
        waveform: clip.waveform ? [...clip.waveform] : undefined,
        waveformChannels: clip.waveformChannels?.map(channel => [...channel]),
        audioAnalysisRefs: clip.audioState
          ? {
              sourceAnalysisRefs: clip.audioState.sourceAnalysisRefs
                ? structuredClone(clip.audioState.sourceAnalysisRefs)
                : undefined,
              processedAnalysisRefs: clip.audioState.processedAnalysisRefs
                ? structuredClone(clip.audioState.processedAnalysisRefs)
                : undefined,
            }
          : undefined,
        isComposition: clip.isComposition,
        compositionId: clip.compositionId,
        is3D: clip.is3D,
        wireframe: clip.wireframe,
      };
    });

    set({ clipboardData, clipboardKeyframes: null });
    log.info('Copied clips', { count: clipboardData.length, ids: clipboardData.map(c => c.id) });
  },

  pasteClips: () => {
    const { clipboardData, playheadPosition, tracks, clips, clipKeyframes, updateDuration, invalidateCache, targetTrackIdByType } = get();

    if (!clipboardData || clipboardData.length === 0) {
      log.debug('No clipboard data to paste');
      return;
    }

    // Capture snapshot for undo before making changes
    captureSnapshot('Paste clips');

    const { idMapping, newClips, newKeyframes } = createPastedClipboardClipsPlan({
      clipboardData,
      playheadPosition,
      tracks,
      clipKeyframes,
      targetTrackIdByType,
      timestamp: Date.now(),
      createSuffix: randomSuffix,
      onMissingTrack: (clipData) => {
        log.warn('No suitable track found for clip', { clipName: clipData.name, trackType: clipData.trackType });
      },
    });

    if (newClips.length === 0) {
      log.warn('No clips could be pasted');
      return;
    }

    // Add new clips and keyframes to state
    set({
      clips: [...clips, ...newClips],
      clipKeyframes: newKeyframes,
      selectedClipIds: new Set(newClips.map(c => c.id)),
    });

    updateDuration();
    invalidateCache();

    log.info('Pasted clips', { count: newClips.length, ids: newClips.map(c => c.id) });

    // Reload media for pasted clips asynchronously
    import('../mediaStore').then(async ({ useMediaStore }) => {
      const mediaStore = useMediaStore.getState();

      for (const newClip of newClips) {
        // Skip text clips - they need special handling
        if (newClip.textProperties) {
          createTimelineTextCanvasRuntime({
            textProperties: newClip.textProperties,
          }).then(({ canvas: textCanvas, textProperties }) => {
            set(state => ({
              clips: state.clips.map(c =>
                c.id === newClip.id
                  ? {
                      ...c,
                      textProperties,
                      source: {
                        type: 'text' as const,
                        textCanvas,
                        mediaFileId: c.source?.mediaFileId,
                        naturalDuration: c.duration,
                      },
                      isLoading: false,
                      needsReload: false,
                    }
                  : c
              ),
            }));
          });
          continue;
        }

        if (newClip.source?.type === 'camera') {
          continue;
        }

        if (newClip.source?.type === 'model' && newClip.meshType) {
          continue;
        }

        if (newClip.source?.type === 'splat-effector') {
          continue;
        }

        if (
          newClip.source?.type === 'motion-shape' ||
          newClip.source?.type === 'motion-null' ||
          newClip.source?.type === 'motion-adjustment'
        ) {
          continue;
        }

        // Handle solid clips - regenerate canvas
        if (newClip.source?.type === 'solid') {
          const originalClipData = clipboardData.find(cd => idMapping.get(cd.id) === newClip.id);
          const color = originalClipData?.solidColor || '#ffffff';
          const canvas = createTimelineSolidCanvasRuntime({ color });

          set(state => ({
            clips: state.clips.map(c =>
              c.id === newClip.id
                ? {
                    ...c,
                    source: {
                      type: 'solid' as const,
                      textCanvas: canvas,
                      mediaFileId: c.source?.mediaFileId,
                      naturalDuration: c.duration,
                    },
                    isLoading: false,
                    needsReload: false,
                  }
                : c
            ),
          }));
          continue;
        }

        // Skip composition clips - they reference compositions, not media files
        if (newClip.isComposition) {
          // Composition clips need their nested content loaded
          // For now just mark as not loading - the rendering will handle it
          set(state => ({
            clips: state.clips.map(c =>
              c.id === newClip.id
                ? { ...c, isLoading: false }
                : c
            ),
          }));
          continue;
        }

        const mediaFileId = newClip.source?.mediaFileId;
        if (!mediaFileId) continue;

        const mediaFile = mediaStore.files.find(f => f.id === mediaFileId);
        if (!mediaFile?.file) {
          log.warn('Media file not found for pasted clip', { clipId: newClip.id, mediaFileId });
          continue;
        }

        const reloadPatch = createClipboardMediaReloadPatch({
          clipId: newClip.id,
          duration: newClip.duration,
          mediaFile,
          mediaFileId,
          source: newClip.source,
          createImageUrl: ({ clipId, file }) => blobUrlManager.create(clipId, file, 'image'),
        });

        if (reloadPatch) {
          set(state => ({
            clips: state.clips.map(c =>
              c.id === newClip.id
                ? {
                    ...c,
                    ...reloadPatch,
                  }
                : c
            ),
          }));
        }
      }
    });
  },

  hasClipboardData: () => {
    const { clipboardData } = get();
    return clipboardData !== null && clipboardData.length > 0;
  },

  copyKeyframes: () => {
    const { selectedKeyframeIds, clipKeyframes } = get();

    if (selectedKeyframeIds.size === 0) {
      log.debug('No keyframes selected to copy');
      return;
    }

    // Collect all selected keyframes
    const selectedKfs: Keyframe[] = [];
    clipKeyframes.forEach((keyframes) => {
      keyframes.forEach(kf => {
        if (selectedKeyframeIds.has(kf.id)) {
          selectedKfs.push(kf);
        }
      });
    });

    if (selectedKfs.length === 0) return;

    // Find earliest time to normalize (so pasting is relative to playhead)
    const earliestTime = Math.min(...selectedKfs.map(kf => kf.time));

    const clipboardKeyframes: ClipboardKeyframeData[] = selectedKfs.map(kf => ({
      clipId: kf.clipId,
      property: kf.property,
      time: kf.time - earliestTime,
      value: kf.value,
      pathValue: kf.pathValue ? structuredClone(kf.pathValue) : undefined,
      easing: kf.easing as EasingType,
      rotationInterpolation: kf.rotationInterpolation,
      handleIn: kf.handleIn ? { ...kf.handleIn } : undefined,
      handleOut: kf.handleOut ? { ...kf.handleOut } : undefined,
    }));

    set({ clipboardKeyframes, clipboardData: null });
    log.info('Copied keyframes', { count: clipboardKeyframes.length });
  },

  pasteKeyframes: () => {
    const { clipboardKeyframes, playheadPosition, clips, selectedClipIds, clipKeyframes, invalidateCache, pasteClips } = get();

    if (!clipboardKeyframes || clipboardKeyframes.length === 0) {
      // Fall through to clip paste
      pasteClips();
      return;
    }

    // Determine target clip: use selected clip, or fall back to the original clip
    const targetClipId = selectedClipIds.size === 1
      ? [...selectedClipIds][0]
      : clipboardKeyframes[0].clipId;

    const targetClip = clips.find(c => c.id === targetClipId);
    if (!targetClip) {
      log.warn('No target clip found for keyframe paste');
      return;
    }

    captureSnapshot('Paste keyframes');

    const clipLocalTime = playheadPosition - targetClip.startTime;
    const newMap = new Map(clipKeyframes);
    const existingKeyframes = newMap.get(targetClipId) || [];
    const newKeyframes = [...existingKeyframes];

    const timestamp = Date.now();
    const randomSuffix = () => Math.random().toString(36).substr(2, 5);

    for (const kfData of clipboardKeyframes) {
      const newTime = Math.max(0, Math.min(targetClip.duration, clipLocalTime + kfData.time));

      const newKf: Keyframe = {
        id: `kf_${timestamp}_${randomSuffix()}`,
        clipId: targetClipId,
        time: newTime,
        property: kfData.property,
          value: kfData.value,
          pathValue: kfData.pathValue ? structuredClone(kfData.pathValue) : undefined,
          easing: kfData.easing,
          rotationInterpolation: kfData.rotationInterpolation,
          handleIn: kfData.handleIn ? { ...kfData.handleIn } : undefined,
          handleOut: kfData.handleOut ? { ...kfData.handleOut } : undefined,
        };

      newKeyframes.push(newKf);
    }

    // Sort by time
    newKeyframes.sort((a, b) => a.time - b.time);
    newMap.set(targetClipId, newKeyframes);

    set({ clipKeyframes: newMap });
    invalidateCache();
    log.info('Pasted keyframes', { count: clipboardKeyframes.length, targetClipId });
  },

  copyClipEffects: (clipId) => {
    const { clips, clipKeyframes } = get();
    const clip = clips.find(c => c.id === clipId);

    if (!clip) {
      log.warn('No source clip found for effects copy', { clipId });
      return;
    }

    const effectIds = new Set((clip.effects || []).map(effect => effect.id));
    const keyframes = (clipKeyframes.get(clipId) || [])
      .filter(keyframe => {
        const parsed = parseClipboardEffectKeyframeProperty(keyframe.property);
        return !!parsed && effectIds.has(parsed.effectId);
      })
      .map(cloneClipboardKeyframe);

    set({
      clipboardEffects: {
        sourceClipId: clipId,
        effects: (clip.effects || []).map(cloneClipboardEffect),
        keyframes,
      },
    });

    log.info('Copied clip effects', {
      clipId,
      effectCount: clip.effects?.length ?? 0,
      keyframeCount: keyframes.length,
    });
  },

  pasteClipEffects: (targetClipIds) => {
    const {
      clipboardEffects,
      selectedClipIds,
      clips,
      clipKeyframes,
      keyframeRecordingEnabled,
      selectedKeyframeIds,
      invalidateCache,
    } = get();

    if (!clipboardEffects) {
      log.debug('No copied effects to paste');
      return;
    }

    const targetIds = getClipboardTargetClipIds(targetClipIds, selectedClipIds);
    const targetIdSet = new Set(targetIds);
    const targetClips = clips.filter(clip => targetIdSet.has(clip.id));

    if (targetClips.length === 0) {
      log.warn('No target clips found for effects paste', { targetClipIds: targetIds });
      return;
    }

    captureSnapshot(targetClips.length === 1 ? 'Paste effects' : 'Paste effects to clips');

    const nextKeyframes = new Map(clipKeyframes);
    let nextSelectedKeyframeIds = selectedKeyframeIds;
    let nextRecordingEnabled = keyframeRecordingEnabled;

    const updatedClips = clips.map(clip => {
      if (!targetIdSet.has(clip.id)) return clip;

      const effectIdMap = new Map<string, string>();
      const pastedEffects = clipboardEffects.effects.map(effect => {
        const nextEffectId = generateEffectId();
        effectIdMap.set(effect.id, nextEffectId);
        return {
          ...cloneClipboardEffect(effect),
          id: nextEffectId,
        };
      });

      const existingKeyframes = nextKeyframes.get(clip.id) || [];
      const removedEffectKeyframeIds = new Set<string>();
      const retainedKeyframes = existingKeyframes.filter(keyframe => {
        if (!keyframe.property.startsWith('effect.')) return true;
        removedEffectKeyframeIds.add(keyframe.id);
        return false;
      });

      const pastedKeyframes: Keyframe[] = clipboardEffects.keyframes
        .map(keyframe => {
          const parsed = parseClipboardEffectKeyframeProperty(keyframe.property);
          if (!parsed) return null;

          const mappedEffectId = effectIdMap.get(parsed.effectId);
          if (!mappedEffectId) return null;

          return {
            ...cloneClipboardKeyframe(keyframe),
            id: generateClipboardKeyframeId(),
            clipId: clip.id,
            time: clampClipboardKeyframeTime(keyframe.time, clip.duration),
            property: createEffectProperty(mappedEffectId, parsed.paramName) as AnimatableProperty,
          };
        })
        .filter((keyframe): keyframe is Keyframe => keyframe !== null);

      const clipKeyframesAfterPaste = [...retainedKeyframes, ...pastedKeyframes]
        .toSorted((a, b) => a.time - b.time);

      if (clipKeyframesAfterPaste.length > 0) {
        nextKeyframes.set(clip.id, clipKeyframesAfterPaste);
      } else {
        nextKeyframes.delete(clip.id);
      }

      if (removedEffectKeyframeIds.size > 0) {
        nextSelectedKeyframeIds = new Set(
          [...nextSelectedKeyframeIds].filter(keyframeId => !removedEffectKeyframeIds.has(keyframeId))
        );
      }

      const recordingPrefix = `${clip.id}:effect.`;
      if ([...nextRecordingEnabled].some(recordingKey => recordingKey.startsWith(recordingPrefix))) {
        nextRecordingEnabled = new Set(
          [...nextRecordingEnabled].filter(recordingKey => !recordingKey.startsWith(recordingPrefix))
        );
      }

      return {
        ...clip,
        effects: pastedEffects,
      };
    });

    set({
      clips: updatedClips,
      clipKeyframes: nextKeyframes,
      keyframeRecordingEnabled: nextRecordingEnabled,
      selectedKeyframeIds: nextSelectedKeyframeIds,
    });
    invalidateCache();

    log.info('Pasted clip effects', {
      targetClipCount: targetClips.length,
      effectCount: clipboardEffects.effects.length,
      keyframeCount: clipboardEffects.keyframes.length,
    });
  },

  hasClipboardEffects: () => {
    return get().clipboardEffects !== null;
  },

  copyClipColor: (clipId) => {
    const { clips, clipKeyframes } = get();
    const clip = clips.find(c => c.id === clipId);

    if (!clip) {
      log.warn('No source clip found for color copy', { clipId });
      return;
    }

    const keyframes = (clipKeyframes.get(clipId) || [])
      .filter(keyframe => keyframe.property.startsWith('color.'))
      .map(cloneClipboardKeyframe);

    set({
      clipboardColor: {
        sourceClipId: clipId,
        colorCorrection: ensureColorCorrectionState(clip.colorCorrection),
        keyframes,
      },
    });

    log.info('Copied clip color', {
      clipId,
      keyframeCount: keyframes.length,
    });
  },

  pasteClipColor: (targetClipIds) => {
    const {
      clipboardColor,
      selectedClipIds,
      clips,
      clipKeyframes,
      keyframeRecordingEnabled,
      selectedKeyframeIds,
      invalidateCache,
    } = get();

    if (!clipboardColor) {
      log.debug('No copied color to paste');
      return;
    }

    const targetIds = getClipboardTargetClipIds(targetClipIds, selectedClipIds);
    const targetIdSet = new Set(targetIds);
    const targetClips = clips.filter(clip => targetIdSet.has(clip.id));

    if (targetClips.length === 0) {
      log.warn('No target clips found for color paste', { targetClipIds: targetIds });
      return;
    }

    captureSnapshot(targetClips.length === 1 ? 'Paste color' : 'Paste color to clips');

    const nextKeyframes = new Map(clipKeyframes);
    let nextSelectedKeyframeIds = selectedKeyframeIds;
    let nextRecordingEnabled = keyframeRecordingEnabled;

    const updatedClips = clips.map(clip => {
      if (!targetIdSet.has(clip.id)) return clip;

      const existingKeyframes = nextKeyframes.get(clip.id) || [];
      const removedColorKeyframeIds = new Set<string>();
      const retainedKeyframes = existingKeyframes.filter(keyframe => {
        if (!keyframe.property.startsWith('color.')) return true;
        removedColorKeyframeIds.add(keyframe.id);
        return false;
      });

      const pastedKeyframes = clipboardColor.keyframes.map(keyframe => ({
        ...cloneClipboardKeyframe(keyframe),
        id: generateClipboardKeyframeId(),
        clipId: clip.id,
        time: clampClipboardKeyframeTime(keyframe.time, clip.duration),
      }));

      const clipKeyframesAfterPaste = [...retainedKeyframes, ...pastedKeyframes]
        .toSorted((a, b) => a.time - b.time);

      if (clipKeyframesAfterPaste.length > 0) {
        nextKeyframes.set(clip.id, clipKeyframesAfterPaste);
      } else {
        nextKeyframes.delete(clip.id);
      }

      if (removedColorKeyframeIds.size > 0) {
        nextSelectedKeyframeIds = new Set(
          [...nextSelectedKeyframeIds].filter(keyframeId => !removedColorKeyframeIds.has(keyframeId))
        );
      }

      const recordingPrefix = `${clip.id}:color.`;
      if ([...nextRecordingEnabled].some(recordingKey => recordingKey.startsWith(recordingPrefix))) {
        nextRecordingEnabled = new Set(
          [...nextRecordingEnabled].filter(recordingKey => !recordingKey.startsWith(recordingPrefix))
        );
      }

      return {
        ...clip,
        colorCorrection: structuredClone(clipboardColor.colorCorrection),
      };
    });

    set({
      clips: updatedClips,
      clipKeyframes: nextKeyframes,
      keyframeRecordingEnabled: nextRecordingEnabled,
      selectedKeyframeIds: nextSelectedKeyframeIds,
    });
    invalidateCache();

    log.info('Pasted clip color', {
      targetClipCount: targetClips.length,
      keyframeCount: clipboardColor.keyframes.length,
    });
  },

  hasClipboardColor: () => {
    return get().clipboardColor !== null;
  },
});
