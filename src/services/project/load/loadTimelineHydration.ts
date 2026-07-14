import { Logger } from '../../logger';
import { useMediaStore, type Composition } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip } from '../../../stores/timeline/types';
import { cloneClipNodeGraph } from '../../nodeGraph';
import { normalizeTransitionInstanceParams } from '../../../transitions';
import { fromProjectTransform } from '../transformSerialization';
import { normalizeRulerLaneState } from '../../../timeline/tempo/rulerDefaults';
import { hydrateMaskEdgeFeathers, hydrateMaskKeyframeProperty } from '../maskSerialization';
import { ensureTransitionCompositionForPair } from '../../timeline/transitionCompositionService';
import type { ProjectComposition, ProjectFile } from '../../projectFileService';
import type { LabelColor } from '../../../stores/mediaStore/types';
import type {
  AnalysisStatus,
  ClipMask,
  CompositionTimelineData,
  Effect,
  Keyframe,
  SceneDescriptionStatus,
  TranscriptStatus,
} from '../../../types';
import { calcRangeCoverage } from './loadMediaCacheHydration';

const log = Logger.create('ProjectSync');

function createPlaceholderFile(name: string): File {
  return typeof File !== 'undefined'
    ? new File([], name)
    : ({} as File);
}

function asTransitionTimelineClip(clip: CompositionTimelineData['clips'][number]): TimelineClip {
  return {
    ...clip,
    file: createPlaceholderFile(clip.name || 'clip'),
    source: {
      type: clip.sourceType,
      mediaFileId: clip.mediaFileId || undefined,
      naturalDuration: clip.naturalDuration,
      transitionOverlay: clip.transitionOverlay,
      vectorAnimationSettings: clip.vectorAnimationSettings,
    },
    transform: clip.transform,
    effects: clip.effects ?? [],
  } as TimelineClip;
}

function collectAttachedTransitionCompositionIds(compositions: readonly Composition[]): Set<string> {
  const ids = new Set<string>();
  const pending: string[] = [];
  const byId = new Map(compositions.map((composition) => [composition.id, composition]));
  const collectFromTimeline = (timelineData: Composition['timelineData']) => {
    if (!timelineData) return;
    for (const clip of timelineData.clips) {
      for (const compositionId of [clip.transitionOut?.compositionId, clip.transitionIn?.compositionId]) {
        if (!compositionId || ids.has(compositionId)) continue;
        ids.add(compositionId);
        pending.push(compositionId);
      }
    }
  };

  for (const composition of compositions) {
    if (composition.transitionComp?.kind === 'transition-comp') continue;
    collectFromTimeline(composition.timelineData);
  }

  while (pending.length > 0) {
    collectFromTimeline(byId.get(pending.pop()!)?.timelineData);
  }
  return ids;
}

function hasValidTransitionCompositionReference(
  compositions: readonly Composition[],
  parentCompositionId: string,
  transitionId: string,
  compositionId: string | undefined,
  outgoingClipId: string | undefined,
  incomingClipId: string | undefined,
): boolean {
  if (!compositionId) return true;
  const composition = compositions.find((candidate) => candidate.id === compositionId);
  return composition?.transitionComp?.kind === 'transition-comp' &&
    composition.transitionComp.parentCompositionId === parentCompositionId &&
    composition.transitionComp.parentTransitionId === transitionId &&
    composition.transitionComp.parentOutgoingClipId === outgoingClipId &&
    composition.transitionComp.parentIncomingClipId === incomingClipId;
}

function pruneInvalidTransitionCompositionReferences(): void {
  const compositions = useMediaStore.getState().compositions;
  let changed = false;
  const nextCompositions = compositions.map((composition) => {
    if (composition.transitionComp?.kind === 'transition-comp' || !composition.timelineData) return composition;
    let compositionChanged = false;
    const clips = composition.timelineData.clips.map((clip) => {
      let nextClip = clip;
      if (
        clip.transitionOut?.compositionId &&
        !hasValidTransitionCompositionReference(
          compositions,
          composition.id,
          clip.transitionOut.id,
          clip.transitionOut.compositionId,
          clip.id,
          clip.transitionOut.linkedClipId,
        )
      ) {
        changed = true;
        compositionChanged = true;
        nextClip = { ...nextClip, transitionOut: { ...clip.transitionOut, compositionId: undefined } };
      }
      if (
        clip.transitionIn?.compositionId &&
        !hasValidTransitionCompositionReference(
          compositions,
          composition.id,
          clip.transitionIn.id,
          clip.transitionIn.compositionId,
          clip.transitionIn.linkedClipId,
          clip.id,
        )
      ) {
        changed = true;
        compositionChanged = true;
        nextClip = { ...nextClip, transitionIn: { ...clip.transitionIn, compositionId: undefined } };
      }
      return nextClip;
    });
    return compositionChanged ? { ...composition, timelineData: { ...composition.timelineData, clips } } : composition;
  });

  if (changed) {
    useMediaStore.setState({ compositions: nextCompositions });
  }
}

type CompositionViewState = Record<string, {
  playheadPosition?: number;
  zoom?: number;
  scrollX?: number;
  inPoint?: number | null;
  outPoint?: number | null;
}>;

export type ProjectLoadTimelineStore = ReturnType<typeof useTimelineStore.getState>;

export function clearProjectTimelineForLoad(): ProjectLoadTimelineStore {
  const timelineStore = useTimelineStore.getState();
  timelineStore.clearTimeline();
  return timelineStore;
}

export function convertProjectCompositionToStore(
  projectComps: ProjectComposition[],
  compositionViewState?: CompositionViewState,
): Composition[] {
  return projectComps.map((pc) => {
    const viewState = compositionViewState?.[pc.id];
    const timelineData: CompositionTimelineData = {
      tracks: pc.tracks.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        height: t.height,
        labelColor: t.labelColor,
        locked: t.locked,
        visible: t.visible,
        muted: t.muted,
        solo: t.solo,
        audioState: t.audioState ? structuredClone(t.audioState) : undefined,
        midiInstrument: t.midiInstrument ? structuredClone(t.midiInstrument) : undefined,
      })),
      clips: pc.clips.map((c) => ({
        id: c.id,
        trackId: c.trackId,
        name: c.name || '',
        mediaFileId: c.mediaId,
        signalAssetId: c.signalAssetId,
        signalRefId: c.signalRefId,
        signalRenderAdapterId: c.signalRenderAdapterId,
        sourceType: c.sourceType || 'video',
        naturalDuration: c.naturalDuration,
        midiData: c.midiData ? structuredClone(c.midiData) : undefined,
        thumbnails: c.thumbnails,
        linkedClipId: c.linkedClipId,
        linkedGroupId: c.linkedGroupId,
        videoState: c.videoState ? structuredClone(c.videoState) : undefined,
        audioState: c.audioState ? structuredClone(c.audioState) : undefined,
        waveform: c.waveform,
        waveformChannels: c.waveformChannels,
        modelSequence: c.modelSequence,
        gaussianSplatSequence: c.gaussianSplatSequence,
        threeDEffectorsEnabled: c.threeDEffectorsEnabled,
        meshType: c.meshType,
        modelPrimitiveIndex: c.modelPrimitiveIndex,
        modelMaterialSettings: c.modelMaterialSettings,
        cameraSettings: c.cameraSettings,
        lightSettings: c.lightSettings,
        splatEffectorSettings: c.splatEffectorSettings,
        gaussianBlendshapes: c.gaussianBlendshapes,
        gaussianSplatSettings: c.gaussianSplatSettings,
        startTime: c.startTime,
        duration: c.duration,
        inPoint: c.inPoint,
        outPoint: c.outPoint,
        transform: fromProjectTransform(c.transform),
        sourceRect: c.sourceRect ? structuredClone(c.sourceRect) : undefined,
        transitionRender: c.transitionRender ? structuredClone(c.transitionRender) : undefined,
        effects: c.effects.map((effect): Effect => ({
          id: effect.id,
          name: effect.name,
          type: effect.type as Effect['type'],
          enabled: effect.enabled,
          params: effect.params,
        })),
        transitionIn: c.transitionIn ? normalizeTransitionInstanceParams(structuredClone(c.transitionIn)) : undefined,
        transitionOut: c.transitionOut ? normalizeTransitionInstanceParams(structuredClone(c.transitionOut)) : undefined,
        transitionSourceTimeOverride: c.transitionSourceTimeOverride,
        transitionSourceHold: c.transitionSourceHold,
        colorCorrection: c.colorCorrection ? structuredClone(c.colorCorrection) : undefined,
        nodeGraph: cloneClipNodeGraph(c.nodeGraph),
        masks: c.masks.map((mask): ClipMask => ({
          id: mask.id,
          name: mask.name,
          mode: mask.mode,
          inverted: mask.inverted,
          opacity: mask.opacity,
          feather: mask.feather,
          edgeFeathers: hydrateMaskEdgeFeathers(mask),
          featherQuality: mask.featherQuality ?? 50,
          enabled: mask.enabled !== false,
          visible: mask.visible !== false,
          outlineColor: mask.outlineColor,
          closed: mask.closed,
          expanded: false,
          position: mask.position,
          vertices: mask.vertices.map((vertex, index) => ({
            id: mask.id + '-v-' + index,
            x: vertex.x,
            y: vertex.y,
            handleIn: vertex.inTangent,
            handleOut: vertex.outTangent,
            handleMode: vertex.handleMode,
          })),
        })),
        keyframes: (c.keyframes || []).map((keyframe): Keyframe => ({
          id: keyframe.id,
          clipId: c.id,
          property: hydrateMaskKeyframeProperty(keyframe.property, c.masks) as Keyframe['property'],
          time: keyframe.time,
          value: keyframe.value,
          pathValue: keyframe.pathValue
            ? {
                closed: keyframe.pathValue.closed,
                vertices: keyframe.pathValue.vertices.map(vertex => ({
                  ...vertex,
                  handleIn: { ...vertex.handleIn },
                  handleOut: { ...vertex.handleOut },
                })),
              }
            : undefined,
          easing: keyframe.easing as Keyframe['easing'],
          rotationInterpolation: keyframe.rotationInterpolation as Keyframe['rotationInterpolation'],
          handleIn: keyframe.bezierHandles
            ? { x: keyframe.bezierHandles.x1, y: keyframe.bezierHandles.y1 }
            : undefined,
          handleOut: keyframe.bezierHandles
            ? { x: keyframe.bezierHandles.x2, y: keyframe.bezierHandles.y2 }
            : undefined,
        })),
        volume: c.volume,
        audioEnabled: c.audioEnabled,
        reversed: c.reversed,
        disabled: c.disabled,
        speed: c.speed,
        preservesPitch: c.preservesPitch,
        isComposition: c.isComposition,
        compositionId: c.compositionId,
        textProperties: c.textProperties,
        text3DProperties: c.text3DProperties,
        solidColor: c.solidColor,
        transitionOverlay: c.transitionOverlay ? structuredClone(c.transitionOverlay) : undefined,
        mathScene: c.mathScene ? structuredClone(c.mathScene) : undefined,
        motion: c.motion ? structuredClone(c.motion) : undefined,
        vectorAnimationSettings: c.vectorAnimationSettings,
        is3D: c.is3D,
        transcript: c.transcript,
        transcriptStatus: c.transcriptStatus as TranscriptStatus | undefined,
        analysis: c.analysis,
        analysisStatus: c.analysisStatus as AnalysisStatus | undefined,
        sceneDescriptions: c.sceneDescriptions,
        sceneDescriptionStatus: c.sceneDescriptionStatus as SceneDescriptionStatus | undefined,
      })),
      playheadPosition: viewState?.playheadPosition ?? 0,
      duration: pc.duration,
      zoom: viewState?.zoom ?? 1,
      scrollX: viewState?.scrollX ?? 0,
      inPoint: viewState?.inPoint ?? null,
      outPoint: viewState?.outPoint ?? null,
      loopPlayback: false,
      videoBakeRegions: pc.videoBakeRegions ? structuredClone(pc.videoBakeRegions) : undefined,
      masterAudioState: pc.masterAudioState ? structuredClone(pc.masterAudioState) : undefined,
      markers: (pc.markers || []).map((marker) => ({
        id: marker.id,
        time: marker.time,
        label: marker.name || '',
        color: marker.color,
        stopPlayback: marker.stopPlayback === true ? true : undefined,
        midiBindings: marker.midiBindings,
      })),
      // Multi-ruler infrastructure (issue #257) — hydrate lanes/tempo, defaulting
      // projects authored before the feature (this is the migration).
      ...normalizeRulerLaneState({
        tempoMap: pc.tempoMap,
        rulerLanes: pc.rulerLanes,
        activeRulerLaneId: pc.activeRulerLaneId,
      }),
    };

    return {
      id: pc.id,
      name: pc.name,
      type: 'composition',
      parentId: pc.folderId,
      labelColor: pc.labelColor as LabelColor | undefined,
      createdAt: Date.now(),
      width: pc.width,
      height: pc.height,
      frameRate: pc.frameRate,
      duration: pc.duration,
      backgroundColor: pc.backgroundColor,
      transitionComp: pc.transitionComp ? structuredClone(pc.transitionComp) : undefined,
      timelineData,
    };
  });
}

export function normalizeLoadedTransitionCompositions(): void {
  const mediaStore = useMediaStore.getState();

  for (const parentComposition of mediaStore.compositions) {
    if (parentComposition.transitionComp?.kind === 'transition-comp' || !parentComposition.timelineData) continue;

    const timelineClips = parentComposition.timelineData.clips.map(asTransitionTimelineClip);
    for (const clip of timelineClips) {
      if (!clip.transitionOut) continue;

      ensureTransitionCompositionForPair({
        outgoingClipId: clip.id,
        transitionId: clip.transitionOut.id,
        timelineClips,
        serializableClips: parentComposition.timelineData.clips,
        parentComposition,
        compositions: useMediaStore.getState().compositions,
        createComposition: useMediaStore.getState().createComposition,
        updateComposition: useMediaStore.getState().updateComposition,
        attachTransitionComposition: ({ outgoingClipId, incomingClipId, transitionId, compositionId }) => {
          const currentParent = useMediaStore.getState().compositions.find((composition) => composition.id === parentComposition.id);
          if (!currentParent?.timelineData) return;
          useMediaStore.getState().updateComposition(parentComposition.id, {
            timelineData: {
              ...currentParent.timelineData,
              clips: currentParent.timelineData.clips.map((candidate) => {
                if (candidate.id === outgoingClipId && candidate.transitionOut?.id === transitionId) {
                  return { ...candidate, transitionOut: { ...candidate.transitionOut, compositionId } };
                }
                if (candidate.id === incomingClipId && candidate.transitionIn?.id === transitionId) {
                  return { ...candidate, transitionIn: { ...candidate.transitionIn, compositionId } };
                }
                return candidate;
              }),
            },
          });
        },
      });
    }
  }

  pruneInvalidTransitionCompositionReferences();
  const attachedIds = collectAttachedTransitionCompositionIds(useMediaStore.getState().compositions);
  for (const composition of useMediaStore.getState().compositions) {
    if (composition.transitionComp?.kind === 'transition-comp' && !attachedIds.has(composition.id)) {
      useMediaStore.getState().removeComposition(composition.id);
    }
  }
}

export async function hydrateActiveCompositionTimeline(
  projectData: ProjectFile,
  compositions: Composition[],
  timelineStore: ProjectLoadTimelineStore,
): Promise<void> {
  if (projectData.activeCompositionId) {
    const activeComp = compositions.find((c) => c.id === projectData.activeCompositionId);
    if (activeComp?.timelineData) {
      await timelineStore.loadState(activeComp.timelineData);
      syncStatusFromClipsToMedia();
    }
  }
}

function hasNestedReloadPlaceholder(clips: readonly TimelineClip[] | undefined): boolean {
  return clips?.some((clip) => clip.needsReload || hasNestedReloadPlaceholder(clip.nestedClips)) ?? false;
}

export async function reloadNestedCompositionClips(): Promise<void> {
  const timelineStore = useTimelineStore.getState();
  const mediaStore = useMediaStore.getState();
  const compClips = timelineStore.clips.filter(
    c => c.isComposition && c.compositionId && (
      !c.nestedClips ||
      c.nestedClips.length === 0 ||
      hasNestedReloadPlaceholder(c.nestedClips)
    )
  );

  if (compClips.length === 0) return;

  log.info('Reloading ' + compClips.length + ' nested composition clips...');
  const reloadTimelineSessionId = timelineStore.timelineSessionId;

  for (const compClip of compClips) {
    const composition = mediaStore.compositions.find(c => c.id === compClip.compositionId);
    if (!composition?.timelineData) continue;

    const nestedTracks = composition.timelineData.tracks;
    const isCurrentNestedReload = () => {
      const currentTimelineState = useTimelineStore.getState();
      const currentClip = currentTimelineState.clips.find((clip) => clip.id === compClip.id);
      return (
        currentTimelineState.timelineSessionId === reloadTimelineSessionId &&
        currentClip?.isComposition === true &&
        currentClip.compositionId === compClip.compositionId
      );
    };
    const { calculateNestedClipBoundaries, loadNestedClips, generateCompThumbnails } =
      await import('../../../stores/timeline/nestedCompositionLoader');
    const nestedClips = await loadNestedClips({
      compClipId: compClip.id,
      composition,
      get: useTimelineStore.getState,
      set: useTimelineStore.setState,
      getMediaState: useMediaStore.getState,
      isCurrentTimelineSession: isCurrentNestedReload,
      applySpatialFieldsWhenSourceMissing: false,
    });
    if (!isCurrentNestedReload()) continue;

    if (nestedClips.length > 0) {
      const compDuration = composition.timelineData?.duration ?? composition.duration;
      const nestedClipBoundaries = calculateNestedClipBoundaries(composition.timelineData, compDuration);

      useTimelineStore.getState().updateClip(compClip.id, {
        nestedClips,
        nestedTracks,
        nestedClipBoundaries,
        isLoading: false,
      });

      if (!compClip.thumbnails || compClip.thumbnails.length === 0) {
        generateCompThumbnails({
          clipId: compClip.id,
          nestedClips,
          compDuration,
          thumbnailsEnabled: useTimelineStore.getState().thumbnailsEnabled,
          boundaries: nestedClipBoundaries,
          get: useTimelineStore.getState,
          set: useTimelineStore.setState,
        });
      }
    }
  }

  log.info('Nested composition clips reloaded');
}

function syncStatusFromClipsToMedia(): void {
  const clips = useTimelineStore.getState().clips;
  const transcriptWords = new Map<string, { start: number; end: number }[]>();
  const transcribedRangesMap = new Map<string, [number, number][]>();
  const analysisRanges = new Map<string, [number, number][]>();

  for (const clip of clips) {
    const mediaFileId = clip.source?.mediaFileId || clip.mediaFileId;
    if (!mediaFileId) continue;

    if (clip.transcriptStatus === 'ready' && clip.transcript?.length) {
      const existing = transcriptWords.get(mediaFileId) || [];
      for (const w of clip.transcript) existing.push({ start: w.start, end: w.end });
      transcriptWords.set(mediaFileId, existing);
      const inPt = clip.inPoint ?? 0;
      const outPt = clip.outPoint ?? (clip.source?.naturalDuration ?? 0);
      if (outPt > inPt) {
        const existingRanges = transcribedRangesMap.get(mediaFileId) || [];
        existingRanges.push([inPt, outPt]);
        transcribedRangesMap.set(mediaFileId, existingRanges);
      }
    }

    if (clip.analysisStatus === 'ready' || clip.sceneDescriptionStatus === 'ready') {
      const inPt = clip.inPoint ?? 0;
      const outPt = clip.outPoint ?? (clip.source?.naturalDuration ?? 0);
      if (outPt > inPt) {
        const existing = analysisRanges.get(mediaFileId) || [];
        existing.push([inPt, outPt]);
        analysisRanges.set(mediaFileId, existing);
      }
    }
  }

  if (transcriptWords.size === 0 && analysisRanges.size === 0) return;

  useMediaStore.setState((state) => ({
    files: state.files.map((f) => {
      const tWords = transcriptWords.get(f.id);
      const tRanges = transcribedRangesMap.get(f.id);
      const aRanges = analysisRanges.get(f.id);
      if (!tWords && !aRanges) return f;
      const dur = f.duration || 0;
      return {
        ...f,
        ...(tWords && f.transcriptStatus !== 'ready' && {
          transcriptStatus: 'ready' as const,
          transcriptCoverage: dur > 0 && tRanges ? calcRangeCoverage(tRanges, dur) : 0,
          transcribedRanges: tRanges,
        }),
        ...(aRanges && f.analysisStatus !== 'ready' && {
          analysisStatus: 'ready' as const,
          analysisCoverage: dur > 0 ? calcRangeCoverage(aRanges, dur) : 0,
        }),
      };
    }),
  }));

  log.info('Synced badges from clips (T:' + transcriptWords.size + ', A:' + analysisRanges.size + ')');
}
