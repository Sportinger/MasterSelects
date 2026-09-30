// Multicam editing on the active composition: one video track per camera.
// Enabling keeps the topmost camera per moment and links every synchronized
// clip; keys 1..n then cut (playing) or switch a segment (paused). Program
// pieces are ordinary clips, so export, effects and grading stay unchanged.

import type { MulticamActions, SliceCreator } from './types';
import type { TimelineClip } from '../../types';
import type { CompositionMulticam } from '../../types/multicam';
import { captureSnapshot } from '../historyStore';
import { useMediaStore } from '../mediaStore';
import { Logger } from '../../services/logger';
import { getPlayheadPosition } from '../../services/layerBuilder/PlayheadState';
import { renderHostPort } from '../../services/render/renderHostPort';
import { bindRuntimeToClip } from '../../services/mediaRuntime/clipBindings';
import {
  captureMulticamAngles,
  isRangeShowingAngle,
  planAngleSwitch,
  planInitialProgram,
  type MulticamPiece,
} from '../../services/multicam/multicamPlan';
import { applyRangeEditOperation } from './editOperations/rangeOperations';
import { cleanupDeletedClipResources } from './deletedClipResources';
import { generateClipId, generateManualLinkedGroupId } from './helpers/idGenerator';

const log = Logger.create('Multicam');

function getActiveMulticam(): { compositionId: string; multicam: CompositionMulticam } | null {
  const mediaState = useMediaStore.getState();
  const compositionId = mediaState.activeCompositionId;
  const multicam = mediaState.compositions.find((composition) => composition.id === compositionId)?.multicam;
  return compositionId && multicam ? { compositionId, multicam } : null;
}

/** An ordinary video clip for one program piece, bound to its media runtime. */
function buildProgramClip(piece: MulticamPiece, trackId: string, groupId: string): TimelineClip | null {
  const { source } = piece;
  const mediaFile = useMediaStore.getState().files.find((file) => file.id === source.mediaFileId);
  if (!mediaFile?.file) {
    log.warn('Multicam source media is unavailable', { mediaFileId: source.mediaFileId });
    return null;
  }
  const file = mediaFile.file;
  const filePath = mediaFile.absolutePath ?? mediaFile.filePath;
  const duration = piece.endTime - piece.startTime;
  const clip: TimelineClip = {
    id: generateClipId('clip-mc'),
    trackId,
    name: source.template.name,
    file,
    mediaFileId: source.mediaFileId,
    startTime: piece.startTime,
    duration,
    inPoint: piece.inPoint,
    outPoint: piece.inPoint + duration,
    source: {
      type: 'video',
      naturalDuration: mediaFile.duration ?? source.inPoint + source.duration,
      mediaFileId: source.mediaFileId,
      ...(filePath ? { filePath } : {}),
    },
    thumbnails: mediaFile.thumbnailUrl ? [mediaFile.thumbnailUrl] : [],
    transform: structuredClone(source.template.transform),
    effects: structuredClone(source.template.effects),
    ...(source.template.masks ? { masks: structuredClone(source.template.masks) } : {}),
    linkedGroupId: groupId,
    isLoading: false,
    needsReload: false,
  };
  return bindRuntimeToClip(clip, { file, filePath, mediaFileId: source.mediaFileId });
}

function buildProgramClips(pieces: readonly MulticamPiece[], multicam: CompositionMulticam): TimelineClip[] {
  return pieces.flatMap((piece) => {
    const clip = buildProgramClip(piece, multicam.angles[piece.angleIndex]!.trackId, multicam.groupId);
    return clip ? [clip] : [];
  });
}

export const createMulticamSlice: SliceCreator<MulticamActions> = (set, get) => ({
  enableMulticam: () => {
    const mediaState = useMediaStore.getState();
    const compositionId = mediaState.activeCompositionId;
    if (!compositionId) return false;
    const { clips, tracks, updateDuration, invalidateCache } = get();
    const { angles, sourceClipIds } = captureMulticamAngles(tracks, clips);
    if (angles.length < 2) {
      log.warn('Multicam needs at least two video tracks with camera clips', { angles: angles.length });
      return false;
    }
    const angleTrackIds = new Set(angles.map((angle) => angle.trackId));
    if (tracks.some((track) => angleTrackIds.has(track.id) && track.locked)) {
      log.warn('Multicam cannot rebuild locked camera tracks');
      return false;
    }

    const multicam: CompositionMulticam = { version: 1, active: true, groupId: generateManualLinkedGroupId(), angles };
    const replacedIds = new Set(sourceClipIds);
    // Bind the program pieces before releasing the originals so each media runtime stays alive.
    const program = buildProgramClips(planInitialProgram(angles), multicam);
    const replaced = clips.filter((clip) => replacedIds.has(clip.id));
    const kept = clips
      .filter((clip) => !replacedIds.has(clip.id))
      .map((clip) => ({ ...clip, linkedGroupId: multicam.groupId }));
    set({ clips: [...kept, ...program], selectedClipIds: new Set(), primarySelectedClipId: null });
    cleanupDeletedClipResources(replaced, { stopAudioPlayback: false });
    mediaState.updateComposition(compositionId, { multicam });
    updateDuration();
    invalidateCache();
    renderHostPort.requestNewFrameRender();
    captureSnapshot('Enable multicam');
    log.info('Enabled multicam', { compositionId, angles: angles.map((angle) => angle.label), pieces: program.length });
    return true;
  },

  setMulticamActive: (active) => {
    const mediaState = useMediaStore.getState();
    const compositionId = mediaState.activeCompositionId;
    const multicam = mediaState.compositions.find((composition) => composition.id === compositionId)?.multicam;
    if (!compositionId) return false;
    if (!multicam) return active ? get().enableMulticam() : false;
    mediaState.updateComposition(compositionId, { multicam: { ...multicam, active } });
    return true;
  },

  switchMulticamAngle: (angleIndex, mode) => {
    const active = getActiveMulticam();
    if (!active) return false;
    const { multicam } = active;
    const { clips, tracks, selectedClipIds, playheadPosition, isPlaying, updateDuration, invalidateCache } = get();
    const time = getPlayheadPosition(playheadPosition);
    const switchMode = mode ?? (isPlaying ? 'cut' : 'segment');
    const plan = planAngleSwitch(multicam, clips, time, angleIndex, switchMode);
    // Only where the camera has material; elsewhere the previous camera stays on air.
    const pieces = plan?.pieces.filter((piece) => !isRangeShowingAngle(multicam, clips, piece, angleIndex)) ?? [];
    if (pieces.length === 0) return false;

    const angle = multicam.angles[angleIndex]!;
    const trackIds = multicam.angles.map((candidate) => candidate.trackId);
    let nextClips = clips;
    let nextSelection = selectedClipIds;
    const deleted: TimelineClip[] = [];
    pieces.forEach((piece, index) => {
      const lifted = applyRangeEditOperation({
        id: `multicam-switch:${Date.now()}:${index}`,
        type: 'lift-range',
        range: { startTime: piece.startTime, endTime: piece.endTime, trackIds },
        includeLinked: false,
      }, nextClips, tracks, nextSelection, null);
      nextClips = lifted.clips;
      nextSelection = lifted.selectedClipIds;
      deleted.push(...lifted.deletedClips);
    });
    set({ clips: [...nextClips, ...buildProgramClips(pieces, multicam)], selectedClipIds: nextSelection });
    cleanupDeletedClipResources(deleted, { stopAudioPlayback: false });
    updateDuration();
    invalidateCache();
    renderHostPort.requestNewFrameRender();
    captureSnapshot(`Multicam: ${angle.label}`);
    log.debug('Switched multicam angle', { angle: angle.label, mode: switchMode, ...plan!.range });
    return true;
  },
});
