import { useTimelineStore } from '../../../../../stores/timeline';
import { useMediaStore } from '../../../../../stores/mediaStore';
import { useExportStore } from '../../../../../stores/exportStore';
import {
  isHistoryDisabledForDebug,
  setHistoryDisabledForDebug,
  useHistoryStore,
} from '../../../../../stores/historyStore';
import { projectFileService } from '../../../../projectFileService';
import { renderHostPort } from '../../../../render/renderHostPort';
import {
  MD1_GOLDEN_CROPS,
  MD1_GOLDEN_SURFACES,
  createMd1GoldenFixture,
  type Md1GoldenSurface,
} from '../../../../motionDesign/evidence/md1GoldenFixture';
import {
  MD1_GOLDEN_PIXEL_THRESHOLDS,
  compareMd1PixelBuffers,
  cropMd1PixelBuffer,
  measureMd1PixelCoverage,
  type Md1PixelBuffer,
  type Md1PixelComparison,
} from '../../../../motionDesign/evidence/md1PixelComparison';
import { handleDebugExport } from '../../../handlers/export';
import { waitForFrames } from '../../../handlers/smokes/smokeRuntime';
import { captureRenderHostFrame } from '../../../previewCapture';

type SurfaceDataUrls = Partial<Record<Md1GoldenSurface, string>>;

type TimelineState = ReturnType<typeof useTimelineStore.getState>;
type HistoryState = ReturnType<typeof useHistoryStore.getState>;
type MediaState = ReturnType<typeof useMediaStore.getState>;
type ExportState = ReturnType<typeof useExportStore.getState>;

const TIMELINE_RESTORE_KEYS = [
  'tracks', 'clips', 'playheadPosition', 'duration', 'durationLocked', 'zoom', 'scrollX',
  'trackHeaderWidth', 'timelineSplitRatio', 'snappingEnabled', 'inPoint', 'outPoint',
  'loopPlayback', 'playbackSpeed', 'isPlaying', 'selectedClipIds',
  'primarySelectedClipId', 'propertiesSelection', 'targetTrackIdByType', 'layers',
  'selectedLayerId', 'clipKeyframes', 'markers', 'tempoMap', 'rulerLanes',
  'activeRulerLaneId', 'videoBakeRegions', 'masterAudioState', 'keyframeRecordingEnabled',
  'expandedTracks', 'expandedTrackPropertyGroups', 'selectedKeyframeIds',
  'expandedCurveProperties', 'curveEditorHeight', 'maskEditMode', 'maskPanelActive',
  'activeMaskId', 'selectedVertexIds', 'selectedMaskEdgeId', 'maskFeatherPreview',
  'maskDrawStart', 'maskDragging', 'maskEditPreview', 'toolMode',
  'activeTimelineToolId', 'previousTimelineToolId', 'lastTimelineToolByGroup',
  'openTimelineToolGroupId', 'momentaryTimelineToolId', 'timelineRangeSelection',
  'timelineToolPreview', 'transitionEditPreview', 'clipDragPreview', 'layerTransformPreview',
  'isExporting', 'exportProgress', 'exportCurrentTime', 'exportRange',
  'exportPreviewFrameTime',
  'clipboardData', 'clipboardKeyframes', 'clipboardEffects', 'clipboardColor', 'clipboardMask',
] as const satisfies readonly (keyof TimelineState)[];

const HISTORY_RESTORE_KEYS = [
  'nodes', 'rootId', 'activeNodeId', 'lastVisitedChildByNodeId', 'eventLog',
  'maxHistoryNodes', 'isApplying', 'batchId', 'batchLabel',
] as const satisfies readonly (keyof HistoryState)[];

const MEDIA_RESTORE_KEYS = [
  'files', 'compositions', 'folders', 'textItems', 'solidItems', 'meshItems',
  'cameraItems', 'lightItems', 'splatEffectorItems', 'mathSceneItems',
  'motionShapeItems', 'signalAssets', 'signalArtifacts', 'signalGraphs',
  'signalOperators', 'activeCompositionId', 'openCompositionIds', 'slotAssignments',
  'slotDeckStates', 'slotClipSettings', 'selectedSlotCompositionId',
  'previewCompositionId', 'sourceMonitorFileId', 'sourceMonitorPlaybackRequestId',
  'sourceMonitorCropRequestId', 'sourceMonitorInPoint', 'sourceMonitorOutPoint',
  'activeLayerSlots', 'layerOpacities', 'selectedIds', 'expandedFolderIds',
  'currentProjectId', 'currentProjectName', 'isLoading', 'projectLoadProgress',
  'proxyEnabled', 'proxyGenerationQueue', 'currentlyGeneratingProxyId', 'proxyFolderName',
] as const satisfies readonly (keyof MediaState)[];

const EXPORT_RESTORE_KEYS = [
  'settings', 'presets', 'selectedPresetId', 'batch',
] as const satisfies readonly (keyof ExportState)[];

type Md1EvidenceRestoreSnapshot = {
  timeline: Partial<TimelineState>;
  history: Partial<HistoryState>;
  media: Partial<MediaState>;
  exportStore: Partial<ExportState>;
  historyWasDisabled: boolean;
  renderDimensions: { width: number; height: number };
};

function pickState<T extends object, K extends readonly (keyof T)[]>(state: T, keys: K): Pick<T, K[number]> {
  return Object.fromEntries(keys.map((key) => [key, state[key]])) as Pick<T, K[number]>;
}

export function captureMd1EvidenceRestoreSnapshot(): Md1EvidenceRestoreSnapshot {
  return {
    timeline: pickState(useTimelineStore.getState(), TIMELINE_RESTORE_KEYS),
    history: pickState(useHistoryStore.getState(), HISTORY_RESTORE_KEYS),
    media: pickState(useMediaStore.getState(), MEDIA_RESTORE_KEYS),
    exportStore: pickState(useExportStore.getState(), EXPORT_RESTORE_KEYS),
    historyWasDisabled: isHistoryDisabledForDebug(),
    renderDimensions: renderHostPort.getOutputDimensions(),
  };
}

export function restoreMd1EvidenceSnapshot(snapshot: Md1EvidenceRestoreSnapshot): void {
  useMediaStore.setState(snapshot.media);
  useExportStore.setState(snapshot.exportStore);
  // Evidence exports own any preview bitmap they publish. Dispose it through
  // the canonical store action before restoring serializable timeline state.
  useTimelineStore.getState().setExportPreviewFrame(null, null);
  useTimelineStore.setState(snapshot.timeline);
  useHistoryStore.setState(snapshot.history);
  setHistoryDisabledForDebug(snapshot.historyWasDisabled);
  renderHostPort.setResolution(snapshot.renderDimensions.width, snapshot.renderDimensions.height);
  renderHostPort.requestRender();
}

export function assertMd1RestorableExportState(
  state: Pick<TimelineState, 'isExporting' | 'exportPreviewFrame'>,
): void {
  if (state.isExporting) {
    throw new Error('MD1 evidence refuses a session with an export in progress');
  }
  if (state.exportPreviewFrame !== null) {
    throw new Error('MD1 evidence requires a disposable session with no existing export preview frame');
  }
}

export async function runWithMd1EvidenceRestore<T>(
  operation: () => Promise<T>,
  restore: () => void | Promise<void>,
): Promise<T> {
  try {
    return await operation();
  } finally {
    await restore();
  }
}

function normalizedSessionUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  return url.href;
}

export function assertMd1DisposableEvidenceSession(args: Record<string, unknown>): URL {
  if (args.confirmDisposableSession !== true) {
    throw new Error('MD1 evidence requires confirmDisposableSession=true');
  }
  if (typeof args.expectedSessionUrl !== 'string' || !args.expectedSessionUrl.trim()) {
    throw new Error('MD1 evidence requires an explicit expectedSessionUrl');
  }

  const expected = new URL(args.expectedSessionUrl);
  const host = expected.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || !host.endsWith('.localhost')) {
    throw new Error('MD1 evidence requires a dedicated *.localhost disposable session');
  }
  if (!expected.searchParams.get('motionDesignEvidenceSession')) {
    throw new Error('MD1 evidence URL must include motionDesignEvidenceSession');
  }
  if (normalizedSessionUrl(expected.href) !== normalizedSessionUrl(window.location.href)) {
    throw new Error('MD1 evidence expectedSessionUrl does not match this browser tab');
  }
  if (projectFileService.isProjectOpen()) {
    throw new Error('MD1 evidence refuses a tab with an open project');
  }
  const timeline = useTimelineStore.getState();
  if (timeline.clips.length > 0) {
    throw new Error('MD1 evidence refuses a non-empty timeline');
  }
  assertMd1RestorableExportState(timeline);
  return expected;
}

async function dataUrlToPixelBuffer(dataUrl: string): Promise<Md1PixelBuffer> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Unable to create MD1 evidence canvas context');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: pixels.data };
}

function imageBitmapToDataUrl(bitmap: ImageBitmap): string {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create MD1 export preview canvas context');
  context.drawImage(bitmap, 0, 0);
  return canvas.toDataURL('image/png');
}

async function renderPreviewDataUrl(sampleTime: number): Promise<string> {
  useTimelineStore.getState().setPlayheadPosition(sampleTime);
  renderHostPort.requestRender();
  await waitForFrames(3, 240);
  const capture = await captureRenderHostFrame('gpu');
  if (!capture.success) throw new Error(capture.error);
  return capture.dataUrl;
}

async function renderExportPreviewDataUrl(
  sampleTime: number,
  width: number,
  height: number,
  args: Record<string, unknown>,
): Promise<string> {
  let dataUrl: string | null = null;
  let closestTimeDelta = Number.POSITIVE_INFINITY;
  const unsubscribe = useTimelineStore.subscribe((state, previous) => {
    if (!state.exportPreviewFrame || state.exportPreviewFrame === previous.exportPreviewFrame) return;
    const frameTime = state.exportPreviewFrameTime ?? state.exportCurrentTime;
    const delta = typeof frameTime === 'number' && Number.isFinite(frameTime)
      ? Math.abs(frameTime - sampleTime)
      : Number.POSITIVE_INFINITY;
    if (dataUrl === null || delta < closestTimeDelta) {
      dataUrl = imageBitmapToDataUrl(state.exportPreviewFrame);
      closestTimeDelta = delta;
    }
  });

  try {
    const result = await handleDebugExport({
      startTime: sampleTime,
      durationSeconds: 0.25,
      width,
      height,
      fps: 8,
      includeAudio: false,
      exportMode: 'fast',
      download: false,
      maxRuntimeMs: 20_000,
      ...(typeof args.codec === 'string' ? { codec: args.codec } : {}),
      ...(typeof args.container === 'string' ? { container: args.container } : {}),
    });
    await waitForFrames(2, 180);
    if (!result.success) throw new Error(result.error ?? 'MD1 debug export failed');
    if (!dataUrl) throw new Error('MD1 debug export published no preview frame');
    return dataUrl;
  } finally {
    unsubscribe();
  }
}

function compareSurfaces(
  pixels: Record<Md1GoldenSurface, Md1PixelBuffer>,
): Record<string, Md1PixelComparison> {
  return {
    'direct-preview-vs-export': compareMd1PixelBuffers(
      pixels['direct-preview'],
      pixels['direct-export'],
      MD1_GOLDEN_PIXEL_THRESHOLDS,
    ),
    'nested-preview-vs-export': compareMd1PixelBuffers(
      pixels['nested-preview'],
      pixels['nested-export'],
      MD1_GOLDEN_PIXEL_THRESHOLDS,
    ),
    'direct-vs-nested-preview': compareMd1PixelBuffers(
      pixels['direct-preview'],
      pixels['nested-preview'],
      MD1_GOLDEN_PIXEL_THRESHOLDS,
    ),
  };
}

function readBaselines(args: Record<string, unknown>): SurfaceDataUrls {
  if (!args.baselines || typeof args.baselines !== 'object' || Array.isArray(args.baselines)) return {};
  const source = args.baselines as Record<string, unknown>;
  return Object.fromEntries(
    MD1_GOLDEN_SURFACES.flatMap((surface) =>
      typeof source[surface] === 'string' ? [[surface, source[surface] as string]] : [],
    ),
  );
}

type Md1ControlFixture = ReturnType<typeof createMd1GoldenFixture>;

interface Md1DifferentialControl {
  id: string;
  cropId: 'rectangle' | 'ellipse' | 'polygon' | 'star';
  mutate: (fixture: Md1ControlFixture) => void;
}

function requiredControlClip(fixture: Md1ControlFixture, clipId: string) {
  const clip = fixture.clips.find((candidate) => candidate.id === clipId);
  if (!clip) throw new Error(`MD1 differential control clip missing: ${clipId}`);
  return clip;
}

function requiredAppearance(fixture: Md1ControlFixture, clipId: string, appearanceId: string) {
  const appearance = requiredControlClip(fixture, clipId).motion?.appearance?.items
    .find((candidate) => candidate.id === appearanceId);
  if (!appearance) throw new Error(`MD1 differential control appearance missing: ${appearanceId}`);
  return appearance;
}

const MD1_DIFFERENTIAL_CONTROLS: readonly Md1DifferentialControl[] = [
  {
    id: 'ordered-appearance-stack',
    cropId: 'rectangle',
    mutate: (fixture) => requiredControlClip(fixture, 'md1-clip-rectangle')
      .motion!.appearance!.items.reverse(),
  },
  {
    id: 'mask-enabled',
    cropId: 'polygon',
    mutate: (fixture) => { requiredControlClip(fixture, 'md1-clip-polygon').masks![0].enabled = false; },
  },
  {
    id: 'effect-enabled',
    cropId: 'polygon',
    mutate: (fixture) => { requiredControlClip(fixture, 'md1-clip-polygon').effects[0].enabled = false; },
  },
  {
    id: 'clip-opacity',
    cropId: 'ellipse',
    mutate: (fixture) => { requiredControlClip(fixture, 'md1-clip-ellipse').transform.opacity = 0.2; },
  },
  {
    id: 'clip-blend-mode',
    cropId: 'star',
    mutate: (fixture) => { requiredControlClip(fixture, 'md1-clip-star').transform.blendMode = 'normal'; },
  },
  {
    id: 'appearance-opacity',
    cropId: 'polygon',
    mutate: (fixture) => { requiredAppearance(fixture, 'md1-clip-polygon', 'md1-polygon-fill').opacity = 0.15; },
  },
  {
    id: 'appearance-blend-mode',
    cropId: 'rectangle',
    mutate: (fixture) => { requiredAppearance(fixture, 'md1-clip-rectangle', 'md1-rect-gradient').blendMode = 'difference'; },
  },
  {
    id: 'appearance-visibility',
    cropId: 'rectangle',
    mutate: (fixture) => { requiredAppearance(fixture, 'md1-clip-rectangle', 'md1-rect-fill').visible = false; },
  },
  {
    id: 'gradient-rendering',
    cropId: 'ellipse',
    mutate: (fixture) => { requiredAppearance(fixture, 'md1-clip-ellipse', 'md1-ellipse-radial').visible = false; },
  },
  {
    id: 'stroke-rendering',
    cropId: 'rectangle',
    mutate: (fixture) => {
      requiredAppearance(fixture, 'md1-clip-rectangle', 'md1-rect-stroke-wide').visible = false;
      requiredAppearance(fixture, 'md1-clip-rectangle', 'md1-rect-stroke-thin').visible = false;
    },
  },
];

export const MD1_DIFFERENTIAL_CONTROL_IDS = MD1_DIFFERENTIAL_CONTROLS.map(
  (control) => control.id,
);

export const MD1_TEMPORAL_DIFFERENTIAL_CROP_IDS = ['rectangle', 'star'] as const;

async function runMd1DifferentialControls(
  baseline: Md1PixelBuffer,
  sampleTime: number,
): Promise<{ comparisons: Record<string, Md1PixelComparison>; failures: string[] }> {
  const comparisons: Record<string, Md1PixelComparison> = {};
  const failures: string[] = [];
  for (const control of MD1_DIFFERENTIAL_CONTROLS) {
    const fixture = createMd1GoldenFixture();
    control.mutate(fixture);
    useTimelineStore.setState({
      tracks: fixture.tracks,
      clips: fixture.clips,
      clipKeyframes: fixture.keyframes,
      duration: fixture.duration,
      playheadPosition: sampleTime,
    });
    const controlPixels = await dataUrlToPixelBuffer(await renderPreviewDataUrl(sampleTime));
    const crop = MD1_GOLDEN_CROPS.find((candidate) => candidate.id === control.cropId)!;
    const comparison = compareMd1PixelBuffers(
      cropMd1PixelBuffer(baseline, crop),
      cropMd1PixelBuffer(controlPixels, crop),
      MD1_GOLDEN_PIXEL_THRESHOLDS,
    );
    comparisons[control.id] = comparison;
    if (comparison.changedPixelRatio < 0.0005 || comparison.meanAbsoluteChannelDelta < 0.02) {
      failures.push(`${control.id} did not materially affect the ${control.cropId} crop`);
    }
  }
  return { comparisons, failures };
}

export async function runMotionDesignMd1EvidenceDebugAction(args: Record<string, unknown>) {
  const sessionUrl = assertMd1DisposableEvidenceSession(args);
  const restoreSnapshot = captureMd1EvidenceRestoreSnapshot();
  setHistoryDisabledForDebug(true);
  return runWithMd1EvidenceRestore(async () => {
    const fixture = createMd1GoldenFixture();
    const surfaces: SurfaceDataUrls = {};
    const staticSurfaces: SurfaceDataUrls = {};
    const failures: string[] = [];
    try {
    useMediaStore.setState((state) => ({
      compositions: [
        ...state.compositions.filter((composition) => composition.id !== fixture.nestedComposition.id),
        fixture.nestedComposition,
      ],
    }));
    renderHostPort.setResolution(fixture.width, fixture.height);
    useTimelineStore.setState({
      tracks: fixture.tracks,
      clips: fixture.clips,
      clipKeyframes: fixture.keyframes,
      duration: fixture.duration,
      durationLocked: true,
      playheadPosition: fixture.sampleTime,
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
    });
    staticSurfaces['direct-preview'] = await renderPreviewDataUrl(0);
    staticSurfaces['direct-export'] = await renderExportPreviewDataUrl(
      0,
      fixture.width,
      fixture.height,
      args,
    );
    surfaces['direct-preview'] = await renderPreviewDataUrl(fixture.sampleTime);
    surfaces['direct-export'] = await renderExportPreviewDataUrl(
      fixture.sampleTime,
      fixture.width,
      fixture.height,
      args,
    );

    const directPixelsForControl = await dataUrlToPixelBuffer(surfaces['direct-preview']!);
    const differentialControls = await runMd1DifferentialControls(
      directPixelsForControl,
      fixture.sampleTime,
    );
    failures.push(...differentialControls.failures);

    useTimelineStore.setState({
      tracks: [{
        id: 'md1-track-nested-wrapper',
        name: 'MD1 Nested Wrapper',
        type: 'video',
        height: 70,
        muted: false,
        visible: true,
        solo: false,
      }],
      clips: [fixture.nestedWrapperClip],
      clipKeyframes: new Map(),
    });
    staticSurfaces['nested-preview'] = await renderPreviewDataUrl(0);
    staticSurfaces['nested-export'] = await renderExportPreviewDataUrl(
      0,
      fixture.width,
      fixture.height,
      args,
    );
    surfaces['nested-preview'] = await renderPreviewDataUrl(fixture.sampleTime);
    surfaces['nested-export'] = await renderExportPreviewDataUrl(
      fixture.sampleTime,
      fixture.width,
      fixture.height,
      args,
    );

    const pixels = Object.fromEntries(await Promise.all(
      MD1_GOLDEN_SURFACES.map(async (surface) => [surface, await dataUrlToPixelBuffer(surfaces[surface]!)]),
    )) as Record<Md1GoldenSurface, Md1PixelBuffer>;
    const parity = compareSurfaces(pixels);
    for (const [name, comparison] of Object.entries(parity)) {
      failures.push(...comparison.failures.map((failure) => `${name}: ${failure}`));
    }

    const staticPixels = Object.fromEntries(await Promise.all(
      MD1_GOLDEN_SURFACES.map(async (surface) => [surface, await dataUrlToPixelBuffer(staticSurfaces[surface]!)]),
    )) as Record<Md1GoldenSurface, Md1PixelBuffer>;
    const staticParity = compareSurfaces(staticPixels);
    for (const [name, comparison] of Object.entries(staticParity)) {
      failures.push(...comparison.failures.map((failure) => `static ${name}: ${failure}`));
    }

    const temporalDifferentials: Record<string, Md1PixelComparison> = {};
    for (const surface of MD1_GOLDEN_SURFACES) {
      for (const cropId of MD1_TEMPORAL_DIFFERENTIAL_CROP_IDS) {
        const crop = MD1_GOLDEN_CROPS.find((candidate) => candidate.id === cropId)!;
        const comparison = compareMd1PixelBuffers(
          cropMd1PixelBuffer(staticPixels[surface], crop),
          cropMd1PixelBuffer(pixels[surface], crop),
          MD1_GOLDEN_PIXEL_THRESHOLDS,
        );
        const id = `${surface}:${cropId}`;
        temporalDifferentials[id] = comparison;
        if (comparison.changedPixelRatio < 0.0005 || comparison.meanAbsoluteChannelDelta < 0.02) {
          failures.push(`${id} ignored the animated-vs-static fixture delta`);
        }
      }
    }

    const cropCoverage = Object.fromEntries(MD1_GOLDEN_CROPS.map((crop) => {
      const coverage = measureMd1PixelCoverage(cropMd1PixelBuffer(pixels['direct-preview'], crop));
      if (coverage.nonBlackCoverage < 0.02 || coverage.lumaRange < 8) {
        failures.push(`${crop.id} crop lacks visible/color-range evidence`);
      }
      return [crop.id, coverage];
    }));

    const baselines = readBaselines(args);
    const baselineComparisons: Partial<Record<Md1GoldenSurface, Md1PixelComparison>> = {};
    for (const surface of MD1_GOLDEN_SURFACES) {
      const baseline = baselines[surface];
      if (!baseline) continue;
      const comparison = compareMd1PixelBuffers(
        await dataUrlToPixelBuffer(baseline),
        pixels[surface],
        MD1_GOLDEN_PIXEL_THRESHOLDS,
      );
      baselineComparisons[surface] = comparison;
      failures.push(...comparison.failures.map((failure) => `${surface} baseline: ${failure}`));
    }

    return {
      success: failures.length === 0,
      ...(failures.length > 0 ? { error: failures.join('; ') } : {}),
      data: {
        fixtureId: fixture.id,
        sessionUrl: normalizedSessionUrl(sessionUrl.href),
        surfaces,
        parity,
        staticSampleTime: 0,
        animatedSampleTime: fixture.sampleTime,
        staticParity,
        temporalDifferentials,
        baselineComparisons,
        cropCoverage,
        differentialControls: differentialControls.comparisons,
        failures,
      },
    };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        data: { fixtureId: fixture.id, surfaces, failures },
      };
    }
  }, () => restoreMd1EvidenceSnapshot(restoreSnapshot));
}
