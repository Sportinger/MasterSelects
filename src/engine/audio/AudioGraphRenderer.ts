import {
  getAudioEffect,
  getAudioEffectDefaultParams,
  type AudioEffectParamValue,
} from './AudioEffectRegistry';
import {
  AUDIO_GRAPH_SCHEMA_VERSION,
  type AudioEffectInstanceWithBypass,
  type AudioGraphAnalysisRefsDescriptor,
  type AudioGraphClipDescriptor,
  type AudioGraphClipPlan,
  type AudioGraphClipSourceDescriptor,
  type AudioGraphDescriptor,
  type AudioGraphDiagnostic,
  type AudioGraphEffectDescriptor,
  type AudioGraphEffectPlanStep,
  type AudioGraphEffectStatus,
  type AudioGraphJsonPrimitive,
  type AudioGraphJsonValue,
  type AudioGraphMasterDescriptor,
  type AudioGraphMasterPlan,
  type AudioGraphRenderInput,
  type AudioGraphRenderPlan,
  type AudioGraphRenderStep,
  type AudioGraphScope,
  type AudioGraphSendDescriptor,
  type AudioGraphSkippedEffect,
  type AudioGraphTimeRangeDescriptor,
  type AudioGraphTrackDescriptor,
  type AudioGraphTrackPlan,
  type ClipAudioStateInput,
  type MasterAudioStateInput,
  type MediaFileAudioAnalysisRefsInput,
  type TrackAudioStateInput,
} from './AudioGraphTypes';
import type {
  Effect,
  AudioEffectInstance,
  MasterAudioState,
  MediaFileAudioAnalysisRefs,
  TimelineClip,
  TimelineTrack,
  TrackAudioState,
} from '../../types';

export const AUDIO_GRAPH_PAYLOAD_FIELD_NAMES = Object.freeze([
  'audioBuffer',
  'buffer',
  'buffers',
  'file',
  'manifestRef',
  'payloadBytes',
  'payloadRefs',
  'rawBytes',
  'rawSamples',
  'renderedBuffer',
  'sampleData',
  'samples',
  'source',
  'thumbnails',
  'videoElement',
  'waveform',
]);

const PAYLOAD_FIELD_NAMES = new Set<string>(AUDIO_GRAPH_PAYLOAD_FIELD_NAMES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonPrimitive(value: unknown): value is AudioGraphJsonPrimitive {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }

  return typeof value === 'number' && Number.isFinite(value);
}

function compactObject<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

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

function normalizeEffectParamValue(value: AudioEffectParamValue): AudioGraphJsonPrimitive {
  return isJsonPrimitive(value) ? value : null;
}

function normalizeLooseParams(
  params: unknown,
  effectId: string,
  scope: AudioGraphScope,
  ownerId: string,
  diagnostics: AudioGraphDiagnostic[]
): Record<string, AudioGraphJsonPrimitive> {
  if (!isRecord(params)) {
    return {};
  }

  const normalized: Record<string, AudioGraphJsonPrimitive> = {};
  for (const key of Object.keys(params).toSorted()) {
    if (PAYLOAD_FIELD_NAMES.has(key)) {
      diagnostics.push({
        severity: 'warning',
        code: 'audio-graph-effect-payload-param-dropped',
        message: `Dropped payload-shaped audio effect param from ${effectId}.`,
        scope,
        refId: ownerId,
      });
      continue;
    }

    const value = params[key];
    if (!isJsonPrimitive(value)) {
      diagnostics.push({
        severity: 'warning',
        code: 'audio-graph-effect-param-dropped',
        message: `Dropped non-JSON audio effect param "${key}" from ${effectId}.`,
        scope,
        refId: ownerId,
      });
      continue;
    }

    normalized[key] = value;
  }

  return normalized;
}

function normalizeRegisteredParams(
  params: unknown,
  descriptorId: string,
  effectId: string,
  scope: AudioGraphScope,
  ownerId: string,
  diagnostics: AudioGraphDiagnostic[]
): Record<string, AudioGraphJsonPrimitive> {
  const descriptor = getAudioEffect(descriptorId);
  const defaults = getAudioEffectDefaultParams(descriptorId);
  const paramNames = descriptor?.paramNames ?? [];
  const allowedParams = new Set(paramNames);
  const normalized: Record<string, AudioGraphJsonPrimitive> = {};

  for (const paramName of paramNames) {
    normalized[paramName] = normalizeEffectParamValue(defaults[paramName]);
  }

  if (!isRecord(params)) {
    return normalized;
  }

  for (const key of Object.keys(params).toSorted()) {
    if (PAYLOAD_FIELD_NAMES.has(key)) {
      diagnostics.push({
        severity: 'warning',
        code: 'audio-graph-effect-payload-param-dropped',
        message: `Dropped payload-shaped audio effect param from ${effectId}.`,
        scope,
        refId: ownerId,
      });
      continue;
    }

    if (!allowedParams.has(key)) {
      diagnostics.push({
        severity: 'warning',
        code: 'audio-graph-effect-param-unknown',
        message: `Dropped unknown param "${key}" for audio effect descriptor "${descriptorId}".`,
        scope,
        refId: ownerId,
      });
      continue;
    }

    const value = params[key];
    if (!isJsonPrimitive(value)) {
      diagnostics.push({
        severity: 'warning',
        code: 'audio-graph-effect-param-dropped',
        message: `Dropped non-JSON audio effect param "${key}" from ${effectId}.`,
        scope,
        refId: ownerId,
      });
      continue;
    }

    normalized[key] = value;
  }

  return normalized;
}

function effectStatus(
  effect: AudioEffectInstanceWithBypass,
  descriptorExists: boolean
): AudioGraphEffectStatus {
  if (!descriptorExists) {
    return 'invalid';
  }

  if (effect.enabled === false || effect.disabled === true) {
    return 'disabled';
  }

  if (effect.bypassed === true) {
    return 'bypassed';
  }

  return 'active';
}

function normalizeEffectStack(
  effects: readonly AudioEffectInstance[] | undefined,
  scope: AudioGraphScope,
  ownerId: string,
  diagnostics: AudioGraphDiagnostic[]
): AudioGraphEffectDescriptor[] {
  if (!effects || effects.length === 0) {
    return [];
  }

  const seenEffectIds = new Set<string>();

  return effects.map((effect, order) => {
    const input = effect as AudioEffectInstanceWithBypass;
    const id = stringValue(input.id, `${scope}-${ownerId}-effect-${order}`);
    const descriptorId = stringValue(input.descriptorId, 'unknown');
    const descriptor = getAudioEffect(descriptorId);

    if (seenEffectIds.has(id)) {
      diagnostics.push({
        severity: 'warning',
        code: 'audio-graph-effect-id-duplicate',
        message: `Duplicate audio effect id "${id}" in ${scope} "${ownerId}".`,
        scope,
        refId: ownerId,
      });
    }
    seenEffectIds.add(id);

    if (!descriptor) {
      diagnostics.push({
        severity: 'error',
        code: 'audio-graph-effect-descriptor-unknown',
        message: `Unknown audio effect descriptor "${descriptorId}" for effect "${id}".`,
        scope,
        refId: ownerId,
      });
    }

    const status = effectStatus(input, Boolean(descriptor));
    const params = descriptor
      ? normalizeRegisteredParams(input.params, descriptorId, id, scope, ownerId, diagnostics)
      : normalizeLooseParams(input.params, id, scope, ownerId, diagnostics);

    return compactObject<AudioGraphEffectDescriptor>({
      id,
      descriptorId,
      order,
      enabled: input.enabled !== false && input.disabled !== true,
      bypassed: input.bypassed === true,
      status,
      params,
      automationMode: input.automationMode,
    });
  });
}

function normalizeLegacyClipAudioEffects(
  effects: readonly Effect[] | undefined,
  existingEffectIds: ReadonlySet<string>
): AudioEffectInstance[] {
  if (!effects || effects.length === 0) {
    return [];
  }

  return effects.flatMap((effect) => {
    const descriptor = getAudioEffect(effect.type);
    if (!descriptor || existingEffectIds.has(effect.id)) {
      return [];
    }

    return [{
      id: effect.id,
      descriptorId: descriptor.id,
      enabled: effect.enabled !== false,
      params: effect.params ?? {},
      automationMode: 'clip',
    } satisfies AudioEffectInstance];
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

function createEffectPlanSteps(
  effects: AudioGraphEffectDescriptor[],
  scope: AudioGraphScope,
  ownerId: string
): { active: AudioGraphEffectPlanStep[]; skipped: AudioGraphSkippedEffect[] } {
  const active: AudioGraphEffectPlanStep[] = [];
  const skipped: AudioGraphSkippedEffect[] = [];

  for (const effect of effects) {
    if (effect.status !== 'active') {
      skipped.push({
        effectId: effect.id,
        descriptorId: effect.descriptorId,
        order: effect.order,
        status: effect.status,
      });
      continue;
    }

    active.push(compactObject<AudioGraphEffectPlanStep>({
      nodeId: `${scope}:${ownerId}:effect:${effect.id}`,
      scope,
      ownerId,
      effectId: effect.id,
      descriptorId: effect.descriptorId,
      order: effect.order,
      params: effect.params,
      automationMode: effect.automationMode,
    }));
  }

  return { active, skipped };
}

function canonicalizeJson(value: unknown): AudioGraphJsonValue {
  if (isJsonPrimitive(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => canonicalizeJson(item));
  }

  if (isRecord(value)) {
    const normalized: Record<string, AudioGraphJsonValue> = {};
    for (const key of Object.keys(value).toSorted()) {
      const entry = value[key];
      if (entry !== undefined) {
        normalized[key] = canonicalizeJson(entry);
      }
    }
    return normalized;
  }

  return null;
}

function stableJsonString(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value));
}

function hashString(input: string): string {
  let hash = 0x811c9dc5;

  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(36).padStart(7, '0');
}

function descriptorKey(descriptor: AudioGraphDescriptor): string {
  const json = stableJsonString(descriptor);
  return `audio-graph:v${AUDIO_GRAPH_SCHEMA_VERSION}:${hashString(json)}:${json.length}`;
}

function isAudioGraphDescriptor(value: AudioGraphDescriptor | AudioGraphRenderInput): value is AudioGraphDescriptor {
  return isRecord(value) && value.schemaVersion === AUDIO_GRAPH_SCHEMA_VERSION && isRecord(value.master);
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
