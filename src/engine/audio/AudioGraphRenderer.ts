import {
  AUDIO_GRAPH_SCHEMA_VERSION,
  type AudioGraphAnalysisRefsDescriptor,
  type AudioGraphClipDescriptor,
  type AudioGraphClipPlan,
  type AudioGraphClipSourceDescriptor,
  type AudioGraphDescriptor,
  type AudioGraphDiagnostic,
  type AudioGraphMasterDescriptor,
  type AudioGraphMasterPlan,
  type AudioGraphRenderInput,
  type AudioGraphRenderPlan,
  type AudioGraphRenderStep,
  type AudioGraphSendDescriptor,
  type AudioGraphTimeRangeDescriptor,
  type AudioGraphTrackDescriptor,
  type AudioGraphTrackPlan,
  type ClipAudioStateInput,
  type MasterAudioStateInput,
  type MediaFileAudioAnalysisRefsInput,
  type TrackAudioStateInput,
} from './AudioGraphTypes';
import type {
  MasterAudioState,
  MediaFileAudioAnalysisRefs,
  TimelineClip,
  TimelineTrack,
  TrackAudioState,
} from '../../types';
import {
  compactObject,
  descriptorKey,
  isAudioGraphDescriptor,
  isRecord,
  stringValue,
} from './graphRender/graphValueNormalization';
import {
  createEffectPlanSteps,
  normalizeEffectStack,
  normalizeLegacyClipAudioEffects,
} from './graphRender/effectStackNormalization';

export { AUDIO_GRAPH_PAYLOAD_FIELD_NAMES } from './graphRender/graphValueNormalization';

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sortedStrings(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }

  const ids = values.filter((value): value is string => typeof value === 'string' && value.length > 0);
  return ids.length > 0 ? ids.toSorted() : undefined;
}

function normalizeAnalysisRefs(
  refs: MediaFileAudioAnalysisRefs | undefined
): AudioGraphAnalysisRefsDescriptor | undefined {
  if (!refs || !isRecord(refs)) {
    return undefined;
  }

  const input = refs as MediaFileAudioAnalysisRefsInput;
  const descriptor = compactObject<AudioGraphAnalysisRefsDescriptor>({
    waveformPyramidId: optionalString(input.waveformPyramidId),
    processedWaveformPyramidId: optionalString(input.processedWaveformPyramidId),
    spectrogramTileSetIds: sortedStrings(input.spectrogramTileSetIds),
    loudnessEnvelopeId: optionalString(input.loudnessEnvelopeId),
    beatGridId: optionalString(input.beatGridId),
    onsetMapId: optionalString(input.onsetMapId),
    phaseCorrelationId: optionalString(input.phaseCorrelationId),
    transcriptTimingId: optionalString(input.transcriptTimingId),
    frequencySummaryId: optionalString(input.frequencySummaryId),
  });

  return Object.keys(descriptor).length > 0 ? descriptor : undefined;
}

function normalizeTimeRange(clip: TimelineClip): AudioGraphTimeRangeDescriptor {
  const startTime = finiteNumber(clip.startTime, 0);
  const duration = Math.max(0, finiteNumber(clip.duration, 0));
  const inPoint = Math.max(0, finiteNumber(clip.inPoint, 0));
  const outPoint = Math.max(inPoint, finiteNumber(clip.outPoint, inPoint + duration));

  return {
    startTime,
    duration,
    endTime: startTime + duration,
    inPoint,
    outPoint,
    playbackRate: finiteNumber(clip.speed, 1),
    reversed: clip.reversed === true,
    preservesPitch: clip.preservesPitch !== false,
  };
}

function normalizeClipSource(clip: TimelineClip): AudioGraphClipSourceDescriptor {
  const audioState = clip.audioState as ClipAudioStateInput | undefined;
  const source = clip.source;

  return compactObject<AudioGraphClipSourceDescriptor>({
    mediaFileId: optionalString(clip.mediaFileId),
    sourceMediaFileId: optionalString(source?.mediaFileId),
    sourceType: optionalString(source?.type),
    sourceAudioRevisionId: optionalString(audioState?.sourceAudioRevisionId),
    sourceAnalysisRefs: normalizeAnalysisRefs(audioState?.sourceAnalysisRefs),
    processedAnalysisRefs: normalizeAnalysisRefs(audioState?.processedAnalysisRefs),
  });
}

function normalizeSends(sends: TrackAudioState['sends'] | undefined): AudioGraphSendDescriptor[] {
  if (!sends || sends.length === 0) {
    return [];
  }

  return sends.map((send, order) => ({
    id: stringValue(send.id, `send-${order}`),
    targetBusId: stringValue(send.targetBusId, 'unknown'),
    gainDb: finiteNumber(send.gainDb, 0),
    preFader: send.preFader === true,
    enabled: send.enabled !== false,
    order,
  }));
}

export class AudioGraphRenderer {
  normalize(input: AudioGraphRenderInput): {
    descriptor: AudioGraphDescriptor;
    diagnostics: AudioGraphDiagnostic[];
  } {
    const diagnostics: AudioGraphDiagnostic[] = [];
    const trackIds = new Set<string>();
    const clipIds = new Set<string>();

    const tracks = input.tracks.map((track, order) => {
      if (trackIds.has(track.id)) {
        diagnostics.push({
          severity: 'error',
          code: 'audio-graph-track-id-duplicate',
          message: `Duplicate track id "${track.id}".`,
          scope: 'track',
          refId: track.id,
        });
      }
      trackIds.add(track.id);

      return this.normalizeTrack(track, order, diagnostics);
    });

    const trackOrder = new Map(tracks.map(track => [track.id, track.order]));
    const clips = input.clips
      .map((clip, originalOrder) => {
        if (clipIds.has(clip.id)) {
          diagnostics.push({
            severity: 'error',
            code: 'audio-graph-clip-id-duplicate',
            message: `Duplicate clip id "${clip.id}".`,
            scope: 'clip',
            refId: clip.id,
          });
        }
        clipIds.add(clip.id);

        if (!trackOrder.has(clip.trackId)) {
          diagnostics.push({
            severity: 'error',
            code: 'audio-graph-clip-track-missing',
            message: `Clip "${clip.id}" references missing track "${clip.trackId}".`,
            scope: 'clip',
            refId: clip.id,
          });
        }

        return this.normalizeClip(
          clip,
          trackOrder.get(clip.trackId) ?? Number.MAX_SAFE_INTEGER,
          originalOrder,
          diagnostics
        );
      })
      .toSorted((a, b) =>
        a.trackOrder - b.trackOrder ||
        a.time.startTime - b.time.startTime ||
        a.id.localeCompare(b.id)
      )
      .map((clip, order) => ({ ...clip, order }));

    const descriptor: AudioGraphDescriptor = {
      schemaVersion: AUDIO_GRAPH_SCHEMA_VERSION,
      clips,
      tracks,
      master: this.normalizeMaster(input.masterAudioState, diagnostics),
    };

    return { descriptor, diagnostics };
  }

  render(input: AudioGraphRenderInput): AudioGraphRenderPlan {
    const { descriptor, diagnostics } = this.normalize(input);
    const graphKey = descriptorKey(descriptor);
    const trackById = new Map(descriptor.tracks.map(track => [track.id, track]));
    const hasSoloTrack = descriptor.tracks.some(track => track.solo);

    const clipPlans = descriptor.clips.map((clip) => {
      const track = trackById.get(clip.trackId);
      const effects = createEffectPlanSteps(clip.effectChain, 'clip', clip.id);

      return {
        kind: 'clip',
        nodeId: `clip:${clip.id}`,
        clipId: clip.id,
        trackId: clip.trackId,
        order: clip.order,
        active: Boolean(track) && !clip.muted && (clip.soloSafe || !hasSoloTrack || track?.solo === true),
        muted: clip.muted,
        time: clip.time,
        source: clip.source,
        effectChain: effects.active,
        skippedEffects: effects.skipped,
        outputTarget: `track:${clip.trackId}:input`,
      } satisfies AudioGraphClipPlan;
    });

    const clipsByTrack = new Map<string, AudioGraphClipPlan[]>();
    for (const clipPlan of clipPlans) {
      const existing = clipsByTrack.get(clipPlan.trackId) ?? [];
      existing.push(clipPlan);
      clipsByTrack.set(clipPlan.trackId, existing);
    }

    const trackPlans = descriptor.tracks.map((track) => {
      const effects = createEffectPlanSteps(track.effectChain, 'track', track.id);

      return {
        kind: 'track',
        nodeId: `track:${track.id}`,
        trackId: track.id,
        order: track.order,
        active: track.visible && !track.muted && (!hasSoloTrack || track.solo),
        visible: track.visible,
        muted: track.muted,
        solo: track.solo,
        volumeDb: track.volumeDb,
        pan: track.pan,
        inputClipIds: (clipsByTrack.get(track.id) ?? []).map(clip => clip.clipId),
        effectChain: effects.active,
        skippedEffects: effects.skipped,
        sends: track.sends,
        outputTarget: 'master:input',
      } satisfies AudioGraphTrackPlan;
    });

    const masterEffects = createEffectPlanSteps(descriptor.master.effectChain, 'master', 'master');
    const masterPlan: AudioGraphMasterPlan = compactObject<AudioGraphMasterPlan>({
      kind: 'master',
      nodeId: 'master:main',
      active: true,
      volumeDb: descriptor.master.volumeDb,
      limiterEnabled: descriptor.master.limiterEnabled,
      targetLufs: descriptor.master.targetLufs,
      truePeakCeilingDb: descriptor.master.truePeakCeilingDb,
      effectChain: masterEffects.active,
      skippedEffects: masterEffects.skipped,
    });

    return {
      schemaVersion: AUDIO_GRAPH_SCHEMA_VERSION,
      mode: input.mode ?? 'live',
      graphKey,
      descriptor,
      clips: clipPlans,
      tracks: trackPlans,
      master: masterPlan,
      renderSequence: this.createRenderSequence(clipPlans, trackPlans, masterPlan),
      diagnostics,
    };
  }

  createGraphKey(input: AudioGraphDescriptor | AudioGraphRenderInput): string {
    const descriptor = isAudioGraphDescriptor(input)
      ? input
      : this.normalize(input).descriptor;

    return descriptorKey(descriptor);
  }

  private normalizeClip(
    clip: TimelineClip,
    trackOrder: number,
    order: number,
    diagnostics: AudioGraphDiagnostic[]
  ): AudioGraphClipDescriptor {
    const audioState = clip.audioState as ClipAudioStateInput | undefined;
    const audioEffectStack = audioState?.effectStack ?? [];
    const audioEffectIds = new Set(audioEffectStack.map(effect => effect.id));
    const legacyAudioEffects = normalizeLegacyClipAudioEffects(clip.effects, audioEffectIds);
    const effectStack = [
      ...audioEffectStack,
      ...legacyAudioEffects,
    ];

    return {
      kind: 'clip',
      id: stringValue(clip.id, `clip-${order}`),
      name: stringValue(clip.name, `Clip ${order + 1}`),
      trackId: stringValue(clip.trackId, 'missing-track'),
      trackOrder,
      order,
      muted: audioState?.muted === true,
      soloSafe: audioState?.soloSafe === true,
      time: normalizeTimeRange(clip),
      source: normalizeClipSource(clip),
      effectChain: normalizeEffectStack(effectStack, 'clip', clip.id, diagnostics),
    };
  }

  private normalizeTrack(
    track: TimelineTrack,
    order: number,
    diagnostics: AudioGraphDiagnostic[]
  ): AudioGraphTrackDescriptor {
    const audioState = track.audioState as TrackAudioStateInput | undefined;

    return compactObject<AudioGraphTrackDescriptor>({
      kind: 'track',
      id: stringValue(track.id, `track-${order}`),
      name: stringValue(track.name, `Track ${order + 1}`),
      type: track.type,
      order,
      visible: track.visible !== false,
      muted: booleanValue(audioState?.muted, track.muted === true),
      solo: booleanValue(audioState?.solo, track.solo === true),
      volumeDb: finiteNumber(audioState?.volumeDb, 0),
      pan: finiteNumber(audioState?.pan, 0),
      recordArm: audioState?.recordArm === true,
      inputMonitor: audioState?.inputMonitor === true,
      inputDeviceId: optionalString(audioState?.inputDeviceId),
      meterMode: audioState?.meterMode ?? 'peak',
      effectChain: normalizeEffectStack(audioState?.effectStack, 'track', track.id, diagnostics),
      sends: normalizeSends(audioState?.sends),
    });
  }

  private normalizeMaster(
    masterAudioState: MasterAudioState | undefined,
    diagnostics: AudioGraphDiagnostic[]
  ): AudioGraphMasterDescriptor {
    const audioState = masterAudioState as MasterAudioStateInput | undefined;

    return compactObject<AudioGraphMasterDescriptor>({
      kind: 'master',
      id: 'master',
      volumeDb: finiteNumber(audioState?.volumeDb, 0),
      limiterEnabled: audioState?.limiterEnabled === true,
      targetLufs: audioState?.targetLufs === undefined
        ? undefined
        : finiteNumber(audioState.targetLufs, -14),
      truePeakCeilingDb: finiteNumber(audioState?.truePeakCeilingDb, -1),
      effectChain: normalizeEffectStack(audioState?.effectStack, 'master', 'master', diagnostics),
    });
  }

  private createRenderSequence(
    clipPlans: AudioGraphClipPlan[],
    trackPlans: AudioGraphTrackPlan[],
    masterPlan: AudioGraphMasterPlan
  ): AudioGraphRenderStep[] {
    return [
      ...clipPlans.map((clip, order): AudioGraphRenderStep => ({
        nodeId: clip.nodeId,
        kind: 'clip',
        ownerId: clip.clipId,
        order,
      })),
      ...trackPlans.map((track, index): AudioGraphRenderStep => ({
        nodeId: track.nodeId,
        kind: 'track',
        ownerId: track.trackId,
        order: clipPlans.length + index,
      })),
      {
        nodeId: masterPlan.nodeId,
        kind: 'master',
        ownerId: 'master',
        order: clipPlans.length + trackPlans.length,
      },
    ];
  }
}

export const audioGraphRenderer = new AudioGraphRenderer();

export function normalizeAudioGraph(input: AudioGraphRenderInput): {
  descriptor: AudioGraphDescriptor;
  diagnostics: AudioGraphDiagnostic[];
} {
  return audioGraphRenderer.normalize(input);
}

export function renderAudioGraph(input: AudioGraphRenderInput): AudioGraphRenderPlan {
  return audioGraphRenderer.render(input);
}

export function createAudioGraphKey(input: AudioGraphDescriptor | AudioGraphRenderInput): string {
  return audioGraphRenderer.createGraphKey(input);
}
