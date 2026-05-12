// Timeline serialization utilities - save, load, clear
// Extracted from index.ts for maintainability

import type { SliceCreator, TimelineClip, TimelineTrack, TimelineUtils, Keyframe, CompositionTimelineData } from './types';
import type {
  SerializableClip,
  ClipAnalysis,
  FrameAnalysisData,
  GaussianSplatSequenceData,
  ModelSequenceData,
} from '../../types';
import { DEFAULT_TRACKS, MAX_NESTING_DEPTH } from './constants';
import { useMediaStore } from '../mediaStore';
import { calculateNestedClipBoundaries, buildClipSegments } from './clip/addCompClip';
import { projectFileService } from '../../services/projectFileService';
import { mediaNeedsRelink } from '../../services/project/relinkMedia';
import { Logger } from '../../services/logger';
import { engine } from '../../engine/WebGPUEngine';
import { layerBuilder } from '../../services/layerBuilder';
import { NativeHelperClient } from '../../services/nativeHelper/NativeHelperClient';
import { sanitizePlayheadPosition } from '../../services/layerBuilder/PlayheadState';
import { thumbnailCacheService } from '../../services/thumbnailCacheService';
import { cloneClipNodeGraph } from '../../services/nodeGraph';
import type { WebCodecsPlayer } from '../../engine/WebCodecsPlayer';
import {
  DEFAULT_GAUSSIAN_SPLAT_SETTINGS,
  resolveGaussianSplatSettingsForSource,
} from '../../engine/gaussian/types';
import { lottieRuntimeManager } from '../../services/vectorAnimation/LottieRuntimeManager';
import { readLottieMetadata } from '../../services/vectorAnimation/lottieMetadata';
import { mathSceneRenderer } from '../../services/mathScene/MathSceneRenderer';
import { resolveGaussianSplatSequenceData } from '../../utils/gaussianSplatSequence';
import { resolveModelSequenceData } from '../../utils/modelSequence';

const log = Logger.create('Timeline');

// Global WebCodecsPlayer cache — persists across composition switches.
// Each player holds the parsed MP4 samples (~fileSize of memory via file.arrayBuffer()).
// Re-creating them on every comp switch reads the entire file again → OOM crash.
// Instead, cache by mediaFileId and reuse across switches.
const globalWcpCache = new Map<string, WebCodecsPlayer>();

/** Get or create a WebCodecsPlayer for a source file. Reuses cached players. */
async function getOrCreateWcp(
  mediaFileId: string,
  video: HTMLVideoElement,
  fileName: string,
  file?: File
): Promise<WebCodecsPlayer | null> {
  // Reuse cached player if available
  const cached = globalWcpCache.get(mediaFileId);
  if (cached && !cached.isDestroyed?.()) {
    log.debug('Reusing cached WebCodecsPlayer', { mediaFileId, fileName });
    return cached;
  }

  // Create new player
  const { initWebCodecsPlayer } = await import('./helpers/webCodecsHelpers');
  const player = await initWebCodecsPlayer(video, fileName, file);
  if (player) {
    globalWcpCache.set(mediaFileId, player);
    log.debug('Created & cached WebCodecsPlayer', { mediaFileId, fileName, fullMode: player.isFullMode() });
  }
  return player;
}

function restoreSourceThumbnails(
  mediaFileId: string | undefined,
  video: HTMLVideoElement,
  duration: number
): void {
  if (!mediaFileId || duration <= 0) {
    return;
  }

  const fileHash = useMediaStore.getState().files.find(f => f.id === mediaFileId)?.fileHash;
  void thumbnailCacheService.generateForSource(mediaFileId, video, duration, fileHash);
}

function restoreClipNodeGraph(serializedClip: SerializableClip) {
  return cloneClipNodeGraph(serializedClip.nodeGraph);
}

type SerializationUtils = Pick<TimelineUtils, 'getSerializableState' | 'loadState' | 'clearTimeline'>;

export const createSerializationUtils: SliceCreator<SerializationUtils> = (set, get) => ({
  // Get serializable timeline state for saving to composition
  getSerializableState: (): CompositionTimelineData => {
    const { tracks, clips, playheadPosition, duration, durationLocked, zoom, scrollX, inPoint, outPoint, loopPlayback, clipKeyframes, markers } = get();
    const safePlayheadPosition = sanitizePlayheadPosition(playheadPosition, 0);

    // Convert clips to serializable format (without DOM elements)
    const mediaStore = useMediaStore.getState();
    const serializableClips: SerializableClip[] = clips.map(clip => {
      // Use existing mediaFileId if available, otherwise lookup by name
      let resolvedMediaFileId = clip.source?.mediaFileId || '';

      if (!resolvedMediaFileId && !clip.isComposition) {
        // Fallback: Find the mediaFile ID by matching the file name in mediaStore
        // For linked audio clips (name ends with "(Audio)"), strip the suffix to find the video file
        let lookupName = clip.name;
        if (clip.linkedClipId && clip.source?.type === 'audio' && lookupName.endsWith(' (Audio)')) {
          lookupName = lookupName.replace(' (Audio)', '');
        }
        const mediaFile = mediaStore.files.find(f => f.name === lookupName);
        resolvedMediaFileId = mediaFile?.id || '';
      }

      // Get keyframes for this clip
      const keyframes = clipKeyframes.get(clip.id) || [];

      return {
        id: clip.id,
        trackId: clip.trackId,
        name: clip.name,
        mediaFileId: clip.isComposition ? '' : resolvedMediaFileId, // Comp clips don't have media files
        startTime: clip.startTime,
        duration: clip.duration,
        inPoint: clip.inPoint,
        outPoint: clip.outPoint,
        sourceType: clip.source?.type || 'video',
        naturalDuration: clip.source?.naturalDuration,
        thumbnails: clip.thumbnails,
        linkedClipId: clip.linkedClipId,
        linkedGroupId: clip.linkedGroupId,
        waveform: clip.waveform,
        transform: clip.transform,
        effects: clip.effects,
        colorCorrection: clip.colorCorrection ? structuredClone(clip.colorCorrection) : undefined,
        nodeGraph: cloneClipNodeGraph(clip.nodeGraph),
        keyframes: keyframes.length > 0 ? keyframes : undefined,
        // Nested composition support
        isComposition: clip.isComposition,
        compositionId: clip.compositionId,
        // Mask support
        masks: clip.masks && clip.masks.length > 0 ? clip.masks : undefined,
        // Transcript data
        transcript: clip.transcript && clip.transcript.length > 0 ? clip.transcript : undefined,
        transcriptStatus: clip.transcriptStatus !== 'none' ? clip.transcriptStatus : undefined,
        // Analysis data
        analysis: clip.analysis,
        analysisStatus: clip.analysisStatus !== 'none' ? clip.analysisStatus : undefined,
        // Playback
        reversed: clip.reversed || undefined,
        speed: clip.speed != null && clip.speed !== 1 ? clip.speed : undefined,
        preservesPitch: clip.preservesPitch === false ? false : undefined,
        // Text clip support
        textProperties: clip.textProperties,
        text3DProperties: clip.text3DProperties ?? clip.source?.text3DProperties,
        // Solid clip support
        solidColor: clip.source?.type === 'solid' ? (clip.solidColor || clip.name.replace('Solid ', '')) : undefined,
        vectorAnimationSettings: clip.source?.vectorAnimationSettings,
        mathScene: clip.source?.type === 'math-scene' && clip.mathScene
          ? structuredClone(clip.mathScene)
          : undefined,
        motion: clip.motion ? structuredClone(clip.motion) : undefined,
        // Clip label color
        // 3D layer support
        is3D: clip.is3D || undefined,
        threeDEffectorsEnabled: clip.source?.threeDEffectorsEnabled,
        meshType: clip.meshType ?? clip.source?.meshType,
        cameraSettings: clip.source?.type === 'camera' ? clip.source.cameraSettings : undefined,
        splatEffectorSettings: clip.source?.type === 'splat-effector' ? clip.source.splatEffectorSettings : undefined,
        // Gaussian avatar blendshapes
        gaussianBlendshapes: clip.source?.type === 'gaussian-avatar' ? clip.source.gaussianBlendshapes : undefined,
        gaussianSplatSequence: clip.source?.type === 'gaussian-splat' ? clip.source.gaussianSplatSequence : undefined,
        // Gaussian splat settings
        gaussianSplatSettings: clip.source?.type === 'gaussian-splat' ? clip.source.gaussianSplatSettings : undefined,
      };
    });

    return {
      tracks,
      clips: serializableClips,
      playheadPosition: safePlayheadPosition,
      duration,
      durationLocked: durationLocked || undefined,  // Only save if true
      zoom,
      scrollX,
      inPoint,
      outPoint,
      loopPlayback,
      markers: markers.length > 0 ? markers : undefined,  // Only save if there are markers
    };
  },

  // Load timeline state from composition data
  loadState: async (data: CompositionTimelineData | undefined) => {
    const { pause, clearTimeline } = get();
    const wakePreviewAfterRestore = () => {
      layerBuilder.invalidateCache();
      engine.requestRender();
    };
    const primeRestoredWebCodecsPlayer = (
      clip: Pick<TimelineClip, 'startTime' | 'duration' | 'inPoint' | 'outPoint' | 'reversed'>,
      webCodecsPlayer: Pick<WebCodecsPlayer, 'currentTime' | 'seek' | 'hasFrame' | 'getPendingSeekTime' | 'ready'>,
      attempt = 0
    ) => {
      const { isPlaying, playheadPosition } = get();
      if (isPlaying) {
        return;
      }

      const clipEnd = clip.startTime + clip.duration;
      if (playheadPosition < clip.startTime || playheadPosition >= clipEnd) {
        return;
      }

      if (!webCodecsPlayer.ready) {
        if (attempt < 60) {
          setTimeout(() => {
            primeRestoredWebCodecsPlayer(clip, webCodecsPlayer, attempt + 1);
          }, 32);
        }
        return;
      }

      const clipLocalTime = playheadPosition - clip.startTime;
      const unclampedTarget = clip.reversed
        ? clip.outPoint - clipLocalTime
        : clipLocalTime + clip.inPoint;
      const targetTime = Math.max(clip.inPoint, Math.min(clip.outPoint, unclampedTarget));
      const effectiveTime = webCodecsPlayer.getPendingSeekTime?.() ?? webCodecsPlayer.currentTime;

      if ((webCodecsPlayer.hasFrame?.() ?? false) && Math.abs(effectiveTime - targetTime) <= 0.05) {
        wakePreviewAfterRestore();
        return;
      }

      webCodecsPlayer.seek(targetTime);

      // Poll for the seek to produce a frame, then wake the preview.
      // Without this, the LayerCollector drops the layer during the pending
      // seek (pending_unstable), and after the seek resolves the onFrame
      // callback alone may not be enough to break out of idle / cache state.
      const pollForFrame = (pollAttempt: number) => {
        if (pollAttempt > 120) return; // 120 * 16ms ≈ 2s max
        if (!isCurrentTimelineSession()) return;
        if (webCodecsPlayer.hasFrame?.()) {
          wakePreviewAfterRestore();
          return;
        }
        setTimeout(() => pollForFrame(pollAttempt + 1), 16);
      };
      pollForFrame(0);
    };

    // Stop playback
    pause();

    // Clear current timeline
    clearTimeline();
    const timelineSessionId = get().timelineSessionId;
    const isCurrentTimelineSession = () => get().timelineSessionId === timelineSessionId;

    if (!data) {
      // No data - start with fresh default timeline
      set({
        tracks: DEFAULT_TRACKS.map(t => ({ ...t })),
        clips: [],
        playheadPosition: 0,
        duration: 60,
        durationLocked: false,
        zoom: 50,
        scrollX: 0,
        inPoint: null,
        outPoint: null,
        loopPlayback: false,
        playbackSpeed: 1,
        selectedClipIds: new Set(),
        primarySelectedClipId: null,
        markers: [],
      });
      return;
    }

    // Restore tracks and basic state
    // Increment animation key to trigger entrance animations on clips
    const { clipEntranceAnimationKey } = get();
    const safePlayheadPosition = sanitizePlayheadPosition(data.playheadPosition, 0);
    set({
      tracks: data.tracks.map(t => ({ ...t })),
      clips: [], // We'll restore clips separately
      playheadPosition: safePlayheadPosition,
      duration: data.duration,
      durationLocked: data.durationLocked || false,
      zoom: data.zoom,
      scrollX: data.scrollX,
      inPoint: data.inPoint,
      outPoint: data.outPoint,
      loopPlayback: data.loopPlayback,
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      // Clear keyframe state
      clipKeyframes: new Map<string, Keyframe[]>(),
      keyframeRecordingEnabled: new Set<string>(),
      expandedTracks: new Set<string>(data.tracks.filter(t => t.type === 'video').map(t => t.id)),
      expandedTrackPropertyGroups: new Map<string, Set<string>>(),
      selectedKeyframeIds: new Set<string>(),
      expandedCurveProperties: new Map<string, Set<import('../../types').AnimatableProperty>>(),
      // Restore markers
      markers: data.markers || [],
      // Increment animation key for clip entrance animations
      clipEntranceAnimationKey: clipEntranceAnimationKey + 1,
    });

    // Restore keyframes from serialized clips
    const keyframeMap = new Map<string, Keyframe[]>();
    for (const serializedClip of data.clips) {
      if (serializedClip.keyframes && serializedClip.keyframes.length > 0) {
        keyframeMap.set(serializedClip.id, serializedClip.keyframes);
      }
    }
    if (keyframeMap.size > 0) {
      set({ clipKeyframes: keyframeMap });
    }

    // Restore clips - need to recreate media elements from file references
    const mediaStore = useMediaStore.getState();
    const getPrimitiveMeshClipName = (serializedClip: SerializableClip): string => {
      if (serializedClip.meshType === 'text3d') {
        const textName = serializedClip.text3DProperties?.text?.trim().slice(0, 30);
        return textName || serializedClip.name || '3D Text';
      }

      return serializedClip.name || serializedClip.meshType || 'Mesh';
    };
    const createPrimitiveMeshClip = (serializedClip: SerializableClip, clipId = serializedClip.id): TimelineClip => {
      const text3DProperties = serializedClip.text3DProperties
        ? { ...serializedClip.text3DProperties }
        : undefined;

      return {
        id: clipId,
        trackId: serializedClip.trackId,
        name: getPrimitiveMeshClipName(serializedClip),
        file: new File([], `mesh-${serializedClip.meshType}.dat`, { type: 'application/octet-stream' }),
        mediaFileId: serializedClip.mediaFileId || undefined,
        startTime: serializedClip.startTime,
        duration: serializedClip.duration,
        inPoint: serializedClip.inPoint,
        outPoint: serializedClip.outPoint,
        source: {
          type: 'model',
          meshType: serializedClip.meshType,
          mediaFileId: serializedClip.mediaFileId || undefined,
          naturalDuration: Number.MAX_SAFE_INTEGER,
          threeDEffectorsEnabled: serializedClip.threeDEffectorsEnabled ?? true,
          ...(text3DProperties ? { text3DProperties } : {}),
        },
        thumbnails: serializedClip.thumbnails,
        linkedClipId: serializedClip.linkedClipId,
        linkedGroupId: serializedClip.linkedGroupId,
        transform: serializedClip.transform,
        effects: serializedClip.effects || [],
        colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
        nodeGraph: restoreClipNodeGraph(serializedClip),
        masks: serializedClip.masks,
        reversed: serializedClip.reversed,
        speed: serializedClip.speed,
        preservesPitch: serializedClip.preservesPitch,
        is3D: serializedClip.is3D ?? true,
        meshType: serializedClip.meshType,
        text3DProperties,
        wireframe: false,
        isLoading: false,
      };
    };
    const isMotionSourceType = (sourceType: SerializableClip['sourceType']): sourceType is 'motion-shape' | 'motion-null' | 'motion-adjustment' => (
      sourceType === 'motion-shape' ||
      sourceType === 'motion-null' ||
      sourceType === 'motion-adjustment'
    );
    const createMotionClip = (serializedClip: SerializableClip, clipId = serializedClip.id): TimelineClip | null => {
      if (!isMotionSourceType(serializedClip.sourceType) || !serializedClip.motion) {
        return null;
      }

      return {
        id: clipId,
        trackId: serializedClip.trackId,
        name: serializedClip.name || 'Motion',
        file: new File([JSON.stringify(serializedClip.motion)], `${serializedClip.sourceType}.msmotion`, { type: 'application/json' }),
        mediaFileId: serializedClip.mediaFileId || undefined,
        startTime: serializedClip.startTime,
        duration: serializedClip.duration,
        inPoint: serializedClip.inPoint,
        outPoint: serializedClip.outPoint,
        source: {
          type: serializedClip.sourceType,
          mediaFileId: serializedClip.mediaFileId || undefined,
          naturalDuration: serializedClip.duration,
        },
        motion: structuredClone(serializedClip.motion),
        thumbnails: serializedClip.thumbnails,
        linkedClipId: serializedClip.linkedClipId,
        linkedGroupId: serializedClip.linkedGroupId,
        transform: serializedClip.transform,
        effects: serializedClip.effects || [],
        colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
        nodeGraph: restoreClipNodeGraph(serializedClip),
        masks: serializedClip.masks,
        speed: serializedClip.speed,
        preservesPitch: serializedClip.preservesPitch,
        isLoading: false,
      };
    };

    for (const serializedClip of data.clips) {
      // Handle composition clips specially
      if (serializedClip.isComposition && serializedClip.compositionId) {
        const composition = mediaStore.compositions.find(c => c.id === serializedClip.compositionId);
        if (composition) {
          // Check if this is a composition AUDIO clip (linked audio for nested comp)
          if (serializedClip.sourceType === 'audio') {
            // Create composition audio clip - will regenerate mixdown
            const compAudioClip: TimelineClip = {
              id: serializedClip.id,
              trackId: serializedClip.trackId,
              name: serializedClip.name,
              file: new File([], serializedClip.name),
              startTime: serializedClip.startTime,
              duration: serializedClip.duration,
              inPoint: serializedClip.inPoint,
              outPoint: serializedClip.outPoint,
              source: {
                type: 'audio',
                audioElement: document.createElement('audio'),
                naturalDuration: serializedClip.duration,
              },
              linkedClipId: serializedClip.linkedClipId,
              waveform: serializedClip.waveform || [],
              transform: serializedClip.transform,
              effects: serializedClip.effects || [],
              colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
              nodeGraph: restoreClipNodeGraph(serializedClip),
              isLoading: false,
              isComposition: true,
              compositionId: serializedClip.compositionId,
              speed: serializedClip.speed,
              preservesPitch: serializedClip.preservesPitch,
            };

            // Add clip to state
            set(state => ({
              clips: [...state.clips, compAudioClip],
            }));

            // Regenerate audio mixdown in background
            import('../../services/compositionAudioMixer').then(async ({ compositionAudioMixer }) => {
              try {
                log.debug('Regenerating audio mixdown', { composition: composition.name });
                const mixdownResult = await compositionAudioMixer.mixdownComposition(composition.id);

                if (mixdownResult && mixdownResult.hasAudio) {
                  const mixdownAudio = compositionAudioMixer.createAudioElement(mixdownResult.buffer);
                  mixdownAudio.preload = 'auto';

                  set(state => ({
                    clips: state.clips.map(c =>
                      c.id === compAudioClip.id
                        ? {
                            ...c,
                            source: {
                              type: 'audio' as const,
                              audioElement: mixdownAudio,
                              naturalDuration: mixdownResult.duration,
                            },
                            waveform: mixdownResult.waveform,
                            mixdownBuffer: mixdownResult.buffer,
                            hasMixdownAudio: true,
                          }
                        : c
                    ),
                  }));
                  log.debug('Audio mixdown restored', { composition: composition.name });
                } else {
                  // No audio - generate flat waveform
                  const flatWaveform = new Array(Math.max(1, Math.floor(serializedClip.duration * 50))).fill(0);
                  set(state => ({
                    clips: state.clips.map(c =>
                      c.id === compAudioClip.id
                        ? { ...c, waveform: flatWaveform, hasMixdownAudio: false }
                        : c
                    ),
                  }));
                }
              } catch (e) {
                log.error('Failed to regenerate audio mixdown', e);
              }
            });

            continue;
          }

          // Create comp VIDEO clip manually to restore specific settings
          const compClip: TimelineClip = {
            id: serializedClip.id,
            trackId: serializedClip.trackId,
            name: serializedClip.name,
            file: new File([], serializedClip.name),
            startTime: serializedClip.startTime,
            duration: serializedClip.duration,
            inPoint: serializedClip.inPoint,
            outPoint: serializedClip.outPoint,
            source: {
              type: 'video',
              naturalDuration: serializedClip.duration,
            },
            thumbnails: serializedClip.thumbnails,
            linkedClipId: serializedClip.linkedClipId,
            transform: serializedClip.transform,
            effects: serializedClip.effects || [],
            colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
            nodeGraph: restoreClipNodeGraph(serializedClip),
            masks: serializedClip.masks || [],  // Restore masks for composition clips
            isLoading: true,
            isComposition: true,
            compositionId: serializedClip.compositionId,
            nestedClips: [],
            nestedTracks: [],
            speed: serializedClip.speed,
            preservesPitch: serializedClip.preservesPitch,
          };

          // Add clip to state
          set(state => ({
            clips: [...state.clips, compClip],
          }));

          // Load nested composition content in background
          if (composition.timelineData) {
            const nestedClips: TimelineClip[] = [];
            const nestedTracks = composition.timelineData.tracks;

            log.info('Loading nested clips for comp', {
              compClipId: compClip.id,
              compositionId: composition.id,
              compositionName: composition.name,
              nestedClipCount: composition.timelineData.clips.length,
              nestedClips: composition.timelineData.clips.map((c: SerializableClip) => ({
                id: c.id,
                name: c.name,
                trackId: c.trackId,
                mediaFileId: c.mediaFileId,
                sourceType: c.sourceType,
              })),
              availableMediaFiles: mediaStore.files.map(f => ({ id: f.id, name: f.name, hasFile: !!f.file })),
            });

            // Helper to recursively load nested composition clips in loadState
            const loadNestedCompositionClips = (
              parentClipId: string,
              serializedClips: SerializableClip[],
              _parentTracks: TimelineTrack[],
              depth: number
            ): TimelineClip[] => {
              if (depth >= MAX_NESTING_DEPTH) {
                log.warn('Max nesting depth reached in loadState', { parentClipId, depth });
                return [];
              }
              const result: TimelineClip[] = [];
              for (const nsc of serializedClips) {
                // Handle sub-nested composition clips
                if (nsc.isComposition && nsc.compositionId) {
                  const subComp = mediaStore.compositions.find(c => c.id === nsc.compositionId);
                  if (!subComp) {
                    log.warn('Sub-nested composition not found', { clipName: nsc.name, compositionId: nsc.compositionId });
                    continue;
                  }
                  const subClipId = `nested-${parentClipId}-${nsc.id}`;
                  const subDuration = subComp.timelineData?.duration ?? subComp.duration;
                  const subNestedClips = subComp.timelineData
                    ? loadNestedCompositionClips(subClipId, subComp.timelineData.clips, subComp.timelineData.tracks, depth + 1)
                    : [];
                  result.push({
                    id: subClipId,
                    trackId: nsc.trackId,
                    name: nsc.name,
                    file: new File([], subComp.name),
                    startTime: nsc.startTime,
                    duration: nsc.duration,
                    inPoint: nsc.inPoint,
                    outPoint: nsc.outPoint,
                    source: { type: 'video', naturalDuration: subDuration },
                    thumbnails: nsc.thumbnails,
                    transform: nsc.transform,
                    effects: nsc.effects || [],
                    masks: nsc.masks || [],
                    isComposition: true,
                    compositionId: nsc.compositionId,
                    nestedClips: subNestedClips,
                    nestedTracks: subComp.timelineData?.tracks || [],
                    isLoading: false,
                  });
                  log.info('Loaded sub-nested composition in loadState', {
                    subClipId, compositionName: subComp.name, subNestedClipCount: subNestedClips.length, depth: depth + 1,
                  });
                  continue;
                }
                // Regular media clip at this sub-level
                const motionClip = createMotionClip(nsc, `nested-${parentClipId}-${nsc.id}`);
                if (motionClip) {
                  result.push(motionClip);
                  continue;
                }

                if (nsc.sourceType === 'model' && nsc.meshType) {
                  result.push(createPrimitiveMeshClip(nsc, `nested-${parentClipId}-${nsc.id}`));
                  continue;
                }

                if (nsc.sourceType === 'math-scene' && nsc.mathScene) {
                  const clipId = `nested-${parentClipId}-${nsc.id}`;
                  const canvas = mathSceneRenderer.createCanvas();
                  const nc: TimelineClip = {
                    id: clipId,
                    trackId: nsc.trackId,
                    name: nsc.name,
                    file: new File([JSON.stringify(nsc.mathScene)], 'math-scene.json', { type: 'application/json' }),
                    startTime: nsc.startTime,
                    duration: nsc.duration,
                    inPoint: nsc.inPoint,
                    outPoint: nsc.outPoint,
                    source: {
                      type: 'math-scene',
                      textCanvas: canvas,
                      naturalDuration: nsc.duration,
                    },
                    mathScene: structuredClone(nsc.mathScene),
                    thumbnails: nsc.thumbnails,
                    transform: nsc.transform,
                    effects: nsc.effects || [],
                    masks: nsc.masks || [],
                    is3D: nsc.is3D,
                    meshType: nsc.meshType,
                    text3DProperties: nsc.text3DProperties ? { ...nsc.text3DProperties } : undefined,
                    isLoading: false,
                    needsReload: false,
                  };
                  mathSceneRenderer.renderClip(nc, 0);
                  result.push(nc);
                  continue;
                }

                const mf = mediaStore.files.find(f => f.id === nsc.mediaFileId);
                if (!mf) continue;
                const hasBrowserFile = !!mf.file;
                const needsReload = mediaNeedsRelink(mf);
                const nc: TimelineClip = {
                  id: `nested-${parentClipId}-${nsc.id}`,
                  trackId: nsc.trackId,
                  name: nsc.name,
                  file: mf.file || new File([], nsc.name),
                  startTime: nsc.startTime,
                  duration: nsc.duration,
                  inPoint: nsc.inPoint,
                  outPoint: nsc.outPoint,
                  source: hasBrowserFile ? null : {
                    type: nsc.sourceType || 'video',
                    naturalDuration: nsc.naturalDuration || nsc.duration,
                    mediaFileId: nsc.mediaFileId,
                    threeDEffectorsEnabled: nsc.threeDEffectorsEnabled ?? true,
                    ...(nsc.meshType ? { meshType: nsc.meshType } : {}),
                    ...(nsc.text3DProperties ? { text3DProperties: { ...nsc.text3DProperties } } : {}),
                  },
                  mediaFileId: nsc.mediaFileId || undefined,
                  thumbnails: nsc.thumbnails,
                  transform: nsc.transform,
                  effects: nsc.effects || [],
                  masks: nsc.masks || [],
                  is3D: nsc.is3D,
                  meshType: nsc.meshType,
                  text3DProperties: nsc.text3DProperties ? { ...nsc.text3DProperties } : undefined,
                  isLoading: hasBrowserFile,
                  needsReload,
                };
                result.push(nc);
                // Load media element for sub-nested clips
                if (hasBrowserFile) {
                  const subFileUrl = URL.createObjectURL(mf.file!);
                  const subType = nsc.sourceType;
                  if (subType === 'video') {
                    const video = document.createElement('video');
                    video.src = subFileUrl;
                    video.muted = true;
                    video.playsInline = true;
                    video.preload = 'auto';
                    video.crossOrigin = 'anonymous';
                    video.load();
                    video.addEventListener('loadedmetadata', () => {
                      if (!isCurrentTimelineSession()) {
                        return;
                      }
                      nc.source = { type: 'video', videoElement: video, naturalDuration: video.duration };
                      nc.isLoading = false;
                      // Trigger state update
                      set(state => ({
                        clips: state.clips.map(c => {
                          if (!c.nestedClips) return c;
                          // Deep update: find the parent comp clip and update its nested clips recursively
                          return { ...c, nestedClips: c.nestedClips.map(inner => inner) };
                        }),
                      }));
                      wakePreviewAfterRestore();
                    }, { once: true });
                  } else if (subType === 'image') {
                    const img = new Image();
                    img.src = subFileUrl;
                    img.addEventListener('load', () => {
                      if (!isCurrentTimelineSession()) {
                        return;
                      }
                      nc.source = { type: 'image', imageElement: img };
                      nc.isLoading = false;
                      wakePreviewAfterRestore();
                    }, { once: true });
                  } else if (subType === 'model') {
                    nc.source = {
                      type: 'model',
                      modelUrl: subFileUrl,
                      naturalDuration: 3600,
                      mediaFileId: nsc.mediaFileId,
                      ...(nsc.meshType ? { meshType: nsc.meshType } : {}),
                      ...(nsc.text3DProperties ? { text3DProperties: { ...nsc.text3DProperties } } : {}),
                    };
                    nc.is3D = true;
                    nc.meshType = nsc.meshType;
                    nc.text3DProperties = nsc.text3DProperties ? { ...nsc.text3DProperties } : undefined;
                    nc.isLoading = false;
                  }
                }
              }
              return result;
            };

            for (const nestedSerializedClip of composition.timelineData.clips) {
              // Handle nested composition clips (Level 3+)
              if (nestedSerializedClip.isComposition && nestedSerializedClip.compositionId) {
                const subComp = mediaStore.compositions.find(c => c.id === nestedSerializedClip.compositionId);
                if (!subComp) {
                  log.warn('Nested composition not found in loadState', {
                    clipName: nestedSerializedClip.name,
                    compositionId: nestedSerializedClip.compositionId,
                  });
                  continue;
                }
                const nestedClipId = `nested-${compClip.id}-${nestedSerializedClip.id}`;
                const subDuration = subComp.timelineData?.duration ?? subComp.duration;
                const subNestedClips = subComp.timelineData
                  ? loadNestedCompositionClips(nestedClipId, subComp.timelineData.clips, subComp.timelineData.tracks, 1)
                  : [];
                const nestedClip: TimelineClip = {
                  id: nestedClipId,
                  trackId: nestedSerializedClip.trackId,
                  name: nestedSerializedClip.name,
                  file: new File([], subComp.name),
                  startTime: nestedSerializedClip.startTime,
                  duration: nestedSerializedClip.duration,
                  inPoint: nestedSerializedClip.inPoint,
                  outPoint: nestedSerializedClip.outPoint,
                  source: { type: 'video', naturalDuration: subDuration },
                  thumbnails: nestedSerializedClip.thumbnails,
                  transform: nestedSerializedClip.transform,
                  effects: nestedSerializedClip.effects || [],
                  masks: nestedSerializedClip.masks || [],
                  isComposition: true,
                  compositionId: nestedSerializedClip.compositionId,
                  nestedClips: subNestedClips,
                  nestedTracks: subComp.timelineData?.tracks || [],
                  isLoading: false,
                };
                nestedClips.push(nestedClip);
                log.info('Loaded nested composition in loadState', {
                  nestedClipId, compositionName: subComp.name, subNestedClipCount: subNestedClips.length,
                });
                continue;
              }

              if (nestedSerializedClip.sourceType === 'model' && nestedSerializedClip.meshType) {
                nestedClips.push(
                  createPrimitiveMeshClip(
                    nestedSerializedClip,
                    `nested-${compClip.id}-${nestedSerializedClip.id}`,
                  ),
                );
                continue;
              }

              if (nestedSerializedClip.sourceType === 'math-scene' && nestedSerializedClip.mathScene) {
                const canvas = mathSceneRenderer.createCanvas();
                const nestedClip: TimelineClip = {
                  id: `nested-${compClip.id}-${nestedSerializedClip.id}`,
                  trackId: nestedSerializedClip.trackId,
                  name: nestedSerializedClip.name,
                  file: new File([JSON.stringify(nestedSerializedClip.mathScene)], 'math-scene.json', { type: 'application/json' }),
                  startTime: nestedSerializedClip.startTime,
                  duration: nestedSerializedClip.duration,
                  inPoint: nestedSerializedClip.inPoint,
                  outPoint: nestedSerializedClip.outPoint,
                  source: {
                    type: 'math-scene',
                    textCanvas: canvas,
                    naturalDuration: nestedSerializedClip.duration,
                  },
                  mathScene: structuredClone(nestedSerializedClip.mathScene),
                  thumbnails: nestedSerializedClip.thumbnails,
                  transform: nestedSerializedClip.transform,
                  effects: nestedSerializedClip.effects || [],
                  masks: nestedSerializedClip.masks || [],
                  is3D: nestedSerializedClip.is3D,
                  meshType: nestedSerializedClip.meshType,
                  text3DProperties: nestedSerializedClip.text3DProperties ? { ...nestedSerializedClip.text3DProperties } : undefined,
                  isLoading: false,
                  needsReload: false,
                };
                mathSceneRenderer.renderClip(nestedClip, 0);
                nestedClips.push(nestedClip);
                continue;
              }

              const nestedMediaFile = mediaStore.files.find(f => f.id === nestedSerializedClip.mediaFileId);
              const hasBrowserFile = !!(nestedMediaFile?.file);

              if (!nestedMediaFile) {
                log.warn('Skipping nested clip - media file entry not found', {
                  clipName: nestedSerializedClip.name,
                  trackId: nestedSerializedClip.trackId,
                  mediaFileId: nestedSerializedClip.mediaFileId,
                });
                continue;
              }

              // Create the nested clip - even if file is missing (will need reload)
              const nestedClip: TimelineClip = {
                id: `nested-${compClip.id}-${nestedSerializedClip.id}`,
                trackId: nestedSerializedClip.trackId,
                name: nestedSerializedClip.name,
                file: nestedMediaFile.file || new File([], nestedSerializedClip.name),
                startTime: nestedSerializedClip.startTime,
                duration: nestedSerializedClip.duration,
                inPoint: nestedSerializedClip.inPoint,
                outPoint: nestedSerializedClip.outPoint,
                source: hasBrowserFile ? null : {
                  type: nestedSerializedClip.sourceType || 'video',
                  naturalDuration: nestedSerializedClip.naturalDuration || nestedSerializedClip.duration,
                  mediaFileId: nestedSerializedClip.mediaFileId,
                  ...(nestedSerializedClip.meshType ? { meshType: nestedSerializedClip.meshType } : {}),
                  ...(nestedSerializedClip.text3DProperties ? { text3DProperties: { ...nestedSerializedClip.text3DProperties } } : {}),
                },
                mediaFileId: nestedSerializedClip.mediaFileId || undefined,
                thumbnails: nestedSerializedClip.thumbnails,
                transform: nestedSerializedClip.transform,
                effects: nestedSerializedClip.effects || [],
                masks: nestedSerializedClip.masks || [],
                is3D: nestedSerializedClip.is3D,
                meshType: nestedSerializedClip.meshType,
                text3DProperties: nestedSerializedClip.text3DProperties ? { ...nestedSerializedClip.text3DProperties } : undefined,
                isLoading: hasBrowserFile,
                needsReload: mediaNeedsRelink(nestedMediaFile),
              };

              nestedClips.push(nestedClip);

              // Only load media element if file is available
              if (!hasBrowserFile) {
                if (nestedClip.needsReload) {
                  log.warn('Nested clip needs reload - file not available', {
                    clipName: nestedSerializedClip.name,
                    trackId: nestedSerializedClip.trackId,
                    mediaFileId: nestedSerializedClip.mediaFileId,
                  });
                }
                continue;
              }

              if (!nestedMediaFile.file) {
                log.warn('Nested clip skipped - file object not available', {
                  clipName: nestedSerializedClip.name,
                  trackId: nestedSerializedClip.trackId,
                  mediaFileId: nestedSerializedClip.mediaFileId,
                });
                continue;
              }

              // Load media element
              const nestedType = nestedSerializedClip.sourceType;
              const nestedFileRef = nestedMediaFile.file!;
              const nestedFileUrl = URL.createObjectURL(nestedFileRef);

              if (nestedType === 'video') {
                const video = document.createElement('video');
                video.src = nestedFileUrl;
                video.muted = true;
                video.playsInline = true;
                video.preload = 'auto';
                video.crossOrigin = 'anonymous';

                // Force browser to start loading
                video.load();

                // Pre-cache frame for immediate scrubbing (needs readyState >= 2, so use canplaythrough)
                video.addEventListener('canplaythrough', () => {
                  engine.preCacheVideoFrame(video);
                }, { once: true });

                video.addEventListener('loadedmetadata', async () => {
                  if (!isCurrentTimelineSession()) {
                    return;
                  }
                  // Set up basic video source first
                  const videoSource: TimelineClip['source'] = {
                    type: 'video',
                    videoElement: video,
                    naturalDuration: video.duration,
                  };
                  nestedClip.source = videoSource;
                  nestedClip.isLoading = false;

                  // Get or reuse cached WebCodecsPlayer
                  const hasWebCodecs = 'VideoDecoder' in window && 'VideoFrame' in window;
                  const nestedMediaId = nestedSerializedClip.mediaFileId;
                  if (hasWebCodecs && nestedMediaId) {
                    try {
                      const webCodecsPlayer = await getOrCreateWcp(
                        nestedMediaId, video, nestedFileRef.name, nestedFileRef
                      );
                      if (webCodecsPlayer) {
                        nestedClip.source = {
                          ...nestedClip.source,
                          webCodecsPlayer,
                        };
                      }
                    } catch (err) {
                      log.warn('WebCodecsPlayer init failed in nested comp', err);
                    }
                  }

                  if (!isCurrentTimelineSession()) {
                    return;
                  }

                  log.info('Nested video loaded', {
                    nestedClipId: nestedClip.id,
                    nestedClipName: nestedClip.name,
                    compClipId: compClip.id,
                    hasSource: !!nestedClip.source,
                    hasVideoElement: !!nestedClip.source?.videoElement,
                    readyState: video.readyState,
                  });

                  // Properly update state with the new nested clip source
                  // This ensures React/Zustand detects the change
                  set(state => ({
                    clips: state.clips.map(c => {
                      if (c.id !== compClip.id || !c.nestedClips) return c;
                      return {
                        ...c,
                        nestedClips: c.nestedClips.map(nc =>
                          nc.id === nestedClip.id
                            ? { ...nc, source: nestedClip.source, isLoading: false }
                            : nc
                        ),
                      };
                    }),
                  }));
                  wakePreviewAfterRestore();
                }, { once: true });
              } else if (nestedType === 'image') {
                const img = new Image();
                img.src = nestedFileUrl;
                img.addEventListener('load', () => {
                  if (!isCurrentTimelineSession()) {
                    return;
                  }
                  nestedClip.source = {
                    type: 'image',
                    imageElement: img,
                  };
                  nestedClip.isLoading = false;

                  log.info('Nested image loaded', {
                    nestedClipId: nestedClip.id,
                    nestedClipName: nestedClip.name,
                    compClipId: compClip.id,
                  });

                  // Properly update state with the new nested clip source
                  set(state => ({
                    clips: state.clips.map(c => {
                      if (c.id !== compClip.id || !c.nestedClips) return c;
                      return {
                        ...c,
                        nestedClips: c.nestedClips.map(nc =>
                          nc.id === nestedClip.id
                            ? { ...nc, source: nestedClip.source, isLoading: false }
                          : nc
                        ),
                      };
                    }),
                  }));
                  wakePreviewAfterRestore();
                }, { once: true });
              } else if (nestedType === 'model') {
                // 3D model — synchronous, just set blob URL
                nestedClip.source = {
                  type: 'model',
                  modelUrl: nestedFileUrl,
                  naturalDuration: 3600,
                  mediaFileId: nestedSerializedClip.mediaFileId,
                  ...(nestedSerializedClip.meshType ? { meshType: nestedSerializedClip.meshType } : {}),
                  ...(nestedSerializedClip.text3DProperties ? { text3DProperties: { ...nestedSerializedClip.text3DProperties } } : {}),
                };
                nestedClip.is3D = true;
                nestedClip.meshType = nestedSerializedClip.meshType;
                nestedClip.text3DProperties = nestedSerializedClip.text3DProperties ? { ...nestedSerializedClip.text3DProperties } : undefined;
                nestedClip.isLoading = false;

                // Update store so render loop picks it up
                set(state => ({
                  clips: state.clips.map(c => {
                    if (c.id !== compClip.id || !c.nestedClips) return c;
                    return {
                      ...c,
                      nestedClips: c.nestedClips.map(nc =>
                        nc.id === nestedClip.id
                          ? { ...nc, source: nestedClip.source, is3D: true, isLoading: false }
                          : nc
                      ),
                    };
                  }),
                }));
                wakePreviewAfterRestore();
              }
            }

            // Calculate clip boundaries for visual markers and thumbnail alignment
            const compDuration = composition.timelineData?.duration ?? composition.duration;
            const boundaries = calculateNestedClipBoundaries(composition.timelineData, compDuration);

            // Load keyframes for nested clips (important for transforms and effects!)
            const nestedKeyframesMap = new Map<string, Keyframe[]>();
            for (const nestedSerializedClip of composition.timelineData.clips) {
              const nestedClipId = `nested-${compClip.id}-${nestedSerializedClip.id}`;
              if (nestedSerializedClip.keyframes && nestedSerializedClip.keyframes.length > 0) {
                // Update clip IDs in keyframes to match nested clip ID format
                const updatedKeyframes = nestedSerializedClip.keyframes.map((kf: Keyframe) => ({
                  ...kf,
                  clipId: nestedClipId,
                }));
                nestedKeyframesMap.set(nestedClipId, updatedKeyframes);
                log.debug('Loaded keyframes for nested clip in loadState', {
                  nestedClipId,
                  originalClipId: nestedSerializedClip.id,
                  keyframeCount: updatedKeyframes.length,
                });
              }
            }

            // Merge nested keyframes into store
            if (nestedKeyframesMap.size > 0) {
              if (!isCurrentTimelineSession()) {
                return;
              }
              const currentKeyframes = get().clipKeyframes;
              const mergedKeyframes = new Map(currentKeyframes);
              nestedKeyframesMap.forEach((keyframes, clipId) => {
                mergedKeyframes.set(clipId, keyframes);
              });
              set({ clipKeyframes: mergedKeyframes });
            }

            // Update comp clip with nested data and boundaries
            if (!isCurrentTimelineSession()) {
              return;
            }
            set(state => ({
              clips: state.clips.map(c =>
                c.id === compClip.id
                  ? { ...c, nestedClips, nestedTracks, nestedClipBoundaries: boundaries, isLoading: false }
                  : c
              ),
            }));

            // Always generate clip segments on project load (new segment-based thumbnail system)
            if (get().thumbnailsEnabled) {
              // Wait for nested clip sources to load, then build segments
              setTimeout(async () => {
                if (!isCurrentTimelineSession()) {
                  return;
                }
                // Get fresh nested clips (they may have updated sources now)
                const freshCompClip = get().clips.find(c => c.id === compClip.id);
                if (!freshCompClip) {
                  return;
                }
                const freshNestedClips = freshCompClip?.nestedClips || nestedClips;

                const clipSegments = await buildClipSegments(
                  composition.timelineData,
                  compDuration,
                  freshNestedClips
                );

                if (!isCurrentTimelineSession()) {
                  return;
                }
                if (clipSegments.length > 0) {
                  set(state => ({
                    clips: state.clips.map(c =>
                      c.id === compClip.id ? { ...c, clipSegments } : c
                    ),
                  }));
                  log.info('Built clip segments on project load', {
                    clipId: compClip.id,
                    segmentCount: clipSegments.length,
                  });
                }
              }, 1000); // Wait longer on project load for all videos to load
            }
          } else {
            // No timeline data
            if (!isCurrentTimelineSession()) {
              return;
            }
            set(state => ({
              clips: state.clips.map(c =>
                c.id === compClip.id ? { ...c, isLoading: false } : c
              ),
            }));
          }
        } else {
          log.warn('Could not find composition for clip', { clip: serializedClip.name });
        }
        continue;
      }

      const motionClip = createMotionClip(serializedClip);
      if (motionClip) {
        set(state => ({
          clips: [...state.clips, motionClip],
        }));

        log.debug('Restored motion clip', { clip: serializedClip.name, sourceType: serializedClip.sourceType });
        continue;
      }

      // Math Scene clips - restore from serializable scene definition
      if (serializedClip.sourceType === 'math-scene' && serializedClip.mathScene) {
        const { mathSceneRenderer } = await import('../../services/mathScene/MathSceneRenderer');

        const activeComp = mediaStore.getActiveComposition?.();
        const compWidth = activeComp?.width || 1920;
        const compHeight = activeComp?.height || 1080;
        const canvas = mathSceneRenderer.createCanvas(compWidth, compHeight);
        mathSceneRenderer.render(serializedClip.mathScene, canvas, 0, serializedClip.duration);

        const mathClip: TimelineClip = {
          id: serializedClip.id,
          trackId: serializedClip.trackId,
          name: serializedClip.name || 'Math Scene',
          file: new File([JSON.stringify(serializedClip.mathScene)], 'math-scene.json', { type: 'application/json' }),
          mediaFileId: serializedClip.mediaFileId || undefined,
          startTime: serializedClip.startTime,
          duration: serializedClip.duration,
          inPoint: serializedClip.inPoint,
          outPoint: serializedClip.outPoint,
          source: {
            type: 'math-scene',
            textCanvas: canvas,
            mediaFileId: serializedClip.mediaFileId || undefined,
            naturalDuration: serializedClip.duration,
          },
          mathScene: serializedClip.mathScene,
          transform: serializedClip.transform,
          effects: serializedClip.effects || [],
          colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
          nodeGraph: restoreClipNodeGraph(serializedClip),
          masks: serializedClip.masks,
          speed: serializedClip.speed,
          preservesPitch: serializedClip.preservesPitch,
          isLoading: false,
        };

        set(state => ({
          clips: [...state.clips, mathClip],
        }));

        log.debug('Restored math scene clip', { clip: serializedClip.name });
        continue;
      }

      // Text clips - restore from textProperties
      if (serializedClip.sourceType === 'text' && serializedClip.textProperties) {
        const { textRenderer } = await import('../../services/textRenderer');
        const { googleFontsService } = await import('../../services/googleFontsService');

        // Load the font first
        await googleFontsService.loadFont(
          serializedClip.textProperties.fontFamily,
          serializedClip.textProperties.fontWeight
        );

        // Render text to canvas
        const textCanvas = textRenderer.render(serializedClip.textProperties);

        const textClip: TimelineClip = {
          id: serializedClip.id,
          trackId: serializedClip.trackId,
          name: serializedClip.name,
          file: new File([], 'text-clip.txt', { type: 'text/plain' }),
          mediaFileId: serializedClip.mediaFileId || undefined,
          startTime: serializedClip.startTime,
          duration: serializedClip.duration,
          inPoint: serializedClip.inPoint,
          outPoint: serializedClip.outPoint,
          source: {
            type: 'text',
            textCanvas,
            mediaFileId: serializedClip.mediaFileId || undefined,
            naturalDuration: serializedClip.duration,
          },
          transform: serializedClip.transform,
          effects: serializedClip.effects || [],
          colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
          nodeGraph: restoreClipNodeGraph(serializedClip),
          masks: serializedClip.masks,
          textProperties: serializedClip.textProperties,
          speed: serializedClip.speed,
          preservesPitch: serializedClip.preservesPitch,
          isLoading: false,
        };

        // Add clip to state
        set(state => ({
          clips: [...state.clips, textClip],
        }));

        log.debug('Restored text clip', { clip: serializedClip.name });
        continue;
      }

      // Solid clips - restore from solidColor
      if (serializedClip.sourceType === 'solid' && serializedClip.solidColor) {
        const color = serializedClip.solidColor;
        // Use active composition dimensions, fallback to 1920x1080
        const activeComp = mediaStore.getActiveComposition?.();
        const compWidth = activeComp?.width || 1920;
        const compHeight = activeComp?.height || 1080;
        const canvas = document.createElement('canvas');
        canvas.width = compWidth;
        canvas.height = compHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, compWidth, compHeight);

        const solidClip: TimelineClip = {
          id: serializedClip.id,
          trackId: serializedClip.trackId,
          name: serializedClip.name,
          file: new File([], 'solid-clip.dat', { type: 'application/octet-stream' }),
          mediaFileId: serializedClip.mediaFileId || undefined,
          startTime: serializedClip.startTime,
          duration: serializedClip.duration,
          inPoint: serializedClip.inPoint,
          outPoint: serializedClip.outPoint,
          source: {
            type: 'solid',
            textCanvas: canvas,
            mediaFileId: serializedClip.mediaFileId || undefined,
            naturalDuration: serializedClip.duration,
          },
          transform: serializedClip.transform,
          effects: serializedClip.effects || [],
          colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
          nodeGraph: restoreClipNodeGraph(serializedClip),
          masks: serializedClip.masks,
          solidColor: color,
          speed: serializedClip.speed,
          preservesPitch: serializedClip.preservesPitch,
          isLoading: false,
        };

        set(state => ({
          clips: [...state.clips, solidClip],
        }));

        log.debug('Restored solid clip', { clip: serializedClip.name, color });
        continue;
      }

      // Camera clips - restore shared scene camera controls
      if (serializedClip.sourceType === 'camera') {
        const { DEFAULT_SCENE_CAMERA_SETTINGS } = await import('../mediaStore/types');

        const cameraClip: TimelineClip = {
          id: serializedClip.id,
          trackId: serializedClip.trackId,
          name: serializedClip.name || 'Camera',
          file: new File([], 'camera-clip.dat', { type: 'application/octet-stream' }),
          mediaFileId: serializedClip.mediaFileId || undefined,
          startTime: serializedClip.startTime,
          duration: serializedClip.duration,
          inPoint: serializedClip.inPoint,
          outPoint: serializedClip.outPoint,
          source: {
            type: 'camera',
            cameraSettings: serializedClip.cameraSettings || { ...DEFAULT_SCENE_CAMERA_SETTINGS },
            mediaFileId: serializedClip.mediaFileId || undefined,
            naturalDuration: Number.MAX_SAFE_INTEGER,
          },
          transform: serializedClip.transform,
          effects: serializedClip.effects || [],
          colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
          nodeGraph: restoreClipNodeGraph(serializedClip),
          masks: serializedClip.masks,
          speed: serializedClip.speed,
          preservesPitch: serializedClip.preservesPitch,
          isLoading: false,
        };

        set(state => ({
          clips: [...state.clips, cameraClip],
        }));

        log.debug('Restored camera clip', { clip: serializedClip.name });
        continue;
      }

      if (serializedClip.sourceType === 'splat-effector') {
        const { DEFAULT_SPLAT_EFFECTOR_SETTINGS } = await import('../../types/splatEffector');

        const effectorClip: TimelineClip = {
          id: serializedClip.id,
          trackId: serializedClip.trackId,
          name: serializedClip.name || '3D Effector',
          file: new File([], 'splat-effector.dat', { type: 'application/octet-stream' }),
          mediaFileId: serializedClip.mediaFileId || undefined,
          startTime: serializedClip.startTime,
          duration: serializedClip.duration,
          inPoint: serializedClip.inPoint,
          outPoint: serializedClip.outPoint,
          source: {
            type: 'splat-effector',
            splatEffectorSettings: serializedClip.splatEffectorSettings || { ...DEFAULT_SPLAT_EFFECTOR_SETTINGS },
            mediaFileId: serializedClip.mediaFileId || undefined,
            naturalDuration: Number.MAX_SAFE_INTEGER,
          },
          transform: serializedClip.transform,
          effects: serializedClip.effects || [],
          colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
          nodeGraph: restoreClipNodeGraph(serializedClip),
          masks: serializedClip.masks,
          speed: serializedClip.speed,
          preservesPitch: serializedClip.preservesPitch,
          is3D: serializedClip.is3D ?? true,
          isLoading: false,
        };

        set((state) => ({
          clips: [...state.clips, effectorClip],
        }));

        log.debug('Restored splat effector clip', { clip: serializedClip.name });
        continue;
      }

      // Primitive mesh clips - restore without a backing media file
      if (serializedClip.sourceType === 'model' && serializedClip.meshType) {
        const meshClip = createPrimitiveMeshClip(serializedClip);

        set(state => ({
          clips: [...state.clips, meshClip],
        }));

        log.debug('Restored mesh clip', { clip: serializedClip.name, meshType: serializedClip.meshType });
        continue;
      }

      // Regular media clips
      const mediaFile = mediaStore.files.find(f => f.id === serializedClip.mediaFileId);
      if (!mediaFile) {
        log.warn('Media file not found for clip', { clip: serializedClip.name, mediaFileId: serializedClip.mediaFileId });
        continue;
      }

      // Create the clip - even if the browser File object is not in memory.
      // Native-helper projects can restore from persisted project/absolute paths.
      const needsReload = mediaNeedsRelink(mediaFile);
      if (needsReload) {
        log.debug('Clip needs reload (file permission required)', { clip: serializedClip.name });
      }

      // Create placeholder file if missing
      const file = mediaFile.file || new File([], mediaFile.name || 'pending', { type: 'video/mp4' });
      const restoredModelSequence: ModelSequenceData | undefined = serializedClip.sourceType === 'model'
        ? resolveModelSequenceData(serializedClip.modelSequence, mediaFile.modelSequence)
        : undefined;
      const restoredGaussianSplatSequence: GaussianSplatSequenceData | undefined = serializedClip.sourceType === 'gaussian-splat'
        ? resolveGaussianSplatSequenceData(serializedClip.gaussianSplatSequence, mediaFile.gaussianSplatSequence)
        : undefined;
      const restoredGaussianSplatSettings = serializedClip.sourceType === 'gaussian-splat'
        ? resolveGaussianSplatSettingsForSource(serializedClip.gaussianSplatSettings, {
            fileName:
              restoredGaussianSplatSequence?.frames[0]?.name ??
              mediaFile.file?.name ??
              mediaFile.name,
            sequence: restoredGaussianSplatSequence,
          })
        : undefined;

      // Create the clip with loading state
      const clip: TimelineClip = {
        id: serializedClip.id,
        trackId: serializedClip.trackId,
        name: serializedClip.name || mediaFile.name || 'Untitled',
        file: file,
        startTime: serializedClip.startTime,
        duration: serializedClip.duration,
        inPoint: serializedClip.inPoint,
        outPoint: serializedClip.outPoint,
        source: {
          type: serializedClip.sourceType,
          mediaFileId: serializedClip.mediaFileId, // Preserve mediaFileId for cache lookups
          naturalDuration: serializedClip.naturalDuration,
          vectorAnimationSettings: serializedClip.vectorAnimationSettings,
          threeDEffectorsEnabled: serializedClip.threeDEffectorsEnabled ?? true,
          modelSequence: serializedClip.sourceType === 'model'
            ? restoredModelSequence
            : undefined,
          gaussianSplatSequence: serializedClip.sourceType === 'gaussian-splat'
            ? restoredGaussianSplatSequence
            : undefined,
          gaussianSplatSettings: restoredGaussianSplatSettings,
        },
        mediaFileId: serializedClip.mediaFileId, // Restore top-level mediaFileId for audio/proxy lookup
        needsReload: needsReload, // Flag for UI to show reload indicator
        thumbnails: serializedClip.thumbnails,
        linkedClipId: serializedClip.linkedClipId,
        linkedGroupId: serializedClip.linkedGroupId,
        waveform: serializedClip.waveform,
        transform: serializedClip.transform,
        effects: serializedClip.effects || [],
        colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
        nodeGraph: restoreClipNodeGraph(serializedClip),
        isLoading: true,
        masks: serializedClip.masks,  // Restore masks
        // Restore transcript data
        transcript: serializedClip.transcript,
        transcriptStatus: serializedClip.transcriptStatus || 'none',
        // Restore analysis data
        analysis: serializedClip.analysis,
        analysisStatus: serializedClip.analysisStatus || 'none',
        // Restore playback settings
        reversed: serializedClip.reversed,
        speed: serializedClip.speed,
        preservesPitch: serializedClip.preservesPitch,
        // 3D layer support
        is3D: serializedClip.is3D,
        meshType: serializedClip.meshType,
      };

      // Add clip to state
      set(state => ({
        clips: [...state.clips, clip],
      }));

      // Check for cached analysis in project folder if clip doesn't have analysis but has mediaFileId
      // Try exact range first, then fall back to merged all-ranges
      if (!serializedClip.analysis && serializedClip.mediaFileId && projectFileService.isProjectOpen()) {
        const mfId = serializedClip.mediaFileId;
        projectFileService.getAnalysis(
          mfId,
          serializedClip.inPoint,
          serializedClip.outPoint
        ).then(async cachedAnalysis => {
          // If no exact range match, try merging all available ranges
          if (!cachedAnalysis) {
            cachedAnalysis = await projectFileService.getAllAnalysisMerged(mfId);
          }
          if (cachedAnalysis) {
            log.debug('Loaded analysis from project folder', { clip: serializedClip.name });
            const analysis: ClipAnalysis = {
              frames: cachedAnalysis.frames as FrameAnalysisData[],
              sampleInterval: cachedAnalysis.sampleInterval,
            };
            set(state => ({
              clips: state.clips.map(c =>
                c.id === clip.id
                  ? { ...c, analysis, analysisStatus: 'ready' as const }
                  : c
              ),
            }));
          }
        }).catch(err => {
          log.warn('Failed to load analysis from project folder', err);
        });
      }

      // Skip media loading if the media has no stored path/handle to recover from.
      if (needsReload) {
        log.debug('Skipping media load for clip that needs reload', { clip: clip.name });
        continue;
      }

      // Load media element async
      const type = serializedClip.sourceType;
      let loadFile = mediaFile.file;
      let fileUrl = loadFile ? URL.createObjectURL(loadFile) : mediaFile.url;

      if (
        !loadFile &&
        fileUrl &&
        (type === 'video' || type === 'audio' || type === 'image' || type === 'lottie') &&
        NativeHelperClient.parseFileReferenceUrl(fileUrl)
      ) {
        const referencedFile = await NativeHelperClient.getReferencedFile(fileUrl, mediaFile.name);
        if (referencedFile) {
          loadFile = referencedFile;
          fileUrl = URL.createObjectURL(referencedFile);
          useMediaStore.setState((state) => ({
            files: state.files.map((currentFile) =>
              currentFile.id === mediaFile.id
                ? {
                    ...currentFile,
                    file: referencedFile,
                    url: fileUrl,
                    hasFileHandle: true,
                  }
                : currentFile
            ),
          }));
        }
      }

      if (type === 'video' && !loadFile && mediaFile.absolutePath && projectFileService.activeBackend === 'native') {
        set(state => ({
          clips: state.clips.map(c =>
            c.id === clip.id
              ? {
                  ...c,
                  source: {
                    type: 'video',
                    naturalDuration: serializedClip.naturalDuration || mediaFile.duration || clip.duration,
                    mediaFileId: serializedClip.mediaFileId,
                    filePath: mediaFile.absolutePath,
                  },
                  isLoading: false,
                  needsReload: false,
                }
              : c
          ),
        }));
        continue;
      }

      if (!fileUrl && (type === 'video' || type === 'audio' || type === 'image' || type === 'model' || type === 'gaussian-splat')) {
        log.warn('Skipping media load - no file URL available', { clip: clip.name, mediaFileId: mediaFile.id });
        set(state => ({
          clips: state.clips.map(c => c.id === clip.id ? { ...c, isLoading: false } : c),
        }));
        continue;
      }

      if (type === 'video') {
        const video = document.createElement('video');
        video.src = fileUrl;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.crossOrigin = 'anonymous';

        const hasWebCodecs = 'VideoDecoder' in window && 'VideoFrame' in window;
        const mediaId = serializedClip.mediaFileId;

        // Fast path: if WCP is already cached, attach it immediately — no need to wait for canplaythrough
        const cachedWcp = (hasWebCodecs && mediaId) ? globalWcpCache.get(mediaId) : undefined;
        if (cachedWcp && !cachedWcp.isDestroyed?.()) {
          log.debug('Fast-attaching cached WCP during loadState', { clip: clip.name, mediaId });
          set(state => ({
            clips: state.clips.map(c =>
              c.id === clip.id
                ? {
                    ...c,
                    source: {
                      type: 'video' as const,
                      naturalDuration: serializedClip.naturalDuration || 0,
                      mediaFileId: mediaId,
                      webCodecsPlayer: cachedWcp,
                    },
                    isLoading: false,
                  }
                : c
            ),
          }));
          primeRestoredWebCodecsPlayer(clip, cachedWcp);
          wakePreviewAfterRestore();

          // Still load the video element in background for fallback/thumbnails
          video.addEventListener('canplaythrough', () => {
            set(state => ({
              clips: state.clips.map(c =>
                c.id === clip.id && c.source?.type === 'video'
                  ? {
                      ...c,
                      source: {
                        ...c.source,
                        videoElement: video,
                        naturalDuration: video.duration,
                      },
                    }
                : c
              ),
            }));
            wakePreviewAfterRestore();
            engine.preCacheVideoFrame(video);
            restoreSourceThumbnails(mediaId, video, video.duration || serializedClip.naturalDuration || clip.duration);
          }, { once: true });
        } else {
          // Slow path: no cached WCP — wait for canplaythrough then init
          video.addEventListener('canplaythrough', async () => {
            set(state => ({
              clips: state.clips.map(c =>
                c.id === clip.id
                  ? {
                      ...c,
                      source: {
                        type: 'video',
                        videoElement: video,
                        naturalDuration: video.duration,
                        mediaFileId: serializedClip.mediaFileId,
                      },
                      isLoading: false,
                  }
                : c
              ),
            }));
            wakePreviewAfterRestore();

            engine.preCacheVideoFrame(video);
            restoreSourceThumbnails(mediaId, video, video.duration || serializedClip.naturalDuration || clip.duration);

            if (hasWebCodecs && mediaId) {
              try {
                const webCodecsPlayer = await getOrCreateWcp(
                  mediaId, video, clip.name, loadFile || undefined
                );
                if (webCodecsPlayer) {
                  set(state => ({
                    clips: state.clips.map(c =>
                      c.id === clip.id && c.source?.type === 'video'
                        ? {
                            ...c,
                            source: {
                              ...c.source,
                              webCodecsPlayer,
                            },
                          }
                        : c
                    ),
                  }));
                  primeRestoredWebCodecsPlayer(clip, webCodecsPlayer);
                  wakePreviewAfterRestore();
                }
              } catch (err) {
                log.warn('WebCodecsPlayer init failed for restored clip, using HTMLVideoElement', err);
              }
            }
          }, { once: true });
        }
      } else if (type === 'audio') {
        // Audio clips - create audio element (works for both pure audio files and linked audio from video)
        const audio = document.createElement('audio');
        audio.src = fileUrl;
        audio.preload = 'auto';

        audio.addEventListener('canplaythrough', () => {
          set(state => ({
            clips: state.clips.map(c =>
              c.id === clip.id
                ? {
                    ...c,
                    source: {
                      type: 'audio',
                      audioElement: audio,
                      naturalDuration: audio.duration,
                      mediaFileId: serializedClip.mediaFileId, // Needed for multicam sync
                    },
                    isLoading: false,
                  }
                : c
            ),
          }));
        }, { once: true });
      } else if (type === 'image') {
        const img = new Image();
        img.src = fileUrl;

        img.addEventListener('load', () => {
          set(state => ({
            clips: state.clips.map(c =>
              c.id === clip.id
                ? {
                    ...c,
                    source: { type: 'image', imageElement: img },
                    isLoading: false,
                  }
                : c
            ),
          }));
          wakePreviewAfterRestore();
        }, { once: true });
      } else if (type === 'lottie') {
        if (!loadFile) {
          log.warn('Skipping lottie restore - file object not available', { clip: clip.name });
          set((state) => ({
            clips: state.clips.map((currentClip) =>
              currentClip.id === clip.id
                ? { ...currentClip, isLoading: false, needsReload: mediaNeedsRelink(mediaFile) }
                : currentClip
            ),
          }));
          continue;
        }

        void (async () => {
          try {
            const runtimeClip: TimelineClip = {
              ...clip,
              file: loadFile,
              source: {
                type: 'lottie',
                mediaFileId: serializedClip.mediaFileId,
                naturalDuration: serializedClip.naturalDuration,
                vectorAnimationSettings: serializedClip.vectorAnimationSettings,
              },
            };
            const metadata = await readLottieMetadata(loadFile);
            const runtime = await lottieRuntimeManager.prepareClipSource(runtimeClip, loadFile);
            set((state) => ({
              clips: state.clips.map((currentClip) =>
                currentClip.id === clip.id
                  ? {
                      ...currentClip,
                      file: loadFile,
                      source: {
                        type: 'lottie',
                        textCanvas: runtime.canvas,
                        mediaFileId: serializedClip.mediaFileId,
                        naturalDuration: metadata.duration ?? serializedClip.naturalDuration ?? serializedClip.duration,
                        vectorAnimationSettings: serializedClip.vectorAnimationSettings,
                      },
                      isLoading: false,
                      needsReload: false,
                    }
                  : currentClip
              ),
            }));
            wakePreviewAfterRestore();
          } catch (error) {
            log.warn('Failed to restore lottie clip', { clip: clip.name, error });
            set((state) => ({
              clips: state.clips.map((currentClip) =>
                currentClip.id === clip.id
                  ? { ...currentClip, isLoading: false }
                  : currentClip
              ),
            }));
          }
        })();
      } else if (type === 'model') {
        // 3D Model clips — just need a blob URL, the shared scene renderer handles loading
        const firstModelFrame = restoredModelSequence?.frames[0];
        set(state => ({
          clips: state.clips.map(c =>
            c.id === clip.id
              ? {
                  ...c,
                  source: {
                    type: 'model' as const,
                    modelUrl: firstModelFrame?.modelUrl ?? fileUrl,
                    ...(restoredModelSequence ? { modelSequence: restoredModelSequence } : {}),
                    naturalDuration: serializedClip.naturalDuration || 3600,
                    mediaFileId: serializedClip.mediaFileId,
                    threeDEffectorsEnabled: serializedClip.threeDEffectorsEnabled ?? true,
                    ...(serializedClip.meshType ? { meshType: serializedClip.meshType } : {}),
                    ...(serializedClip.text3DProperties ? { text3DProperties: serializedClip.text3DProperties } : {}),
                  },
                  is3D: true,
                  isLoading: false,
                }
              : c
          ),
        }));
        wakePreviewAfterRestore();
      } else if (type === 'gaussian-avatar') {
        // Gaussian Avatar clips — blob URL for the renderer to load
        set(state => ({
          clips: state.clips.map(c =>
            c.id === clip.id
              ? {
                  ...c,
                  source: {
                    type: 'gaussian-avatar' as const,
                    gaussianAvatarUrl: fileUrl,
                    gaussianBlendshapes: serializedClip.gaussianBlendshapes || {},
                    naturalDuration: serializedClip.naturalDuration || 3600,
                    mediaFileId: serializedClip.mediaFileId,
                  },
                  is3D: true,
                  isLoading: false,
                }
              : c
          ),
        }));
        wakePreviewAfterRestore();
      } else if (type === 'gaussian-splat') {
        // Gaussian Splat clips — blob URL for the renderer to load
        const firstSequenceFrame = restoredGaussianSplatSequence?.frames[0];
        set(state => ({
          clips: state.clips.map(c =>
            c.id === clip.id
              ? {
                  ...c,
                  source: {
                    type: 'gaussian-splat' as const,
                    gaussianSplatUrl:
                      firstSequenceFrame?.splatUrl ??
                      fileUrl,
                    gaussianSplatFileName:
                      firstSequenceFrame?.name ??
                      mediaFile.file?.name ??
                      mediaFile.name,
                    gaussianSplatRuntimeKey:
                      firstSequenceFrame?.projectPath ??
                      firstSequenceFrame?.absolutePath ??
                      firstSequenceFrame?.sourcePath ??
                      firstSequenceFrame?.name,
                    gaussianSplatSequence: restoredGaussianSplatSequence,
                    gaussianSplatSettings: restoredGaussianSplatSettings || DEFAULT_GAUSSIAN_SPLAT_SETTINGS,
                    naturalDuration: serializedClip.naturalDuration || 3600,
                    mediaFileId: serializedClip.mediaFileId,
                    threeDEffectorsEnabled: serializedClip.threeDEffectorsEnabled ?? true,
                  },
                  is3D: true,
                  isLoading: false,
                }
              : c
          ),
        }));
        wakePreviewAfterRestore();
      }
    }
  },

  // Clear all timeline data
  clearTimeline: () => {
    const { clips, pause } = get();

    // Stop playback
    pause();

    // CRITICAL: Clear store state FIRST — synchronously.
    // The rAF render loop reads clips/layers from the store. If we destroy
    // media resources while clips still reference them, the render loop can
    // pass a closed VideoFrame to importExternalTexture → GPU crash.
    const { tracks } = get();
    const nextTimelineSessionId = get().timelineSessionId + 1;
    set({
      clips: [],
      layers: [],
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      cachedFrameTimes: new Set(),
      ramPreviewProgress: null,
      ramPreviewRange: null,
      isRamPreviewing: false,
      clipKeyframes: new Map<string, Keyframe[]>(),
      keyframeRecordingEnabled: new Set<string>(),
      expandedTracks: new Set<string>(tracks.filter(t => t.type === 'video').map(t => t.id)),
      expandedTrackPropertyGroups: new Map<string, Set<string>>(),
      selectedKeyframeIds: new Set<string>(),
      expandedCurveProperties: new Map<string, Set<import('../../types').AnimatableProperty>>(),
      timelineSessionId: nextTimelineSessionId,
    });

    // Clean up media elements. WebCodecsPlayers are NOT destroyed —
    // they're kept in globalWcpCache and reused by the next composition.
    // This avoids re-reading entire video files via file.arrayBuffer()
    // on every comp switch (the #1 cause of OOM crashes).
    const cleanupClip = (clip: TimelineClip) => {
      if (clip.source?.videoElement) {
        const video = clip.source.videoElement;
        video.pause();
        try { if (video.src) URL.revokeObjectURL(video.src); } catch {}
        video.removeAttribute('src');
        video.load();
      }
      if (clip.source?.audioElement) {
        const audio = clip.source.audioElement;
        audio.pause();
        try { if (audio.src) URL.revokeObjectURL(audio.src); } catch {}
        audio.removeAttribute('src');
        audio.load();
      }
      if (clip.source?.type === 'lottie') {
        lottieRuntimeManager.destroyClipRuntime(clip.id);
      }
      // WebCodecsPlayers stay in globalWcpCache — don't destroy them.
      // Pause them so the decoder isn't running while detached.
      if (clip.source?.webCodecsPlayer?.isPlaying) {
        clip.source.webCodecsPlayer.pause();
      }
      if (clip.nestedClips) {
        clip.nestedClips.forEach(cleanupClip);
      }
    };

    clips.forEach(cleanupClip);
    engine.clearCaches();
    layerBuilder.getVideoSyncManager().reset();
  },
});
