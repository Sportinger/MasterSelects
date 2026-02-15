// Clip-related actions slice - Coordinator
// Delegates to specialized modules in ./clip/ and ./helpers/
// Reduced from ~2031 LOC to ~650 LOC (68% reduction)

import type { TimelineClip, TimelineTrack } from '../../types';
import type { CoreClipActions, SliceCreator, Composition } from './types';
import { DEFAULT_TRANSFORM } from './constants';
import { generateWaveform, generateWaveformFromBuffer } from './helpers/waveformHelpers';
import { Logger } from '../../services/logger';

const log = Logger.create('ClipSlice');

/** Deep clone properties that must not be shared between split clips */
function deepCloneClipProps(clip: TimelineClip): Partial<TimelineClip> {
  return {
    transform: structuredClone(clip.transform),
    effects: clip.effects.map(e => structuredClone(e)),
    ...(clip.masks ? { masks: clip.masks.map(m => structuredClone(m)) } : {}),
    ...(clip.textProperties ? { textProperties: structuredClone(clip.textProperties) } : {}),
    ...(clip.transitionIn ? { transitionIn: structuredClone(clip.transitionIn) } : {}),
    ...(clip.transitionOut ? { transitionOut: structuredClone(clip.transitionOut) } : {}),
    ...(clip.analysis ? { analysis: structuredClone(clip.analysis) } : {}),
  };
}

// Import extracted modules
import { detectMediaType } from './helpers/mediaTypeHelpers';
import { loadVideoMedia } from './clip/addVideoClip';
import { createAudioClipPlaceholder, loadAudioMedia } from './clip/addAudioClip';
import { createImageClipPlaceholder, loadImageMedia } from './clip/addImageClip';
// createVideoElement, createAudioElement, initWebCodecsPlayer no longer needed for split
// (split clips share the original element for seamless playback)
import {
  createCompClipPlaceholder,
  loadNestedClips,
  createCompLinkedAudioClip,
  createNestedContentHash,
  calculateNestedClipBoundaries,
  buildClipSegments,
} from './clip/addCompClip';
import {
  generateLinkedClipIds,
} from './helpers/idGenerator';
import { blobUrlManager } from './helpers/blobUrlManager';
import { updateClipById } from './helpers/clipStateHelpers';
import { thumbnailCache } from '../../services/thumbnailCache';

export const createClipSlice: SliceCreator<CoreClipActions> = (set, get) => ({
  addClip: async (trackId, file, startTime, providedDuration, mediaFileId) => {
    const mediaType = detectMediaType(file);
    const estimatedDuration = providedDuration ?? 5;

    log.debug('Adding clip', { mediaType, file: file.name });

    // Validate track exists and matches media type
    const { tracks, clips, updateDuration, thumbnailsEnabled, waveformsEnabled, invalidateCache } = get();
    const targetTrack = tracks.find(t => t.id === trackId);
    if (!targetTrack) {
      log.warn('Track not found', { trackId });
      return;
    }

    if ((mediaType === 'video' || mediaType === 'image') && targetTrack.type !== 'video') {
      log.warn('Cannot add video/image to audio track');
      return;
    }
    if (mediaType === 'audio' && targetTrack.type !== 'audio') {
      log.warn('Cannot add audio to video track');
      return;
    }

    // Helper to update clip when loaded
    const updateClip = (id: string, updates: Partial<TimelineClip>) => {
      set({ clips: get().clips.map(c => c.id === id ? { ...c, ...updates } : c) });
      get().updateDuration();
    };
    const setClips = (updater: (clips: TimelineClip[]) => TimelineClip[]) => {
      set({ clips: updater(get().clips) });
    };

    // Handle video files
    if (mediaType === 'video') {
      // Use function form of set() to ensure we get fresh state
      // This prevents race conditions when multiple files are dropped at once
      const { videoId: clipId, audioId } = generateLinkedClipIds();
      let finalAudioClipId: string | undefined;

      set(state => {
        const endTime = startTime + estimatedDuration;

        // Find an audio track without overlap
        const audioTracks = state.tracks.filter(t => t.type === 'audio');
        let audioTrackId: string | null = null;

        for (const track of audioTracks) {
          const trackClips = state.clips.filter(c => c.trackId === track.id);
          const hasOverlap = trackClips.some(clip => {
            const clipEnd = clip.startTime + clip.duration;
            return !(endTime <= clip.startTime || startTime >= clipEnd);
          });
          if (!hasOverlap) {
            audioTrackId = track.id;
            break;
          }
        }

        // Create new track if needed
        let newTracks = state.tracks;
        if (!audioTrackId) {
          const newTrackId = `track-${Date.now()}-${Math.random().toString(36).substr(2, 5)}-audio`;
          const newTrack: TimelineTrack = {
            id: newTrackId,
            name: `Audio ${audioTracks.length + 1}`,
            type: 'audio',
            height: 60,
            muted: false,
            visible: true,
            solo: false,
          };
          newTracks = [...state.tracks, newTrack];
          audioTrackId = newTrackId;
        }

        // Create video clip
        const videoClip: TimelineClip = {
          id: clipId,
          trackId,
          name: file.name,
          file,
          startTime,
          duration: estimatedDuration,
          inPoint: 0,
          outPoint: estimatedDuration,
          source: { type: 'video', naturalDuration: estimatedDuration, mediaFileId },
          linkedClipId: audioId,
          transform: { ...DEFAULT_TRANSFORM },
          effects: [],
          isLoading: true,
        };

        // Create audio clip
        const audioClip: TimelineClip = {
          id: audioId,
          trackId: audioTrackId,
          name: `${file.name} (Audio)`,
          file,
          startTime,
          duration: estimatedDuration,
          inPoint: 0,
          outPoint: estimatedDuration,
          source: { type: 'audio', naturalDuration: estimatedDuration, mediaFileId },
          linkedClipId: clipId,
          transform: { ...DEFAULT_TRANSFORM },
          effects: [],
          isLoading: true,
        };

        finalAudioClipId = audioId;

        return {
          clips: [...state.clips, videoClip, audioClip],
          tracks: newTracks,
        };
      });
      updateDuration();

      await loadVideoMedia({
        clipId,
        audioClipId: finalAudioClipId,
        file,
        mediaFileId,
        thumbnailsEnabled,
        waveformsEnabled,
        updateClip,
        setClips,
      });

      invalidateCache();
      return;
    }

    // Handle audio files
    if (mediaType === 'audio') {
      const audioClip = createAudioClipPlaceholder({ trackId, file, startTime, estimatedDuration, mediaFileId });
      set({ clips: [...clips, audioClip] });
      updateDuration();

      await loadAudioMedia({
        clip: audioClip,
        file,
        mediaFileId,
        waveformsEnabled,
        updateClip,
      });

      invalidateCache();
      return;
    }

    // Handle image files
    if (mediaType === 'image') {
      const imageClip = createImageClipPlaceholder({ trackId, file, startTime, estimatedDuration });
      set({ clips: [...clips, imageClip] });
      updateDuration();

      await loadImageMedia({ clip: imageClip, updateClip });
      invalidateCache();
    }
  },

  // Add a composition as a clip (nested composition)
  addCompClip: async (trackId, composition: Composition, startTime) => {
    const { clips, updateDuration, findNonOverlappingPosition, thumbnailsEnabled, invalidateCache } = get();

    const compClip = createCompClipPlaceholder({ trackId, composition, startTime, findNonOverlappingPosition });
    set({ clips: [...clips, compClip] });
    updateDuration();

    // Load nested clips if timeline data exists
    if (composition.timelineData) {
      const nestedClips = await loadNestedClips({ compClipId: compClip.id, composition, get, set });
      const nestedTracks = composition.timelineData.tracks;
      const compDuration = composition.timelineData?.duration ?? composition.duration;

      // Calculate clip boundaries for visual markers
      const boundaries = calculateNestedClipBoundaries(composition.timelineData, compDuration);

      set({
        clips: get().clips.map(c =>
          c.id === compClip.id ? { ...c, nestedClips, nestedTracks, nestedClipBoundaries: boundaries, isLoading: false } : c
        ),
      });

      // Build segment-based thumbnails (waits for nested clips to load)
      if (thumbnailsEnabled) {
        // Wait a bit for nested clip sources to load, then build segments
        setTimeout(async () => {
          // Get fresh nested clips (they may have updated sources now)
          const freshCompClip = get().clips.find(c => c.id === compClip.id);
          const freshNestedClips = freshCompClip?.nestedClips || nestedClips;

          const clipSegments = await buildClipSegments(
            composition.timelineData,
            compDuration,
            freshNestedClips
          );

          if (clipSegments.length > 0) {
            set({
              clips: get().clips.map(c =>
                c.id === compClip.id ? { ...c, clipSegments } : c
              ),
            });
            log.info('Set clip segments for nested comp', { clipId: compClip.id, segmentCount: clipSegments.length });
          }
        }, 500); // Wait for video elements to load
      }
    }

    // Create linked audio clip (always, even if no audio)
    await createCompLinkedAudioClip({
      compClipId: compClip.id,
      composition,
      compClipStartTime: compClip.startTime,
      compDuration: composition.timelineData?.duration ?? composition.duration,
      tracks: get().tracks,
      set,
      get,
    });

    invalidateCache();
  },

  removeClip: (id) => {
    const { clips, selectedClipIds, updateDuration, invalidateCache } = get();
    const clipToRemove = clips.find(c => c.id === id);
    if (!clipToRemove) return;

    // Determine whether to also remove the linked clip:
    // Only remove linked clip if it is also currently selected
    const linkedId = clipToRemove.linkedClipId;
    const removeLinked = !!(linkedId && selectedClipIds.has(linkedId));
    const idsToRemove = new Set([id]);
    if (removeLinked && linkedId) idsToRemove.add(linkedId);

    // Clean up resources for all clips being removed
    for (const removeId of idsToRemove) {
      const clip = clips.find(c => c.id === removeId);
      if (!clip) continue;
      if (clip.source?.type === 'video' && clip.source.videoElement) {
        const video = clip.source.videoElement;
        video.pause();
        video.src = '';
        video.load();
        import('../../engine/WebGPUEngine').then(({ engine }) => engine.cleanupVideo(video));
      }
      if (clip.source?.type === 'audio' && clip.source.audioElement) {
        const audio = clip.source.audioElement;
        audio.pause();
        audio.src = '';
        audio.load();
      }
      blobUrlManager.revokeAll(removeId);
    }

    const newSelectedIds = new Set(selectedClipIds);
    for (const removeId of idsToRemove) newSelectedIds.delete(removeId);

    // Build updated clips: remove the clip(s) and clear linkedClipId on the survivor
    const updatedClips = clips
      .filter(c => !idsToRemove.has(c.id))
      .map(c => {
        // If a surviving clip was linked to a removed clip, clear the link
        if (c.linkedClipId && idsToRemove.has(c.linkedClipId)) {
          return { ...c, linkedClipId: undefined };
        }
        return c;
      });

    set({
      clips: updatedClips,
      selectedClipIds: newSelectedIds,
    });
    updateDuration();
    invalidateCache();
  },

  moveClip: (id, newStartTime, newTrackId, skipLinked = false, skipGroup = false, skipTrim = false, excludeClipIds?: string[]) => {
    const { clips, tracks, updateDuration, getSnappedPosition, getPositionWithResistance, trimOverlappingClips, invalidateCache } = get();
    const movingClip = clips.find(c => c.id === id);
    if (!movingClip) return;

    const targetTrackId = newTrackId ?? movingClip.trackId;

    // Validate track type if changing tracks
    if (newTrackId && newTrackId !== movingClip.trackId) {
      const targetTrack = tracks.find(t => t.id === newTrackId);
      const sourceType = movingClip.source?.type;
      if (targetTrack && sourceType) {
        if ((sourceType === 'video' || sourceType === 'image') && targetTrack.type !== 'video') return;
        if (sourceType === 'audio' && targetTrack.type !== 'audio') return;
      }
    }

    const { startTime: snappedTime } = getSnappedPosition(id, newStartTime, targetTrackId);
    let { startTime: finalStartTime, forcingOverlap, noFreeSpace } = getPositionWithResistance(id, snappedTime, targetTrackId, movingClip.duration, undefined, excludeClipIds);

    // If no free space on target track (cross-track move), find alternative track or create new one
    let actualTrackId = targetTrackId;
    if (noFreeSpace && targetTrackId !== movingClip.trackId) {
      const targetTrack = tracks.find(t => t.id === targetTrackId);
      if (targetTrack) {
        const altTracks = tracks.filter(t =>
          t.type === targetTrack.type && t.id !== targetTrackId && t.id !== movingClip.trackId
        );
        let found = false;
        for (const alt of altTracks) {
          const altResult = getPositionWithResistance(id, snappedTime, alt.id, movingClip.duration, undefined, excludeClipIds);
          if (!altResult.noFreeSpace) {
            actualTrackId = alt.id;
            finalStartTime = altResult.startTime;
            forcingOverlap = altResult.forcingOverlap;
            found = true;
            break;
          }
        }
        if (!found) {
          // No existing track has space — create a new one
          actualTrackId = get().addTrack(targetTrack.type);
          finalStartTime = Math.max(0, snappedTime);
          forcingOverlap = false;
        }
      }
    }

    const timeDelta = finalStartTime - movingClip.startTime;

    const linkedClip = clips.find(c => c.id === movingClip.linkedClipId || c.linkedClipId === id);
    let linkedFinalTime = linkedClip ? linkedClip.startTime + timeDelta : 0;
    let linkedForcingOverlap = false;
    if (linkedClip && !skipLinked) {
      const linkedResult = getPositionWithResistance(linkedClip.id, linkedClip.startTime + timeDelta, linkedClip.trackId, linkedClip.duration, undefined, excludeClipIds);
      linkedFinalTime = linkedResult.startTime;
      linkedForcingOverlap = linkedResult.forcingOverlap;
    }

    const groupClips = !skipGroup && movingClip.linkedGroupId
      ? clips.filter(c => c.linkedGroupId === movingClip.linkedGroupId && c.id !== id)
      : [];

    set({
      clips: clips.map(c => {
        if (c.id === id) return { ...c, startTime: Math.max(0, finalStartTime), trackId: actualTrackId };
        if (!skipLinked && (c.id === movingClip.linkedClipId || c.linkedClipId === id)) {
          return { ...c, startTime: Math.max(0, linkedFinalTime) };
        }
        if (!skipGroup && groupClips.some(gc => gc.id === c.id)) {
          const groupResult = getPositionWithResistance(c.id, c.startTime + timeDelta, c.trackId, c.duration);
          return { ...c, startTime: Math.max(0, groupResult.startTime) };
        }
        return c;
      }),
    });

    if (forcingOverlap && !skipTrim) trimOverlappingClips(id, finalStartTime, actualTrackId, movingClip.duration, excludeClipIds);
    if (linkedForcingOverlap && linkedClip && !skipLinked && !skipTrim) {
      trimOverlappingClips(linkedClip.id, linkedFinalTime, linkedClip.trackId, linkedClip.duration, excludeClipIds);
    }

    updateDuration();
    invalidateCache();
  },

  trimClip: (id, inPoint, outPoint) => {
    const { clips, updateDuration, invalidateCache } = get();
    set({
      clips: clips.map(c => {
        if (c.id !== id) return c;
        return { ...c, inPoint, outPoint, duration: outPoint - inPoint };
      }),
    });
    updateDuration();
    invalidateCache();
  },

  splitClip: (clipId, splitTime) => {
    const { clips, updateDuration, invalidateCache } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;

    const clipEnd = clip.startTime + clip.duration;
    if (splitTime <= clip.startTime || splitTime >= clipEnd) {
      log.warn('Cannot split at edge or outside clip');
      return;
    }

    const firstPartDuration = splitTime - clip.startTime;
    const secondPartDuration = clip.duration - firstPartDuration;
    const splitInSource = clip.inPoint + firstPartDuration;

    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substr(2, 5);

    // Share video/audio elements between split clips on the same track.
    // Since clips on the same track are never active simultaneously, the shared
    // element plays through the cut point seamlessly — zero seek, zero stutter.
    // The pause loop in VideoSyncManager/AudioTrackSyncManager checks for shared
    // elements before pausing, so the playing element won't be interrupted.
    let secondClipSource = clip.source;
    if (clip.source?.type === 'video' && clip.source.videoElement) {
      // Share video element + WebCodecsPlayer — video plays through the cut
      secondClipSource = { ...clip.source };
    } else if (clip.source?.type === 'audio' && clip.source.audioElement) {
      // Share audio element — audio plays through the cut
      secondClipSource = { ...clip.source };
    }

    const firstClip: TimelineClip = {
      ...clip,
      ...deepCloneClipProps(clip),
      id: `clip-${timestamp}-${randomSuffix}-a`,
      duration: firstPartDuration,
      outPoint: splitInSource,
      linkedClipId: undefined,
      transitionOut: undefined,
    };

    const secondClip: TimelineClip = {
      ...clip,
      ...deepCloneClipProps(clip),
      id: `clip-${timestamp}-${randomSuffix}-b`,
      startTime: splitTime,
      duration: secondPartDuration,
      inPoint: splitInSource,
      linkedClipId: undefined,
      source: secondClipSource,
      transitionIn: undefined,
    };

    const newClips: TimelineClip[] = clips.filter(c => c.id !== clipId && c.id !== clip.linkedClipId);

    if (clip.linkedClipId) {
      const linkedClip = clips.find(c => c.id === clip.linkedClipId);
      if (linkedClip) {
        // Share audio element between linked split clips on the same track.
        // Audio plays through the cut point seamlessly — no seek, no overlap.
        // For composition audio (mixdownBuffer), we must create a new element
        // since the mixdown buffer is different per clip segment.
        let linkedSecondSource = linkedClip.source;
        if (linkedClip.source?.type === 'audio' && linkedClip.source.audioElement) {
          if (linkedClip.mixdownBuffer) {
            // Composition audio: needs separate element from mixdown buffer
            import('../../services/compositionAudioMixer').then(({ compositionAudioMixer }) => {
              const newAudio = compositionAudioMixer.createAudioElement(linkedClip.mixdownBuffer!);
              const { clips: currentClips } = get();
              const linkedSecondClipId = `clip-${timestamp}-${randomSuffix}-linked-b`;
              set({
                clips: currentClips.map(c => {
                  if (c.id !== linkedSecondClipId || !c.source) return c;
                  return { ...c, source: { ...c.source, audioElement: newAudio } };
                }),
              });
            });
            linkedSecondSource = { ...linkedClip.source };
          } else {
            // Regular audio: share element — plays through cuts
            linkedSecondSource = { ...linkedClip.source };
          }
        }

        const linkedFirstClip: TimelineClip = {
          ...linkedClip,
          ...deepCloneClipProps(linkedClip),
          id: `clip-${timestamp}-${randomSuffix}-linked-a`,
          duration: firstPartDuration,
          outPoint: linkedClip.inPoint + firstPartDuration,
          linkedClipId: firstClip.id,
        };
        const linkedSecondClip: TimelineClip = {
          ...linkedClip,
          ...deepCloneClipProps(linkedClip),
          id: `clip-${timestamp}-${randomSuffix}-linked-b`,
          startTime: splitTime,
          duration: secondPartDuration,
          inPoint: linkedClip.inPoint + firstPartDuration,
          linkedClipId: secondClip.id,
          source: linkedSecondSource,
        };
        firstClip.linkedClipId = linkedFirstClip.id;
        secondClip.linkedClipId = linkedSecondClip.id;
        newClips.push(linkedFirstClip, linkedSecondClip);
      }
    }

    newClips.push(firstClip, secondClip);
    set({ clips: newClips, selectedClipIds: new Set([secondClip.id]) });
    updateDuration();
    invalidateCache();
    log.debug('Split clip', { clip: clip.name, splitTime: splitTime.toFixed(2) });
  },

  splitClipAtPlayhead: () => {
    const { clips, playheadPosition, selectedClipIds, splitClip } = get();
    const clipsAtPlayhead = clips.filter(c =>
      playheadPosition > c.startTime && playheadPosition < c.startTime + c.duration
    );

    if (clipsAtPlayhead.length === 0) {
      log.warn('No clip at playhead position');
      return;
    }

    let clipsToSplit = selectedClipIds.size > 0
      ? clipsAtPlayhead.filter(c => selectedClipIds.has(c.id))
      : clipsAtPlayhead;

    if (clipsToSplit.length === 0) clipsToSplit = clipsAtPlayhead;

    const linkedClipIds = new Set(clipsToSplit.map(c => c.linkedClipId).filter(Boolean));
    const clipsToSplitFiltered = clipsToSplit.filter(c => !linkedClipIds.has(c.id));

    for (const clip of clipsToSplitFiltered) {
      splitClip(clip.id, playheadPosition);
    }
  },

  updateClip: (id, updates) => {
    const { clips, updateDuration } = get();
    set({ clips: clips.map(c => c.id === id ? { ...c, ...updates } : c) });
    updateDuration();
  },

  updateClipTransform: (id, transform) => {
    const { clips, invalidateCache } = get();
    set({
      clips: clips.map(c => {
        if (c.id !== id) return c;
        return {
          ...c,
          transform: {
            ...c.transform,
            ...transform,
            position: transform.position ? { ...c.transform.position, ...transform.position } : c.transform.position,
            scale: transform.scale ? { ...c.transform.scale, ...transform.scale } : c.transform.scale,
            rotation: transform.rotation ? { ...c.transform.rotation, ...transform.rotation } : c.transform.rotation,
          },
        };
      }),
    });
    invalidateCache();
  },

  toggleClipReverse: (id) => {
    const { clips, invalidateCache } = get();
    const clip = clips.find(c => c.id === id);
    set({
      clips: clips.map(c => {
        if (c.id !== id) return c;
        return {
          ...c,
          reversed: !c.reversed,
        };
      }),
    });
    invalidateCache();
    // Invalidate on-demand thumbnail cache for this media
    const mediaFileId = clip?.mediaFileId || clip?.source?.mediaFileId;
    if (mediaFileId) {
      thumbnailCache.invalidate(mediaFileId);
    }
  },

  // ========== WAVEFORM GENERATION ==========

  generateWaveformForClip: async (clipId: string) => {
    const { clips } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || clip.waveformGenerating) return;

    set({ clips: updateClipById(get().clips, clipId, { waveformGenerating: true, waveformProgress: 0 }) });
    log.debug('Starting waveform generation', { clip: clip.name });

    try {
      let waveform: number[];

      if (clip.isComposition && clip.compositionId) {
        const { compositionAudioMixer } = await import('../../services/compositionAudioMixer');
        const mixdownResult = await compositionAudioMixer.mixdownComposition(clip.compositionId);

        if (mixdownResult?.hasAudio) {
          waveform = mixdownResult.waveform;
          const mixdownAudio = compositionAudioMixer.createAudioElement(mixdownResult.buffer);
          set({
            clips: updateClipById(get().clips, clipId, {
              source: { type: 'audio' as const, audioElement: mixdownAudio, naturalDuration: mixdownResult.duration },
              mixdownBuffer: mixdownResult.buffer,
              hasMixdownAudio: true,
            }),
          });
        } else if (clip.mixdownBuffer) {
          waveform = generateWaveformFromBuffer(clip.mixdownBuffer, 50);
        } else {
          waveform = new Array(Math.max(1, Math.floor(clip.duration * 50))).fill(0);
        }
      } else if (!clip.file) {
        log.warn('No file found for clip', { clipId });
        set({ clips: updateClipById(get().clips, clipId, { waveformGenerating: false }) });
        return;
      } else {
        waveform = await generateWaveform(clip.file, 50, (progress, partialWaveform) => {
          set({ clips: updateClipById(get().clips, clipId, { waveformProgress: progress, waveform: partialWaveform }) });
        });
      }

      log.debug('Waveform complete', { samples: waveform.length, clip: clip.name });
      set({ clips: updateClipById(get().clips, clipId, { waveform, waveformGenerating: false, waveformProgress: 100 }) });
    } catch (e) {
      log.error('Waveform generation failed', e);
      set({ clips: updateClipById(get().clips, clipId, { waveformGenerating: false }) });
    }
  },

  // ========== PARENTING (PICK WHIP) ==========

  setClipParent: (clipId: string, parentClipId: string | null) => {
    const { clips } = get();
    if (parentClipId === clipId) {
      log.warn('Cannot parent clip to itself');
      return;
    }

    if (parentClipId) {
      const wouldCreateCycle = (checkId: string): boolean => {
        const check = clips.find(c => c.id === checkId);
        if (!check?.parentClipId) return false;
        if (check.parentClipId === clipId) return true;
        return wouldCreateCycle(check.parentClipId);
      };
      if (wouldCreateCycle(parentClipId)) {
        log.warn('Cannot create circular parent reference');
        return;
      }
    }

    set({ clips: clips.map(c => c.id === clipId ? { ...c, parentClipId: parentClipId || undefined } : c) });
    log.debug('Set clip parent', { clipId, parentClipId: parentClipId || 'none' });
  },

  getClipChildren: (clipId: string) => {
    return get().clips.filter(c => c.parentClipId === clipId);
  },

  setClipPreservesPitch: (clipId: string, preservesPitch: boolean) => {
    set({ clips: updateClipById(get().clips, clipId, { preservesPitch }) });
  },

  // Refresh nested clips when source composition changes
  refreshCompClipNestedData: async (sourceCompositionId: string) => {
    const { clips, invalidateCache } = get();

    log.info('refreshCompClipNestedData called', {
      sourceCompositionId,
      totalClips: clips.length,
      compClips: clips.filter(c => c.isComposition).map(c => ({
        id: c.id,
        name: c.name,
        compositionId: c.compositionId,
      })),
    });

    // Find all comp clips that reference this composition
    const compClips = clips.filter(c => c.isComposition && c.compositionId === sourceCompositionId);
    if (compClips.length === 0) {
      log.info('No comp clips found referencing this composition');
      return;
    }

    // Get the updated composition
    const { useMediaStore } = await import('../mediaStore');
    const composition = useMediaStore.getState().compositions.find(c => c.id === sourceCompositionId);
    if (!composition?.timelineData) {
      log.debug('No timelineData for composition', { sourceCompositionId });
      return;
    }

    // Create a content hash to detect changes (clips, effects, duration)
    const newContentHash = createNestedContentHash(composition.timelineData);

    log.info('Refreshing nested clips for composition', {
      compositionId: sourceCompositionId,
      compositionName: composition.name,
      affectedClips: compClips.length,
      newClipCount: composition.timelineData.clips.length,
      newTrackCount: composition.timelineData.tracks.length,
    });

    // Reload nested clips for each comp clip
    for (const compClip of compClips) {
      // Check if content actually changed (compare hashes)
      const oldContentHash = compClip.nestedContentHash;
      const needsThumbnailUpdate = oldContentHash !== newContentHash;

      // Load updated nested clips
      const nestedClips = await loadNestedClips({
        compClipId: compClip.id,
        composition,
        get,
        set,
      });
      const nestedTracks = composition.timelineData.tracks;
      const compDuration = composition.timelineData?.duration ?? composition.duration;

      // Calculate clip boundaries for visual markers
      const nestedClipBoundaries = calculateNestedClipBoundaries(composition.timelineData, compDuration);

      // Update the comp clip with new nested data, content hash, and boundaries
      // IMPORTANT: Preserve existing clipSegments if no thumbnail update needed
      set({
        clips: get().clips.map(c =>
          c.id === compClip.id
            ? {
                ...c,
                nestedClips,
                nestedTracks,
                nestedContentHash: newContentHash,
                nestedClipBoundaries,
                // Keep existing clipSegments if not regenerating
                clipSegments: needsThumbnailUpdate ? undefined : c.clipSegments,
              }
            : c
        ),
      });

      // Only regenerate thumbnails if content actually changed
      if (needsThumbnailUpdate && get().thumbnailsEnabled) {
        // Wait a bit for nested clip sources to load, then build segments
        setTimeout(async () => {
          // Get fresh nested clips (they may have updated sources now)
          const freshCompClip = get().clips.find(c => c.id === compClip.id);
          const freshNestedClips = freshCompClip?.nestedClips || nestedClips;

          const clipSegments = await buildClipSegments(
            composition.timelineData,
            compDuration,
            freshNestedClips
          );

          if (clipSegments.length > 0) {
            set({
              clips: get().clips.map(c =>
                c.id === compClip.id ? { ...c, clipSegments } : c
              ),
            });
            log.info('Updated clip segments for nested comp', {
              clipId: compClip.id,
              segmentCount: clipSegments.length,
            });
          }
        }, 500); // Wait for video elements to load
      } else {
        log.debug('Skipped segment regeneration (no content change or thumbnails disabled)', {
          compClipId: compClip.id,
        });
      }
    }

    invalidateCache();
  },
});
