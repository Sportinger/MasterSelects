// Clipboard-related actions slice for copy/paste functionality

import type { ClipboardActions, SliceCreator, ClipboardClipData, ClipboardKeyframeData, Keyframe } from './types';
import type { TimelineClip, EasingType, Effect, AnimatableProperty, EffectProperty } from '../../types';
import {
  createEffectProperty,
  ensureColorCorrectionState,
  parseEffectProperty,
} from '../../types';
import { flags } from '../../engine/featureFlags';
import { Logger } from '../../services/logger';
import { captureSnapshot } from '../historyStore';
import { DEFAULT_SCENE_CAMERA_SETTINGS } from '../mediaStore/types';
import { DEFAULT_SPLAT_EFFECTOR_SETTINGS } from '../../types/splatEffector';
import { lottieRuntimeManager } from '../../services/vectorAnimation/LottieRuntimeManager';
import { mathSceneRenderer } from '../../services/mathScene/MathSceneRenderer';
import { generateEffectId } from './helpers/idGenerator';
import { cloneClipNodeGraph, remapClipNodeGraphEffectIds } from '../../services/nodeGraph';

const log = Logger.create('Clipboard');

function randomSuffix(): string {
  return Math.random().toString(36).substr(2, 5);
}

function generateKeyframeId(): string {
  return `kf_${Date.now()}_${randomSuffix()}`;
}

function cloneEffect(effect: Effect): Effect {
  return {
    ...effect,
    params: structuredClone(effect.params),
  };
}

function cloneKeyframe(keyframe: Keyframe): Keyframe {
  return structuredClone(keyframe);
}

function clampKeyframeTime(time: number, duration: number): number {
  return Math.max(0, Math.min(duration, time));
}

function parseEffectKeyframeProperty(property: AnimatableProperty) {
  return property.startsWith('effect.')
    ? parseEffectProperty(property as EffectProperty)
    : null;
}

function getTargetClipIds(explicitTargets: string[] | undefined, selectedClipIds: Set<string>): string[] {
  const ids = explicitTargets && explicitTargets.length > 0
    ? explicitTargets
    : [...selectedClipIds];
  return [...new Set(ids)];
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
        mediaFileId: clip.source?.mediaFileId || clip.mediaFileId,
        startTime: clip.startTime,
        duration: clip.duration,
        inPoint: clip.inPoint,
        outPoint: clip.outPoint,
        sourceType: clip.source?.type || 'video',
        naturalDuration: clip.source?.naturalDuration,
        vectorAnimationSettings: clip.source?.vectorAnimationSettings
          ? { ...clip.source.vectorAnimationSettings }
          : undefined,
        cameraSettings: clip.source?.type === 'camera' && clip.source.cameraSettings
          ? { ...clip.source.cameraSettings }
          : undefined,
        meshType: clip.meshType || clip.source?.meshType,
        threeDEffectorsEnabled: clip.source?.threeDEffectorsEnabled,
        splatEffectorSettings: clip.source?.type === 'splat-effector' && clip.source.splatEffectorSettings
          ? { ...clip.source.splatEffectorSettings }
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
        solidColor: clip.source?.type === 'solid' ? (clip.solidColor || clip.name.replace('Solid ', '')) : undefined,
        mathScene: clip.source?.type === 'math-scene' && clip.mathScene
          ? structuredClone(clip.mathScene)
          : undefined,
        motion: clip.motion ? structuredClone(clip.motion) : undefined,
        // Visual data - reuse existing thumbnails and waveforms
        thumbnails: clip.thumbnails ? [...clip.thumbnails] : undefined,
        waveform: clip.waveform ? [...clip.waveform] : undefined,
        isComposition: clip.isComposition,
        compositionId: clip.compositionId,
        is3D: clip.is3D,
        wireframe: clip.wireframe,
      };
    });

    set({ clipboardData });
    log.info('Copied clips', { count: clipboardData.length, ids: clipboardData.map(c => c.id) });
  },

  pasteClips: () => {
    const { clipboardData, playheadPosition, tracks, clips, clipKeyframes, updateDuration, invalidateCache } = get();

    if (!clipboardData || clipboardData.length === 0) {
      log.debug('No clipboard data to paste');
      return;
    }

    // Capture snapshot for undo before making changes
    captureSnapshot('Paste clips');

    const timestamp = Date.now();
    const randomSuffix = () => Math.random().toString(36).substr(2, 5);

    // Create ID mapping for linked clips (old ID -> new ID)
    const idMapping = new Map<string, string>();
    clipboardData.forEach(clipData => {
      idMapping.set(clipData.id, `clip-${timestamp}-${randomSuffix()}`);
    });

    // Find the earliest clip in clipboard to calculate offset
    const earliestStartTime = Math.min(...clipboardData.map(c => c.startTime));
    const timeOffset = playheadPosition - earliestStartTime;

    const newClips: TimelineClip[] = [];
    const newKeyframes = new Map<string, Keyframe[]>(clipKeyframes);

    for (const clipData of clipboardData) {
      const newId = idMapping.get(clipData.id)!;
      const newStartTime = clipData.startTime + timeOffset;
      const text3DProperties = clipData.text3DProperties ? { ...clipData.text3DProperties } : undefined;
      const isPrimitiveMeshClip = clipData.sourceType === 'model' && !!clipData.meshType;
      const isCameraClip = clipData.sourceType === 'camera';
      const isSplatEffectorClip = clipData.sourceType === 'splat-effector';
      const isMotionClip =
        clipData.sourceType === 'motion-shape' ||
        clipData.sourceType === 'motion-null' ||
        clipData.sourceType === 'motion-adjustment';
      const requiresAsyncMediaLoad =
        !clipData.isComposition &&
        clipData.sourceType !== 'text' &&
        clipData.sourceType !== 'solid' &&
        clipData.sourceType !== 'math-scene' &&
        !isPrimitiveMeshClip &&
        !isCameraClip &&
        !isSplatEffectorClip &&
        !isMotionClip;

      // Find a track of the same type as the original
      let targetTrackId = clipData.trackId;
      const originalTrack = tracks.find(t => t.id === clipData.trackId);

      if (!originalTrack) {
        // Original track doesn't exist, find another track of same type
        const sameTypeTrack = tracks.find(t => t.type === clipData.trackType);
        if (sameTypeTrack) {
          targetTrackId = sameTypeTrack.id;
        } else {
          log.warn('No suitable track found for clip', { clipName: clipData.name, trackType: clipData.trackType });
          continue;
        }
      }

      // Handle linked clip ID mapping
      let newLinkedClipId: string | undefined;
      if (clipData.linkedClipId) {
        newLinkedClipId = idMapping.get(clipData.linkedClipId);
      }

      const effectIdMap = new Map<string, string>();
      const effects = clipData.effects.map(e => {
        const nextEffectId = `effect-${timestamp}-${randomSuffix()}`;
        effectIdMap.set(e.id, nextEffectId);
        return {
          ...e,
          id: nextEffectId,
          params: { ...e.params },
        };
      });

      // Create the new clip
      const newClip: TimelineClip = {
        id: newId,
        trackId: targetTrackId,
        name: clipData.name,
        file: new File([], clipData.name), // Placeholder file
        mediaFileId: clipData.mediaFileId,
        startTime: Math.max(0, newStartTime),
        duration: clipData.duration,
        inPoint: clipData.inPoint,
        outPoint: clipData.outPoint,
        source: isPrimitiveMeshClip ? {
          type: 'model' as const,
          meshType: clipData.meshType,
          mediaFileId: clipData.mediaFileId,
          naturalDuration: clipData.naturalDuration ?? Number.MAX_SAFE_INTEGER,
          threeDEffectorsEnabled: clipData.threeDEffectorsEnabled ?? true,
          ...(text3DProperties ? { text3DProperties } : {}),
        } : isCameraClip ? {
          type: 'camera' as const,
          mediaFileId: clipData.mediaFileId,
          naturalDuration: clipData.naturalDuration ?? Number.MAX_SAFE_INTEGER,
          cameraSettings: clipData.cameraSettings ? { ...clipData.cameraSettings } : { ...DEFAULT_SCENE_CAMERA_SETTINGS },
        } : isSplatEffectorClip ? {
          type: 'splat-effector' as const,
          mediaFileId: clipData.mediaFileId,
          naturalDuration: clipData.naturalDuration ?? Number.MAX_SAFE_INTEGER,
          splatEffectorSettings: clipData.splatEffectorSettings
            ? { ...clipData.splatEffectorSettings }
            : { ...DEFAULT_SPLAT_EFFECTOR_SETTINGS },
        } : clipData.sourceType === 'solid' ? {
          type: 'solid' as const,
          mediaFileId: clipData.mediaFileId,
          naturalDuration: clipData.duration,
        } : clipData.sourceType === 'text' ? {
          type: 'text' as const,
          mediaFileId: clipData.mediaFileId,
          naturalDuration: clipData.naturalDuration ?? clipData.duration,
        } : clipData.sourceType === 'math-scene' && clipData.mathScene ? {
          type: 'math-scene' as const,
          mediaFileId: clipData.mediaFileId,
          naturalDuration: clipData.naturalDuration ?? clipData.duration,
          textCanvas: (() => {
            const canvas = mathSceneRenderer.createCanvas();
            mathSceneRenderer.render(clipData.mathScene!, canvas, 0, clipData.duration);
            return canvas;
          })(),
        } : isMotionClip && clipData.motion ? {
          type: clipData.sourceType,
          mediaFileId: clipData.mediaFileId,
          naturalDuration: clipData.naturalDuration ?? clipData.duration,
        } : clipData.sourceType === 'lottie' && clipData.mediaFileId ? {
          type: 'lottie' as const,
          mediaFileId: clipData.mediaFileId,
          naturalDuration: clipData.naturalDuration ?? clipData.duration,
          vectorAnimationSettings: clipData.vectorAnimationSettings,
        } : clipData.mediaFileId ? {
          type: clipData.sourceType,
          mediaFileId: clipData.mediaFileId,
          naturalDuration: clipData.naturalDuration,
          threeDEffectorsEnabled: clipData.threeDEffectorsEnabled ?? true,
        } : null,
        transform: {
          ...clipData.transform,
          position: { ...clipData.transform.position },
          scale: { ...clipData.transform.scale },
          rotation: { ...clipData.transform.rotation },
        },
        effects,
        colorCorrection: clipData.colorCorrection ? structuredClone(clipData.colorCorrection) : undefined,
        nodeGraph: remapClipNodeGraphEffectIds(clipData.nodeGraph, effectIdMap),
        masks: clipData.masks?.map(m => ({
          ...m,
          id: `mask-${timestamp}-${randomSuffix()}`, // New mask IDs
          vertices: m.vertices.map(v => ({
            ...v,
            id: `vertex-${timestamp}-${randomSuffix()}`, // New vertex IDs
          })),
        })),
        linkedClipId: newLinkedClipId,
        reversed: clipData.reversed,
        speed: clipData.speed,
        preservesPitch: clipData.preservesPitch,
        textProperties: clipData.textProperties ? { ...clipData.textProperties } : undefined,
        text3DProperties,
        solidColor: clipData.solidColor,
        mathScene: clipData.mathScene ? structuredClone(clipData.mathScene) : undefined,
        motion: clipData.motion ? structuredClone(clipData.motion) : undefined,
        // Reuse existing thumbnails and waveforms from copied clip
        thumbnails: clipData.thumbnails ? [...clipData.thumbnails] : undefined,
        waveform: clipData.waveform ? [...clipData.waveform] : undefined,
        isComposition: clipData.isComposition,
        compositionId: clipData.compositionId,
        is3D: clipData.is3D,
        wireframe: clipData.wireframe,
        meshType: clipData.meshType,
        isLoading: clipData.isComposition || clipData.sourceType === 'text' || clipData.sourceType === 'solid' || requiresAsyncMediaLoad,
        needsReload: requiresAsyncMediaLoad,
      };

      newClips.push(newClip);

      // Copy keyframes with new IDs and mapped clipId
      if (clipData.keyframes && clipData.keyframes.length > 0) {
        const newClipKeyframes = clipData.keyframes.map(kf => ({
          ...kf,
          id: `kf_${timestamp}_${randomSuffix()}`,
          clipId: newId,
        }));
        newKeyframes.set(newId, newClipKeyframes);
      }
    }

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
          // Regenerate text canvas
          Promise.all([
            import('../../services/textRenderer'),
            import('../../services/googleFontsService'),
          ]).then(async ([{ textRenderer }, { googleFontsService }]) => {
            await googleFontsService.loadFont(
              newClip.textProperties!.fontFamily,
              newClip.textProperties!.fontWeight
            );
            const textCanvas = textRenderer.render(newClip.textProperties!);

            set(state => ({
              clips: state.clips.map(c =>
                c.id === newClip.id
                  ? {
                      ...c,
                      source: {
                        type: 'text' as const,
                        textCanvas,
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
          const canvas = document.createElement('canvas');
          canvas.width = 1920;
          canvas.height = 1080;
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1920, 1080);

          set(state => ({
            clips: state.clips.map(c =>
              c.id === newClip.id
                ? {
                    ...c,
                    source: {
                      type: 'solid' as const,
                      textCanvas: canvas,
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

        const sourceType = newClip.source?.type;

        if (sourceType === 'lottie') {
          try {
            const runtimeClip: TimelineClip = {
              ...newClip,
              file: mediaFile.file,
              source: {
                type: 'lottie',
                mediaFileId,
                naturalDuration: newClip.source?.naturalDuration ?? newClip.duration,
                vectorAnimationSettings: newClip.source?.vectorAnimationSettings,
              },
            };
            const runtime = await lottieRuntimeManager.prepareClipSource(runtimeClip, mediaFile.file);
            const naturalDuration =
              runtime.metadata.duration ??
              newClip.source?.naturalDuration ??
              newClip.duration;
            lottieRuntimeManager.renderClipAtTime(runtimeClip, runtimeClip.startTime);

            set((state) => ({
              clips: state.clips.map((c) =>
                c.id === newClip.id
                  ? {
                      ...c,
                      file: mediaFile.file!,
                      source: {
                        type: 'lottie' as const,
                        textCanvas: runtime.canvas,
                        mediaFileId,
                        naturalDuration,
                        vectorAnimationSettings: runtimeClip.source?.vectorAnimationSettings,
                      },
                      isLoading: false,
                      needsReload: false,
                    }
                  : c
              ),
            }));
          } catch (error) {
            log.warn('Failed to restore pasted lottie clip', { clipId: newClip.id, error });
            set((state) => ({
              clips: state.clips.map((c) =>
                c.id === newClip.id
                  ? { ...c, isLoading: false }
                  : c
              ),
            }));
          }
          continue;
        }

        const fileUrl = URL.createObjectURL(mediaFile.file);

        if (sourceType === 'video') {
          const video = document.createElement('video');
          video.src = fileUrl;
          video.muted = true;
          video.playsInline = true;
          video.preload = 'auto';
          video.crossOrigin = 'anonymous';

          video.addEventListener('canplaythrough', async () => {
            set(state => ({
              clips: state.clips.map(c =>
                c.id === newClip.id
                  ? {
                      ...c,
                      file: mediaFile.file!,
                      source: {
                        type: 'video' as const,
                        videoElement: video,
                        naturalDuration: video.duration,
                        mediaFileId,
                      },
                      isLoading: false,
                      needsReload: false,
                    }
                  : c
              ),
            }));

            // Try to initialize WebCodecsPlayer
            const hasWebCodecs = 'VideoDecoder' in window && 'VideoFrame' in window;
            if (hasWebCodecs && flags.useFullWebCodecsPlayback) {
              try {
                const { WebCodecsPlayer } = await import('../../engine/WebCodecsPlayer');
                const webCodecsPlayer = new WebCodecsPlayer({
                  loop: false,
                  useSimpleMode: true,
                  onError: (error) => {
                    log.warn('WebCodecs error', { error: error.message });
                  },
                });
                webCodecsPlayer.attachToVideoElement(video);

                set(state => ({
                  clips: state.clips.map(c =>
                    c.id === newClip.id && c.source?.type === 'video'
                      ? {
                          ...c,
                          source: { ...c.source, webCodecsPlayer },
                        }
                      : c
                  ),
                }));
              } catch (err) {
                log.warn('WebCodecsPlayer init failed for pasted clip', err);
              }
            }
          }, { once: true });
        } else if (sourceType === 'audio') {
          const audio = document.createElement('audio');
          audio.src = fileUrl;
          audio.preload = 'auto';

          audio.addEventListener('canplaythrough', () => {
            set(state => ({
              clips: state.clips.map(c =>
                c.id === newClip.id
                  ? {
                      ...c,
                      file: mediaFile.file!,
                      source: {
                        type: 'audio' as const,
                        audioElement: audio,
                        naturalDuration: audio.duration,
                        mediaFileId,
                      },
                      isLoading: false,
                      needsReload: false,
                    }
                  : c
              ),
            }));
          }, { once: true });
        } else if (sourceType === 'image') {
          const img = new Image();
          img.src = fileUrl;

          img.addEventListener('load', () => {
            set(state => ({
              clips: state.clips.map(c =>
                c.id === newClip.id
                  ? {
                      ...c,
                      file: mediaFile.file!,
                      source: {
                        type: 'image' as const,
                        imageElement: img,
                      },
                      isLoading: false,
                      needsReload: false,
                    }
                  : c
              ),
            }));
          }, { once: true });
        } else if (sourceType === 'model') {
          set(state => ({
            clips: state.clips.map(c =>
              c.id === newClip.id
                ? {
                    ...c,
                    file: mediaFile.file!,
                    source: {
                      type: 'model' as const,
                      modelUrl: fileUrl,
                      naturalDuration: c.source?.naturalDuration || 3600,
                      mediaFileId,
                    },
                    is3D: true,
                    isLoading: false,
                    needsReload: false,
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

    set({ clipboardKeyframes });
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
        const parsed = parseEffectKeyframeProperty(keyframe.property);
        return !!parsed && effectIds.has(parsed.effectId);
      })
      .map(cloneKeyframe);

    set({
      clipboardEffects: {
        sourceClipId: clipId,
        effects: (clip.effects || []).map(cloneEffect),
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

    const targetIds = getTargetClipIds(targetClipIds, selectedClipIds);
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
          ...cloneEffect(effect),
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
          const parsed = parseEffectKeyframeProperty(keyframe.property);
          if (!parsed) return null;

          const mappedEffectId = effectIdMap.get(parsed.effectId);
          if (!mappedEffectId) return null;

          return {
            ...cloneKeyframe(keyframe),
            id: generateKeyframeId(),
            clipId: clip.id,
            time: clampKeyframeTime(keyframe.time, clip.duration),
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
      .map(cloneKeyframe);

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

    const targetIds = getTargetClipIds(targetClipIds, selectedClipIds);
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
        ...cloneKeyframe(keyframe),
        id: generateKeyframeId(),
        clipId: clip.id,
        time: clampKeyframeTime(keyframe.time, clip.duration),
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
