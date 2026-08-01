import { renderHostPort } from '../render/renderHostPort';
import { useMediaStore } from '../../stores/mediaStore';
import { useHistoryStore } from '../../stores/historyStore';
import { useTimelineStore } from '../../stores/timeline';
import type { Keyframe } from '../../types/keyframes';
import type { SerializableClip, TimelineClip, TimelineTrack } from '../../types/timeline';
import {
  compareFrameFingerprints,
  fingerprintDataUrl,
  type FrameFingerprint,
  type FrameFingerprintComparison,
  type FrameFingerprintComparisonThresholds,
} from './frameFingerprint';
import { handleCaptureFrame } from './handlers/preview';
import { handleGetStats } from './handlers/stats';
import { handleRunTimelineCanvasExportPreviewParitySmoke } from './handlers/smokes/exportPreviewParity';
import {
  beginTimelineCanvasSmokeMutation,
  captureTimelineCanvasSmokeRestoreState,
  clampNumber,
  getResultDataObject,
  restoreTimelineCanvasSmokeState,
  waitForFrames,
  type TimelineCanvasSmokeRestoreState,
} from './handlers/smokes/smokeRuntime';
import {
  addCompositionSegment,
} from './handlers/stressTest/clipSegments';
import {
  openComposition,
  saveActiveTimelineToComposition,
} from './handlers/stressTest/compositionRuntime';
import type { PreviewCaptureMode } from './previewCapture';
import type { ToolResult } from './types';

const DEFAULT_SAMPLE_TIME_SECONDS = 1;
const DEFAULT_EXPORT_WIDTH = 640;
const DEFAULT_EXPORT_HEIGHT = 360;
const DEFAULT_EXPORT_FPS = 8;
const DEFAULT_SAMPLE_WIDTH = 48;
const DEFAULT_SAMPLE_HEIGHT = 27;

export interface MotionDesignMd0FixtureView {
  readonly durationSeconds: number;
  readonly composition: {
    readonly id: string;
    readonly width: number;
    readonly height: number;
    readonly frameRate: number;
    readonly backgroundColor: string;
  };
  readonly tracks: readonly {
    readonly id: string;
    readonly type: TimelineTrack['type'];
    readonly visible: boolean;
    readonly muted: boolean;
    readonly solo: boolean;
    readonly locked: boolean;
  }[];
  readonly plate: MotionDesignMd0FixtureClipView;
  readonly text: MotionDesignMd0FixtureClipView;
}

export interface MotionDesignMd0FixtureClipView {
  readonly id: string;
  readonly trackId: string;
  readonly name: string;
  readonly sourceType: string | null;
  readonly timing: {
    readonly startTime: number;
    readonly duration: number;
    readonly inPoint: number;
    readonly outPoint: number;
  };
  readonly transform: TimelineClip['transform'];
  /** Complete durable clip payload emitted by the normal composition serializer. */
  readonly editableState: SerializableClip | Record<string, unknown>;
  readonly keyframes: readonly {
    readonly id: string;
    readonly property: string;
    readonly time: number;
    readonly value: unknown;
    readonly easing: string | undefined;
  }[];
  readonly motion?: TimelineClip['motion'];
  readonly textProperties?: TimelineClip['textProperties'];
}

export type MotionDesignMd0FixtureValidation =
  | { readonly ok: true; readonly view: MotionDesignMd0FixtureView }
  | { readonly ok: false; readonly error: string };

export interface MotionDesignMd0CaptureEvidence {
  readonly capturedAt: number;
  readonly width: number;
  readonly height: number;
  readonly mode: string;
  readonly canvasSource: string | null;
  readonly fingerprint: FrameFingerprint;
  readonly dataUrl: string;
  readonly renderDiagnostics: unknown;
}

export interface MotionDesignMd0RoundTripEvidence {
  readonly passed: boolean;
  readonly before: MotionDesignMd0FixtureView;
  readonly after: MotionDesignMd0FixtureView;
  readonly serializedTrackCount: number;
  readonly serializedClipCount: number;
  readonly persistenceScope: 'composition-save-reopen';
  readonly projectPersistenceCovered: false;
  readonly limitation: string;
}

export interface MotionDesignMd0NestedFixtureEvidence {
  readonly childCompositionId: string;
  readonly parentCompositionId: string;
  readonly nestedClipId: string;
  readonly parentTrackId: string;
}

export interface MotionDesignMd0RestoreEvidence {
  readonly verified: boolean;
  readonly failures: readonly string[];
  readonly smokeRestore: unknown;
  readonly renderResolution: {
    readonly before: { readonly width: number; readonly height: number };
    readonly after: { readonly width: number; readonly height: number };
  };
  readonly timelineFieldMismatches: readonly string[];
  readonly mediaFieldMismatches: readonly string[];
  readonly historyFieldMismatches: readonly string[];
}

interface MotionDesignMd0CaptureOptions {
  readonly sampleTimeSeconds: number;
  readonly captureMode: PreviewCaptureMode;
  readonly sampleWidth: number;
  readonly sampleHeight: number;
}

interface MotionDesignMd0ExportOptions {
  readonly sampleTimeSeconds: number;
  readonly captureMode: PreviewCaptureMode;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly sampleWidth: number;
  readonly sampleHeight: number;
  readonly thresholds: FrameFingerprintComparisonThresholds;
}

interface MotionDesignMd0NestedOptions {
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly backgroundColor: string;
}

export interface MotionDesignMd0EvidenceDeps {
  readonly beginMutation: () => () => void;
  readonly captureRestoreState: () => unknown;
  readonly restoreTimeline: (snapshot: unknown) => Promise<MotionDesignMd0RestoreEvidence>;
  readonly readFixture: (plateClipId: string, textClipId: string) => MotionDesignMd0FixtureValidation;
  readonly roundTrip: (
    plateClipId: string,
    textClipId: string,
  ) => Promise<MotionDesignMd0RoundTripEvidence>;
  readonly capture: (options: MotionDesignMd0CaptureOptions) => Promise<MotionDesignMd0CaptureEvidence>;
  readonly runExportParity: (options: MotionDesignMd0ExportOptions) => Promise<ToolResult>;
  readonly materializeNested: (
    options: MotionDesignMd0NestedOptions,
  ) => Promise<MotionDesignMd0NestedFixtureEvidence>;
  readonly getStats: () => Promise<ToolResult>;
  readonly compareFingerprints: (
    reference: FrameFingerprint,
    candidate: FrameFingerprint,
    thresholds: FrameFingerprintComparisonThresholds,
  ) => FrameFingerprintComparison;
}

function cloneKeyframeView(keyframe: Keyframe): MotionDesignMd0FixtureClipView['keyframes'][number] {
  return {
    id: keyframe.id,
    property: keyframe.property,
    time: keyframe.time,
    value: structuredClone(keyframe.value),
    easing: keyframe.easing,
  };
}

function describeClip(
  clip: TimelineClip,
  keyframes: readonly Keyframe[],
  serializedClip: SerializableClip | undefined,
): MotionDesignMd0FixtureClipView {
  return {
    id: clip.id,
    trackId: clip.trackId,
    name: clip.name,
    sourceType: clip.source?.type ?? null,
    timing: {
      startTime: clip.startTime,
      duration: clip.duration,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
    },
    transform: structuredClone(clip.transform),
    editableState: structuredClone(serializedClip ?? {
      id: clip.id,
      trackId: clip.trackId,
      name: clip.name,
      startTime: clip.startTime,
      duration: clip.duration,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
      sourceType: clip.source?.type ?? 'unknown',
      transform: clip.transform,
      motion: clip.motion,
      textProperties: clip.textProperties,
      effects: clip.effects,
      keyframes,
    }),
    keyframes: keyframes.map(cloneKeyframeView),
    ...(clip.motion ? { motion: structuredClone(clip.motion) } : {}),
    ...(clip.textProperties ? { textProperties: structuredClone(clip.textProperties) } : {}),
  };
}

export function describeMotionDesignMd0Fixture(input: {
  readonly plateClipId: string;
  readonly textClipId: string;
  readonly tracks: readonly TimelineTrack[];
  readonly clips: readonly TimelineClip[];
  readonly serializableClips?: readonly SerializableClip[];
  readonly getClipKeyframes: (clipId: string) => readonly Keyframe[];
  readonly durationSeconds: number;
  readonly sampleTimeSeconds?: number;
  readonly composition: MotionDesignMd0FixtureView['composition'];
}): MotionDesignMd0FixtureValidation {
  const plate = input.clips.find((clip) => clip.id === input.plateClipId);
  if (!plate) {
    return { ok: false, error: `MD0 evidence plate clip not found: ${input.plateClipId}` };
  }
  if (plate.source?.type !== 'motion-shape' || !plate.motion?.shape) {
    return { ok: false, error: `MD0 evidence plate is not a native Motion Shape: ${plate.id}` };
  }
  if (
    plate.motion.shape.primitive !== 'rectangle'
    || (plate.motion.shape.cornerRadius ?? 0) <= 0
  ) {
    return { ok: false, error: 'MD0 evidence plate must be a rounded rectangle.' };
  }
  const appearances = plate.motion.appearance?.items ?? [];
  const hasVisibleFill = appearances.some((item) => (
    item.kind === 'color-fill' && item.visible && item.opacity > 0
  ));
  const hasVisibleStroke = appearances.some((item) => (
    item.kind === 'stroke' && item.visible && item.opacity > 0 && item.width > 0
  ));
  if (!hasVisibleFill || !hasVisibleStroke) {
    return { ok: false, error: 'MD0 evidence plate must retain a visible fill and stroke.' };
  }

  const text = input.clips.find((clip) => clip.id === input.textClipId);
  if (!text) {
    return { ok: false, error: `MD0 evidence text clip not found: ${input.textClipId}` };
  }
  if (text.source?.type !== 'text' || !text.textProperties) {
    return { ok: false, error: `MD0 evidence title is not editable text: ${text.id}` };
  }
  if (plate.trackId === text.trackId) {
    return {
      ok: false,
      error: 'MD0 evidence requires plate and text on separate video tracks; preview/export resolve one active clip per track.',
    };
  }

  const trackById = new Map(input.tracks.map((track) => [track.id, track]));
  const plateTrack = trackById.get(plate.trackId);
  const textTrack = trackById.get(text.trackId);
  if (plateTrack?.type !== 'video' || textTrack?.type !== 'video') {
    return { ok: false, error: 'MD0 evidence plate and text must both belong to video tracks.' };
  }
  if (
    plateTrack.visible === false
    || textTrack.visible === false
    || plateTrack.muted
    || textTrack.muted
  ) {
    return { ok: false, error: 'MD0 evidence tracks must be visible and unmuted.' };
  }

  const sampleTimeSeconds = input.sampleTimeSeconds ?? DEFAULT_SAMPLE_TIME_SECONDS;
  if (![plate, text].every((clip) => (
    sampleTimeSeconds >= clip.startTime
    && sampleTimeSeconds < clip.startTime + clip.duration
  ))) {
    return { ok: false, error: 'MD0 evidence clips must overlap the requested sample time.' };
  }

  const validateOpacityEnvelope = (clip: TimelineClip): string | null => {
    const keyframes = input.getClipKeyframes(clip.id)
      .filter((keyframe) => keyframe.property === 'opacity')
      .sort((left, right) => left.time - right.time);
    const numericValue = (keyframe: Keyframe): number | null => (
      typeof keyframe.value === 'number' ? keyframe.value : null
    );
    const fadeInStart = keyframes.find((keyframe) => (
      keyframe.time <= sampleTimeSeconds && (numericValue(keyframe) ?? 1) <= 0.05
    ));
    const visibleAtSample = keyframes.find((keyframe) => (
      keyframe.time <= sampleTimeSeconds && (numericValue(keyframe) ?? 0) >= 0.95
    ));
    const fadeOutEnd = keyframes.find((keyframe) => (
      keyframe.time > sampleTimeSeconds && (numericValue(keyframe) ?? 1) <= 0.05
    ));
    return fadeInStart && visibleAtSample && fadeOutEnd
      ? null
      : `${clip.name} must contain opacity fade-in and fade-out keyframes around the sample.`;
  };
  const opacityFailure = validateOpacityEnvelope(plate) ?? validateOpacityEnvelope(text);
  if (opacityFailure) return { ok: false, error: opacityFailure };

  const serializedById = new Map(
    (input.serializableClips ?? []).map((clip) => [clip.id, clip]),
  );

  return {
    ok: true,
    view: {
      durationSeconds: input.durationSeconds,
      composition: structuredClone(input.composition),
      tracks: input.tracks.map((track) => ({
        id: track.id,
        type: track.type,
        visible: track.visible,
        muted: track.muted,
        solo: track.solo,
        locked: track.locked === true,
      })),
      plate: describeClip(
        plate,
        input.getClipKeyframes(plate.id),
        serializedById.get(plate.id),
      ),
      text: describeClip(
        text,
        input.getClipKeyframes(text.id),
        serializedById.get(text.id),
      ),
    },
  };
}

function readFixtureFromStore(
  plateClipId: string,
  textClipId: string,
): MotionDesignMd0FixtureValidation {
  const state = useTimelineStore.getState();
  const media = useMediaStore.getState();
  const composition = media.compositions.find((entry) => entry.id === media.activeCompositionId);
  if (!composition) {
    return { ok: false, error: 'MD0 evidence requires an active fixture composition.' };
  }
  const serialized = state.getSerializableState();
  return describeMotionDesignMd0Fixture({
    plateClipId,
    textClipId,
    tracks: state.tracks,
    clips: state.clips,
    serializableClips: serialized.clips,
    getClipKeyframes: (clipId) => state.getClipKeyframes(clipId),
    durationSeconds: state.duration,
    composition: {
      id: composition.id,
      width: composition.width,
      height: composition.height,
      frameRate: composition.frameRate,
      backgroundColor: composition.backgroundColor,
    },
  });
}

function sameFixtureView(
  left: MotionDesignMd0FixtureView,
  right: MotionDesignMd0FixtureView,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function roundTripFixture(
  plateClipId: string,
  textClipId: string,
): Promise<MotionDesignMd0RoundTripEvidence> {
  const before = readFixtureFromStore(plateClipId, textClipId);
  if (!before.ok) throw new Error(before.error);

  const timeline = useTimelineStore.getState();
  const serialized = timeline.getSerializableState();
  const media = useMediaStore.getState();
  const activeComposition = media.compositions.find(
    (composition) => composition.id === media.activeCompositionId,
  );
  if (!activeComposition) throw new Error('MD0 round-trip requires an active composition');

  saveActiveTimelineToComposition(activeComposition.id, before.view.durationSeconds);
  const scratch = useMediaStore.getState().createComposition('MD0 Evidence - Reload Pivot', {
    width: activeComposition.width,
    height: activeComposition.height,
    frameRate: activeComposition.frameRate,
    duration: activeComposition.duration,
    backgroundColor: activeComposition.backgroundColor,
  });
  await openComposition(scratch.id);
  await openComposition(activeComposition.id);
  await waitForFrames(2, 180);

  const after = readFixtureFromStore(plateClipId, textClipId);
  if (!after.ok) throw new Error(after.error);

  return {
    passed: sameFixtureView(before.view, after.view),
    before: before.view,
    after: after.view,
    serializedTrackCount: serialized.tracks.length,
    serializedClipCount: serialized.clips.length,
    persistenceScope: 'composition-save-reopen',
    projectPersistenceCovered: false,
    limitation: 'This gate exercises the normal composition serializer and save/reopen path, but does not reload an IndexedDB project or an exported project file.',
  };
}

function readFiniteDimension(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return Math.round(clampNumber(value, fallback, min, max));
}

async function captureFixture(
  options: MotionDesignMd0CaptureOptions,
): Promise<MotionDesignMd0CaptureEvidence> {
  const result = await handleCaptureFrame({
    time: options.sampleTimeSeconds,
    mode: options.captureMode,
  }, useTimelineStore.getState());
  if (!result.success) {
    throw new Error(result.error ?? 'MD0 preview capture failed');
  }

  const data = getResultDataObject(result);
  const dataUrl = typeof data.dataUrl === 'string' ? data.dataUrl : '';
  if (!dataUrl.startsWith('data:image/png')) {
    throw new Error('MD0 preview capture did not return a PNG data URL');
  }

  return {
    capturedAt: typeof data.capturedAt === 'number' ? data.capturedAt : options.sampleTimeSeconds,
    width: typeof data.width === 'number' ? data.width : 0,
    height: typeof data.height === 'number' ? data.height : 0,
    mode: typeof data.mode === 'string' ? data.mode : options.captureMode,
    canvasSource: typeof data.canvasSource === 'string' ? data.canvasSource : null,
    fingerprint: await fingerprintDataUrl(dataUrl, {
      sampleWidth: options.sampleWidth,
      sampleHeight: options.sampleHeight,
    }),
    dataUrl,
    renderDiagnostics: data.renderDiagnostics ?? null,
  };
}

async function runFixtureExportParity(
  options: MotionDesignMd0ExportOptions,
): Promise<ToolResult> {
  return handleRunTimelineCanvasExportPreviewParitySmoke({
    createSynthetic: false,
    restoreTimelineAfterRun: true,
    requireTimelineDom: false,
    includePrecise: false,
    includeAudio: false,
    sampleTimes: [options.sampleTimeSeconds],
    exportDurationSeconds: 0.5,
    width: options.width,
    height: options.height,
    fps: options.fps,
    sampleWidth: options.sampleWidth,
    sampleHeight: options.sampleHeight,
    captureMode: options.captureMode === 'dom' ? 'dom' : 'gpu',
    ...options.thresholds,
  });
}

async function materializeNestedFixture(
  options: MotionDesignMd0NestedOptions,
): Promise<MotionDesignMd0NestedFixtureEvidence> {
  const timelineData = {
    ...useTimelineStore.getState().getSerializableState(),
    duration: options.durationSeconds,
    durationLocked: true,
  };
  const media = useMediaStore.getState();
  const child = media.createComposition('MD0 Evidence - Lower Third Child', {
    width: options.width,
    height: options.height,
    frameRate: options.frameRate,
    duration: options.durationSeconds,
    backgroundColor: options.backgroundColor,
    timelineData,
  });
  const parent = useMediaStore.getState().createComposition('MD0 Evidence - Lower Third Nested', {
    width: options.width,
    height: options.height,
    frameRate: options.frameRate,
    duration: options.durationSeconds,
    backgroundColor: options.backgroundColor,
  });

  await openComposition(parent.id);
  let parentTrack = useTimelineStore.getState().tracks.find((track) => (
    track.type === 'video' && track.locked !== true
  ));
  if (!parentTrack) {
    const parentTrackId = useTimelineStore.getState().addTrack('video');
    parentTrack = useTimelineStore.getState().tracks.find((track) => track.id === parentTrackId);
  }
  if (!parentTrack) {
    throw new Error('MD0 nested evidence parent has no writable video track');
  }

  const nestedClip = await addCompositionSegment({
    composition: child,
    trackId: parentTrack.id,
    startTime: 0,
    name: 'MD0 Evidence - Nested Lower Third',
  });
  useTimelineStore.setState({
    duration: options.durationSeconds,
    durationLocked: true,
    playheadPosition: 0,
  });
  saveActiveTimelineToComposition(parent.id, options.durationSeconds);
  renderHostPort.setResolution(options.width, options.height);
  renderHostPort.requestNewFrameRender();
  await waitForFrames(4, 240);

  return {
    childCompositionId: child.id,
    parentCompositionId: parent.id,
    nestedClipId: nestedClip.id,
    parentTrackId: parentTrack.id,
  };
}

function compactStats(result: ToolResult): Record<string, unknown> {
  const data = getResultDataObject(result);
  return {
    engineReady: data.engineReady ?? null,
    activeComposition: data.activeComposition ?? null,
    motionDesign: data.motionDesign ?? null,
    gpu: data.gpu ?? null,
    engineInfra: data.engineInfra ?? null,
    workerFirstRenderer: data.workerFirstRenderer ?? null,
    export: data.export ?? null,
  };
}

interface MotionDesignMd0FullRestoreState {
  readonly smoke: TimelineCanvasSmokeRestoreState;
  readonly timelineState: ReturnType<typeof useTimelineStore.getState>;
  readonly mediaState: ReturnType<typeof useMediaStore.getState>;
  readonly historyState: ReturnType<typeof useHistoryStore.getState>;
  readonly timelineSerializableJson: string;
  readonly renderDimensions: { readonly width: number; readonly height: number };
}

function comparableStateFieldMismatches(
  current: Record<string, unknown>,
  expected: Record<string, unknown>,
  ignoredKeys: ReadonlySet<string> = new Set(),
): string[] {
  const equivalent = (actual: unknown, expectedValue: unknown): boolean => {
    if (Object.is(actual, expectedValue)) return true;
    if (actual instanceof Set && expectedValue instanceof Set) {
      return actual.size === expectedValue.size
        && [...expectedValue].every((value) => actual.has(value));
    }
    if (actual instanceof Map && expectedValue instanceof Map) {
      if (actual.size !== expectedValue.size) return false;
      return [...expectedValue].every(([key, value]) => (
        actual.has(key)
        && JSON.stringify(actual.get(key)) === JSON.stringify(value)
      ));
    }
    if (
      actual !== null
      && expectedValue !== null
      && typeof actual === 'object'
      && typeof expectedValue === 'object'
    ) {
      try {
        return JSON.stringify(actual) === JSON.stringify(expectedValue);
      } catch {
        return false;
      }
    }
    return false;
  };
  return Object.keys(expected).filter((key) => (
    !ignoredKeys.has(key)
    && typeof expected[key] !== 'function'
    && !equivalent(current[key], expected[key])
  ));
}

export function captureMotionDesignMd0RestoreState(): MotionDesignMd0FullRestoreState {
  const timelineState = useTimelineStore.getState();
  return {
    smoke: captureTimelineCanvasSmokeRestoreState(),
    timelineState,
    mediaState: useMediaStore.getState(),
    historyState: useHistoryStore.getState(),
    timelineSerializableJson: JSON.stringify(timelineState.getSerializableState()),
    renderDimensions: renderHostPort.getOutputDimensions(),
  };
}

async function restoreMotionDesignMd0StateInternal(
  snapshot: MotionDesignMd0FullRestoreState,
): Promise<MotionDesignMd0RestoreEvidence> {
  const failures: string[] = [];
  let smokeRestore: unknown = null;

  try {
    smokeRestore = await restoreTimelineCanvasSmokeState(snapshot.smoke);
  } catch (error) {
    failures.push(`smoke restore failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    useMediaStore.setState(snapshot.mediaState);
  } catch (error) {
    failures.push(`media restore failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    useTimelineStore.setState(snapshot.timelineState);
  } catch (error) {
    failures.push(`timeline restore failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    useHistoryStore.setState(snapshot.historyState);
  } catch (error) {
    failures.push(`history restore failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    renderHostPort.setResolution(
      snapshot.renderDimensions.width,
      snapshot.renderDimensions.height,
    );
    renderHostPort.requestNewFrameRender();
    await waitForFrames(2, 180);
  } catch (error) {
    failures.push(`render resolution restore failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const timelineState = useTimelineStore.getState();
  const mediaState = useMediaStore.getState();
  const historyState = useHistoryStore.getState();
  const timelineFieldMismatches = comparableStateFieldMismatches(
    timelineState as unknown as Record<string, unknown>,
    snapshot.timelineState as unknown as Record<string, unknown>,
    // The revision middleware is deliberately monotonic and cannot be rewound.
    new Set(['timelineRevision']),
  );
  const mediaFieldMismatches = comparableStateFieldMismatches(
    mediaState as unknown as Record<string, unknown>,
    snapshot.mediaState as unknown as Record<string, unknown>,
  );
  const historyFieldMismatches = comparableStateFieldMismatches(
    historyState as unknown as Record<string, unknown>,
    snapshot.historyState as unknown as Record<string, unknown>,
  );
  const renderDimensions = renderHostPort.getOutputDimensions();
  if (JSON.stringify(timelineState.getSerializableState()) !== snapshot.timelineSerializableJson) {
    failures.push('timeline serializer state differs after restore');
  }
  if (timelineFieldMismatches.length > 0) {
    failures.push(`timeline fields differ after restore: ${timelineFieldMismatches.join(', ')}`);
  }
  if (mediaFieldMismatches.length > 0) {
    failures.push(`media fields differ after restore: ${mediaFieldMismatches.join(', ')}`);
  }
  if (historyFieldMismatches.length > 0) {
    failures.push(`history fields differ after restore: ${historyFieldMismatches.join(', ')}`);
  }
  if (
    renderDimensions.width !== snapshot.renderDimensions.width
    || renderDimensions.height !== snapshot.renderDimensions.height
  ) {
    failures.push('render resolution differs after restore');
  }

  return {
    verified: failures.length === 0,
    failures,
    smokeRestore,
    renderResolution: {
      before: snapshot.renderDimensions,
      after: renderDimensions,
    },
    timelineFieldMismatches,
    mediaFieldMismatches,
    historyFieldMismatches,
  };
}

export async function restoreMotionDesignMd0State(
  snapshot: MotionDesignMd0FullRestoreState,
): Promise<MotionDesignMd0RestoreEvidence> {
  const endRestoreMutation = beginTimelineCanvasSmokeMutation();
  useHistoryStore.setState({ isApplying: true });
  try {
    return await restoreMotionDesignMd0StateInternal(snapshot);
  } finally {
    endRestoreMutation();
  }
}

function beginMotionDesignMd0Mutation(): () => void {
  const endSmokeMutation = beginTimelineCanvasSmokeMutation();
  try {
    // Prevent evidence-only composition switches from entering undo/redo history.
    useHistoryStore.setState({ isApplying: true });
  } catch (error) {
    endSmokeMutation();
    throw error;
  }
  return endSmokeMutation;
}

const DEFAULT_DEPS: MotionDesignMd0EvidenceDeps = {
  beginMutation: beginMotionDesignMd0Mutation,
  captureRestoreState: captureMotionDesignMd0RestoreState,
  restoreTimeline: (snapshot) => restoreMotionDesignMd0State(
    snapshot as MotionDesignMd0FullRestoreState,
  ),
  readFixture: readFixtureFromStore,
  roundTrip: roundTripFixture,
  capture: captureFixture,
  runExportParity: runFixtureExportParity,
  materializeNested: materializeNestedFixture,
  getStats: () => handleGetStats(),
  compareFingerprints: compareFrameFingerprints,
};

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveCaptureMode(value: unknown): PreviewCaptureMode {
  return value === 'gpu' || value === 'dom' || value === 'auto' ? value : 'auto';
}

function hasCallerProofPayload(args: Record<string, unknown>): boolean {
  return [
    'dataUrl',
    'fingerprint',
    'directFingerprint',
    'nestedFingerprint',
    'exportResult',
    'timelineData',
    'tracks',
    'clips',
  ].some((key) => args[key] !== undefined);
}

export async function handleRunMotionDesignMd0Evidence(
  args: Record<string, unknown>,
  deps: MotionDesignMd0EvidenceDeps = DEFAULT_DEPS,
): Promise<ToolResult> {
  if (hasCallerProofPayload(args)) {
    return {
      success: false,
      error: 'MD0 evidence pixels, fingerprints, exports, and timeline payloads are captured by the browser and cannot be caller-supplied.',
    };
  }
  if (args.restoreTimelineAfterRun === false) {
    return {
      success: false,
      error: 'MD0 evidence always restores timeline, media, history, and render resolution; restoreTimelineAfterRun=false is forbidden.',
    };
  }

  const plateClipId = optionalString(args.plateClipId);
  const textClipId = optionalString(args.textClipId);
  if (!plateClipId || !textClipId) {
    return { success: false, error: 'plateClipId and textClipId are required.' };
  }

  const initialFixture = deps.readFixture(plateClipId, textClipId);
  if (!initialFixture.ok) {
    return { success: false, error: initialFixture.error };
  }

  const sampleTimeSeconds = clampNumber(
    args.sampleTimeSeconds,
    DEFAULT_SAMPLE_TIME_SECONDS,
    0,
    Math.max(0, initialFixture.view.durationSeconds - 0.1),
  );
  const width = readFiniteDimension(args.width, DEFAULT_EXPORT_WIDTH, 64, 3840);
  const height = readFiniteDimension(args.height, DEFAULT_EXPORT_HEIGHT, 64, 2160);
  const fps = clampNumber(args.fps, DEFAULT_EXPORT_FPS, 1, 60);
  const sampleWidth = readFiniteDimension(args.sampleWidth, DEFAULT_SAMPLE_WIDTH, 4, 256);
  const sampleHeight = readFiniteDimension(args.sampleHeight, DEFAULT_SAMPLE_HEIGHT, 4, 256);
  const captureMode = resolveCaptureMode(args.captureMode);
  const thresholds: FrameFingerprintComparisonThresholds = {
    maxAvgRgbDelta: clampNumber(args.maxAvgRgbDelta, 12, 0, 255),
    maxMeanLumaDelta: clampNumber(args.maxMeanLumaDelta, 12, 0, 255),
    maxNonBlankRatioDelta: clampNumber(args.maxNonBlankRatioDelta, 0.08, 0, 1),
    minReferenceNonBlankRatio: clampNumber(args.minReferenceNonBlankRatio, 0.02, 0, 1),
    minCandidateNonBlankRatio: clampNumber(args.minCandidateNonBlankRatio, 0.02, 0, 1),
    maxColorRangeDelta: clampNumber(args.maxColorRangeDelta, 32, 0, 255),
  };
  const captureOptions: MotionDesignMd0CaptureOptions = {
    sampleTimeSeconds,
    captureMode,
    sampleWidth,
    sampleHeight,
  };
  const exportOptions: MotionDesignMd0ExportOptions = {
    ...captureOptions,
    width,
    height,
    fps,
    thresholds,
  };
  const restoreState = deps.captureRestoreState();
  const endMutation = deps.beginMutation();
  const failures: string[] = [];
  let restore: MotionDesignMd0RestoreEvidence | null = null;
  let roundTrip: MotionDesignMd0RoundTripEvidence | null = null;
  let direct: MotionDesignMd0CaptureEvidence | null = null;
  let directExport: ToolResult | null = null;
  let nestedFixture: MotionDesignMd0NestedFixtureEvidence | null = null;
  let nested: MotionDesignMd0CaptureEvidence | null = null;
  let nestedExport: ToolResult | null = null;
  let directNestedComparison: FrameFingerprintComparison | null = null;
  let stats: Record<string, unknown> | null = null;

  try {
    roundTrip = await deps.roundTrip(plateClipId, textClipId);
    if (!roundTrip.passed) {
      failures.push('Motion Design fixture changed during timeline serializer loadState round-trip.');
    }

    direct = await deps.capture(captureOptions);
    if (direct.fingerprint.nonBlankRatio < (thresholds.minReferenceNonBlankRatio ?? 0.02)) {
      failures.push(`Direct preview nonBlankRatio ${direct.fingerprint.nonBlankRatio} is below the evidence threshold.`);
    }
    if (
      direct.width !== initialFixture.view.composition.width
      || direct.height !== initialFixture.view.composition.height
    ) {
      failures.push(
        `Direct preview geometry ${direct.width}x${direct.height} does not match fixture composition ${initialFixture.view.composition.width}x${initialFixture.view.composition.height}.`,
      );
    }

    directExport = await deps.runExportParity(exportOptions);
    if (!directExport.success) {
      failures.push(`Direct export parity failed: ${directExport.error ?? 'unknown error'}`);
    }

    nestedFixture = await deps.materializeNested({
      durationSeconds: initialFixture.view.durationSeconds,
      width: initialFixture.view.composition.width,
      height: initialFixture.view.composition.height,
      frameRate: initialFixture.view.composition.frameRate,
      backgroundColor: initialFixture.view.composition.backgroundColor,
    });
    nested = await deps.capture(captureOptions);
    if (
      nested.width !== initialFixture.view.composition.width
      || nested.height !== initialFixture.view.composition.height
    ) {
      failures.push(
        `Nested preview geometry ${nested.width}x${nested.height} does not match fixture composition ${initialFixture.view.composition.width}x${initialFixture.view.composition.height}.`,
      );
    }
    nestedExport = await deps.runExportParity(exportOptions);
    if (!nestedExport.success) {
      failures.push(`Nested export parity failed: ${nestedExport.error ?? 'unknown error'}`);
    }

    directNestedComparison = deps.compareFingerprints(
      direct.fingerprint,
      nested.fingerprint,
      thresholds,
    );
    failures.push(...directNestedComparison.failures.map((failure) => (
      `Direct/nested preview ${failure}`
    )));

    const statsResult = await deps.getStats();
    if (!statsResult.success) {
      failures.push(`Runtime stats failed: ${statsResult.error ?? 'unknown error'}`);
    } else {
      stats = compactStats(statsResult);
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  } finally {
    try {
      restore = await deps.restoreTimeline(restoreState);
      if (!restore.verified) {
        failures.push(...restore.failures.map((failure) => `Timeline restore ${failure}`));
      }
    } catch (error) {
      failures.push(`Timeline restore failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      endMutation();
    }
  }

  return {
    success: failures.length === 0,
    ...(failures.length > 0 ? { error: failures.join('; ') } : {}),
    data: {
      fixture: initialFixture.view,
      sampleTimeSeconds,
      fingerprintOptions: { sampleWidth, sampleHeight },
      comparisonThresholds: thresholds,
      roundTrip,
      direct,
      directExport: directExport?.data ?? null,
      nestedFixture,
      nested,
      nestedExport: nestedExport?.data ?? null,
      directNestedComparison,
      stats,
      exportProofScope: 'FrameExporter-published export preview fingerprints plus a nonempty encoded blob; encoded MP4/WebM bytes are not decoded for this gate.',
      restore: {
        enabled: true,
        result: restore,
      },
      failures,
    },
  };
}
