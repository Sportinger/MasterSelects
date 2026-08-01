import { useDockStore } from '../../../../../stores/dockStore';
import { cloneDockLayout } from '../../../../../stores/dockStore/layoutPersistence';
import { useExportStore } from '../../../../../stores/exportStore';
import { useFlashBoardStore } from '../../../../../stores/flashboardStore';
import {
  isHistoryDisabledForDebug,
  setHistoryDisabledForDebug,
  useHistoryStore,
} from '../../../../../stores/historyStore';
import { useMediaStore } from '../../../../../stores/mediaStore';
import { useTimelineStore } from '../../../../../stores/timeline';
import type { Keyframe } from '../../../../../types/keyframes';
import type { DockLayout, DockNode, DockSplit } from '../../../../../types/dock';
import type { TimelineClip, TimelineTrack } from '../../../../../types/timeline';
import { findTimelineVerticalSplit } from '../../../../../components/timeline/hooks/useTimelineGraphPanelResize';
import { projectFileService } from '../../../../projectFileService';
import { layerBuilder } from '../../../../layerBuilder';
import { renderHostPort } from '../../../../render/renderHostPort';
import { rasterizeMd2SvgElement } from '../../../../motionDesign/evidence/md2DomCapture';
import {
  MD2_EVIDENCE_SURFACES,
  createMd2EvidenceFixture,
  type Md2EvidenceSequenceEntry,
  type Md2EvidenceSurface,
} from '../../../../motionDesign/evidence/md2EvidenceFixture';
import {
  MD1_GOLDEN_PIXEL_THRESHOLDS,
  compareMd1PixelBuffers,
  flattenPremultipliedMd1PixelBufferOnBlack,
  measureMd1PixelCoverage,
  type Md1PixelBuffer,
  type Md1PixelComparison,
} from '../../../../motionDesign/evidence/md1PixelComparison';
import { handleDebugExport } from '../../../handlers/export';
import { handleAddKeyframe } from '../../../handlers/keyframes';
import { waitForFrames } from '../../../handlers/smokes/smokeRuntime';
import { captureStableRenderHostFrame } from '../../../previewCapture';

type TimelineState = ReturnType<typeof useTimelineStore.getState>;
type HistoryState = ReturnType<typeof useHistoryStore.getState>;
type MediaState = ReturnType<typeof useMediaStore.getState>;
type ExportState = ReturnType<typeof useExportStore.getState>;
type SurfaceDataUrls = Partial<Record<Md2EvidenceSurface, string>>;

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

export interface Md2EvidenceRestoreSnapshot {
  timeline: Partial<TimelineState>;
  history: Partial<HistoryState>;
  media: Partial<MediaState>;
  exportStore: Partial<ExportState>;
  dockLayout: DockLayout;
  historyWasDisabled: boolean;
  renderDimensions: { width: number; height: number };
}

function pickState<T extends object, K extends readonly (keyof T)[]>(
  state: T,
  keys: K,
): Pick<T, K[number]> {
  return Object.fromEntries(keys.map((key) => [key, state[key]])) as Pick<T, K[number]>;
}

export function captureMd2EvidenceRestoreSnapshot(): Md2EvidenceRestoreSnapshot {
  return {
    timeline: pickState(useTimelineStore.getState(), TIMELINE_RESTORE_KEYS),
    history: pickState(useHistoryStore.getState(), HISTORY_RESTORE_KEYS),
    media: pickState(useMediaStore.getState(), MEDIA_RESTORE_KEYS),
    exportStore: pickState(useExportStore.getState(), EXPORT_RESTORE_KEYS),
    dockLayout: cloneDockLayout(useDockStore.getState().layout),
    historyWasDisabled: isHistoryDisabledForDebug(),
    renderDimensions: renderHostPort.getOutputDimensions(),
  };
}

export function restoreMd2EvidenceSnapshot(snapshot: Md2EvidenceRestoreSnapshot): void {
  useMediaStore.setState(snapshot.media);
  useExportStore.setState(snapshot.exportStore);
  useTimelineStore.getState().setExportPreviewFrame(null, null);
  useTimelineStore.setState(snapshot.timeline);
  useHistoryStore.setState(snapshot.history);
  useDockStore.setState({ layout: cloneDockLayout(snapshot.dockLayout) });
  setHistoryDisabledForDebug(snapshot.historyWasDisabled);
  renderHostPort.setResolution(snapshot.renderDimensions.width, snapshot.renderDimensions.height);
  renderHostPort.requestRender();
}

export function assertMd2RestorableExportState(
  state: Pick<TimelineState, 'isExporting' | 'exportPreviewFrame' | 'isPlaying'>,
): void {
  if (state.isPlaying) throw new Error('MD2 evidence refuses a session with playback active');
  if (state.isExporting) throw new Error('MD2 evidence refuses a session with an export in progress');
  if (state.exportPreviewFrame !== null) {
    throw new Error('MD2 evidence requires a disposable session with no existing export preview frame');
  }
}

export async function runWithMd2EvidenceRestore<T>(
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

function isDedicatedLocalhost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host.endsWith('.localhost')
    && host !== 'localhost'
    && host !== '127.0.0.1'
    && host !== '[::1]';
}

export function assertMd2DisposableEvidenceSession(args: Record<string, unknown>): URL {
  if (args.confirmDisposableSession !== true) {
    throw new Error('MD2 evidence requires confirmDisposableSession=true');
  }
  if (typeof args.expectedSessionUrl !== 'string' || !args.expectedSessionUrl.trim()) {
    throw new Error('MD2 evidence requires an explicit expectedSessionUrl');
  }
  const expected = new URL(args.expectedSessionUrl);
  if (expected.protocol !== 'http:' && expected.protocol !== 'https:') {
    throw new Error('MD2 evidence expectedSessionUrl must use HTTP(S)');
  }
  if (expected.username || expected.password) {
    throw new Error('MD2 evidence expectedSessionUrl must not contain credentials');
  }
  if (!isDedicatedLocalhost(expected.hostname)) {
    throw new Error('MD2 evidence requires a dedicated *.localhost disposable session');
  }
  const marker = expected.searchParams.get('motionDesignEvidenceSession');
  if (!marker?.trim()) {
    throw new Error('MD2 evidence URL must include motionDesignEvidenceSession');
  }
  if (normalizedSessionUrl(expected.href) !== normalizedSessionUrl(window.location.href)) {
    throw new Error('MD2 evidence expectedSessionUrl does not match this browser tab');
  }
  if (projectFileService.isProjectOpen()) {
    throw new Error('MD2 evidence refuses a tab with an open project');
  }
  const media = useMediaStore.getState();
  if (media.currentProjectId !== null) {
    throw new Error('MD2 evidence requires currentProjectId=null');
  }
  if (media.currentProjectName !== null && media.currentProjectName !== 'Untitled Project') {
    throw new Error('MD2 evidence refuses unsaved user project state');
  }
  if (useFlashBoardStore.getState().chatMessages.length !== 0) {
    throw new Error('MD2 evidence requires a chat-free disposable session');
  }
  const timeline = useTimelineStore.getState();
  if (timeline.clips.length !== 0) {
    throw new Error('MD2 evidence refuses a non-empty timeline');
  }
  assertMd2RestorableExportState(timeline);
  if (document.querySelector('[data-testid="timeline-global-curve-surface"]')) {
    throw new Error('MD2 evidence requires the disposable session to start in Timeline mode');
  }
  if (document.querySelector('.preview-edit-btn.active')) {
    throw new Error('MD2 evidence requires the disposable session to start outside Preview Edit Mode');
  }
  return expected;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

async function dataUrlToPixelBuffer(dataUrl: string): Promise<Md1PixelBuffer> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  if (!(image.naturalWidth > 0) || !(image.naturalHeight > 0)) {
    throw new Error('MD2 evidence decoded an image with invalid dimensions');
  }
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Unable to create MD2 evidence canvas context');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: pixels.data };
}

function imageBitmapToDataUrl(bitmap: ImageBitmap): string {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create MD2 export preview canvas context');
  context.drawImage(bitmap, 0, 0);
  return canvas.toDataURL('image/png');
}

function describePreviewLayer(layer: ReturnType<typeof layerBuilder.buildLayersFromStore>[number]): Record<string, unknown> {
  return {
    id: layer.id,
    sourceClipId: layer.sourceClipId ?? null,
    visible: layer.visible,
    opacity: layer.opacity,
    position: layer.position,
    sourceType: layer.source?.type ?? null,
    nestedLayers: layer.source?.nestedComposition?.layers.map(describePreviewLayer) ?? [],
  };
}

async function renderPreviewDataUrl(
  sampleTime: number,
  label: string,
  diagnostics: Record<string, unknown>[],
): Promise<string> {
  useTimelineStore.getState().setPlayheadPosition(sampleTime);
  layerBuilder.invalidateCache();
  const layers = layerBuilder.buildLayersFromStore();
  useTimelineStore.setState({ layers });
  diagnostics.push({
    label,
    requestedTime: sampleTime,
    storeTime: useTimelineStore.getState().playheadPosition,
    layers: layers.map(describePreviewLayer),
  });
  renderHostPort.requestNewFrameRender();
  const { capture, stable } = await captureStableRenderHostFrame('gpu', {
    settleMs: 100,
    pollIntervalMs: 100,
    minimumStableWindowMs: 300,
    maximumWaitMs: 1_200,
  });
  if (!capture.success) throw new Error(capture.error);
  if (!stable) throw new Error(`MD2 preview did not stabilize at ${sampleTime} seconds`);
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
    if (!result.success) throw new Error(result.error ?? 'MD2 debug export failed');
    if (!dataUrl) throw new Error('MD2 debug export published no preview frame');
    return dataUrl;
  } finally {
    unsubscribe();
  }
}

async function waitForElement<T extends Element>(selector: string, label: string): Promise<T> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const element = document.querySelector<T>(selector);
    if (element) return element;
    await waitForFrames(1, 60);
  }
  throw new Error(`MD2 evidence could not find real ${label}`);
}

function dispatchKey(target: Element, key: string): void {
  const code = key === 'ArrowRight' ? 'ArrowRight'
    : key === 'ArrowLeft' ? 'ArrowLeft'
      : key === 'ArrowUp' ? 'ArrowUp'
        : key === 'ArrowDown' ? 'ArrowDown'
          : key;
  target.dispatchEvent(new window.KeyboardEvent('keydown', {
    key,
    code,
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
  }));
}

function findDockSplitById(node: DockNode, splitId: string): DockSplit | null {
  if (node.kind === 'tab-group') return null;
  if (node.id === splitId) return node;
  return findDockSplitById(node.children[0], splitId)
    ?? findDockSplitById(node.children[1], splitId);
}

function readSplitRatio(splitId: string): number {
  const split = findDockSplitById(useDockStore.getState().layout.root, splitId);
  if (!split) throw new Error(`MD2 evidence lost dock split ${splitId}`);
  return split.ratio;
}

function sortedSelection(): string[] {
  return [...useTimelineStore.getState().selectedKeyframeIds].sort();
}

function keyframeEvidenceSnapshot(clipId: string): Array<Record<string, unknown>> {
  return useTimelineStore.getState().getClipKeyframes(clipId)
    .map((keyframe) => ({
      id: keyframe.id,
      clipId: keyframe.clipId,
      property: keyframe.property,
      value: keyframe.value,
      time: keyframe.time,
      easing: keyframe.easing,
      handleIn: keyframe.handleIn ? { ...keyframe.handleIn } : null,
      handleOut: keyframe.handleOut ? { ...keyframe.handleOut } : null,
    }))
    .sort((left, right) => `${left.property}:${left.time}:${left.id}`
      .localeCompare(`${right.property}:${right.time}:${right.id}`));
}

function clearEvidenceHistory(): void {
  useHistoryStore.setState({
    nodes: {},
    rootId: null,
    activeNodeId: null,
    lastVisitedChildByNodeId: {},
    eventLog: [],
    isApplying: false,
    batchId: null,
    batchLabel: null,
  });
}

/** Undo depth = number of ancestors of the active tree node. */
function historyUndoDepth(): number {
  const { nodes, activeNodeId } = useHistoryStore.getState();
  let depth = 0;
  let current = activeNodeId ? nodes[activeNodeId] : undefined;
  while (current?.parentId) {
    depth += 1;
    current = nodes[current.parentId];
  }
  return depth;
}

function cloneKeyframesForNested(keyframes: readonly Keyframe[], clipId: string): Keyframe[] {
  return keyframes.map((keyframe) => ({
    ...structuredClone(keyframe),
    clipId,
  }));
}

function keyframeParityIdentity(keyframe: Keyframe): Record<string, unknown> {
  return {
    id: keyframe.id,
    property: keyframe.property,
    value: keyframe.value,
    time: keyframe.time,
    easing: keyframe.easing,
    handleIn: keyframe.handleIn ? { ...keyframe.handleIn } : null,
    handleOut: keyframe.handleOut ? { ...keyframe.handleOut } : null,
  };
}

function alphaCoverage(buffer: Md1PixelBuffer): number {
  let visible = 0;
  for (let index = 3; index < buffer.data.length; index += 4) {
    if ((buffer.data[index] ?? 0) > 0) visible += 1;
  }
  return visible / Math.max(1, buffer.width * buffer.height);
}

async function closeEvidenceUi(): Promise<void> {
  const closeGraph = document.querySelector<HTMLButtonElement>('button[aria-label="Close Graph"]');
  closeGraph?.click();
  await waitForFrames(1, 40);
  if (document.querySelector('[data-testid="timeline-global-curve-surface"]')) {
    document.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle Timeline and Graph view"]',
    )?.click();
    await waitForFrames(1, 40);
  }
  const activeEditButton = document.querySelector<HTMLButtonElement>('.preview-edit-btn.active');
  if (activeEditButton) {
    activeEditButton.click();
    await waitForFrames(1, 40);
  }
}

async function runMotionPathUiEvidence(
  clipId: string,
  xKeyframeId: string,
  yKeyframeId: string,
): Promise<{ surface: string; evidence: Record<string, unknown> }> {
  useTimelineStore.setState({
    selectedClipIds: new Set([clipId]),
    primarySelectedClipId: clipId,
    selectedLayerId: clipId,
    selectedKeyframeIds: new Set([xKeyframeId]),
  });
  renderHostPort.requestRender();
  await waitForFrames(3, 180);

  let overlay = document.querySelector<SVGSVGElement>('svg[data-motion-path-overlay="true"]');
  if (!overlay) {
    const preview = await waitForElement<HTMLElement>(
      '.preview-container[data-preview-editable="true"]',
      'editable Preview panel',
    );
    const toggle = preview.querySelector<HTMLButtonElement>('button[title^="Toggle Edit Mode"]');
    if (!toggle) throw new Error('MD2 evidence could not find the real Preview Edit Mode control');
    toggle.click();
    overlay = await waitForElement<SVGSVGElement>(
      'svg[data-motion-path-overlay="true"]',
      'Motion Path overlay',
    );
  }

  const handle = await waitForElement<SVGElement>(
    'svg[data-motion-path-overlay="true"] [data-motion-path-handle-hit-target="true"][aria-label^="Outgoing"]',
    'Motion Path spatial handle',
  );
  clearEvidenceHistory();
  setHistoryDisabledForDebug(false);
  const before = keyframeEvidenceSnapshot(clipId);
  const selectionBefore = sortedSelection();
  handle.focus();
  if (document.activeElement !== handle) {
    throw new Error('Real Motion Path handle did not accept keyboard focus');
  }
  dispatchKey(handle, 'ArrowRight');
  await waitForFrames(1, 50);
  const afterNudge = keyframeEvidenceSnapshot(clipId);
  if (JSON.stringify(afterNudge) === JSON.stringify(before)) {
    throw new Error('Real Motion Path ArrowRight did not update the focused handle');
  }
  const commitHandle = document.querySelector<SVGElement>(
    `svg[data-motion-path-overlay="true"] [data-motion-path-handle-id="${handle.dataset.motionPathHandleId}"]`,
  );
  if (!commitHandle) throw new Error('Real Motion Path handle disappeared before keyboard commit');
  dispatchKey(commitHandle, 'Enter');
  await waitForFrames(2, 80);
  const after = keyframeEvidenceSnapshot(clipId);
  const selectionAfter = sortedSelection();
  if (JSON.stringify(after) === JSON.stringify(before)) {
    throw new Error('Real Motion Path handle keyboard edit did not change keyframe handles');
  }
  if (historyUndoDepth() !== 1) {
    throw new Error('Real Motion Path handle edit did not create exactly one undo step');
  }
  if (!selectionAfter.includes(xKeyframeId) || !selectionAfter.includes(yKeyframeId)) {
    throw new Error('Real Motion Path handle edit did not preserve the paired X/Y selection');
  }

  await Promise.resolve(useHistoryStore.getState().undo());
  const afterUndo = keyframeEvidenceSnapshot(clipId);
  const selectionAfterUndo = sortedSelection();
  if (JSON.stringify(afterUndo) !== JSON.stringify(before)) {
    throw new Error('Motion Path undo did not restore exact keyframe ids/values/times/handles');
  }
  if (JSON.stringify(selectionAfterUndo) !== JSON.stringify(selectionBefore)) {
    throw new Error('Motion Path undo did not restore exact keyframe selection');
  }

  await Promise.resolve(useHistoryStore.getState().redo());
  const afterRedo = keyframeEvidenceSnapshot(clipId);
  const selectionAfterRedo = sortedSelection();
  if (JSON.stringify(afterRedo) !== JSON.stringify(after)) {
    throw new Error('Motion Path redo did not restore exact keyframe ids/values/times/handles');
  }
  if (JSON.stringify(selectionAfterRedo) !== JSON.stringify(selectionAfter)) {
    throw new Error('Motion Path redo did not restore exact paired selection');
  }
  await waitForFrames(2, 80);
  overlay = await waitForElement<SVGSVGElement>(
    'svg[data-motion-path-overlay="true"]',
    'Motion Path overlay after redo',
  );
  const overlayRect = overlay.getBoundingClientRect();
  const overlayDiagnostics = {
    width: overlay.getAttribute('width'),
    height: overlay.getAttribute('height'),
    viewBox: overlay.getAttribute('viewBox'),
    boundingRect: {
      x: overlayRect.x,
      y: overlayRect.y,
      width: overlayRect.width,
      height: overlayRect.height,
    },
    paintElements: Array.from(overlay.querySelectorAll<SVGElement>('path, line, circle')).map((element) => ({
      tag: element.tagName,
      d: element.getAttribute('d'),
      cx: element.getAttribute('cx'),
      cy: element.getAttribute('cy'),
      r: element.getAttribute('r'),
      x1: element.getAttribute('x1'),
      y1: element.getAttribute('y1'),
      x2: element.getAttribute('x2'),
      y2: element.getAttribute('y2'),
      fill: element.getAttribute('fill'),
      stroke: element.getAttribute('stroke'),
    })),
  };
  const surface = await rasterizeMd2SvgElement(overlay);
  return {
    surface,
    evidence: {
      xKeyframeId,
      yKeyframeId,
      selectionBefore,
      selectionAfter,
      selectionAfterUndo,
      selectionAfterRedo,
      overlayDiagnostics,
      before,
      after,
      afterUndo,
      afterRedo,
      undoStepsAfterRedo: historyUndoDepth(),
    },
  };
}

async function runGlobalGraphUiEvidence(): Promise<{
  surface: string;
  evidence: Record<string, unknown>;
}> {
  const target = findTimelineVerticalSplit(useDockStore.getState().layout.root);
  if (!target) throw new Error('MD2 evidence could not find the real Timeline dock split');
  const forcedRatio = target.timelineChildIndex === 0 ? 0.2 : 0.8;
  useDockStore.getState().setSplitRatio(target.split.id, forcedRatio);
  await waitForFrames(3, 120);
  const ratioBeforeOpen = readSplitRatio(target.split.id);

  const toggle = await waitForElement<HTMLButtonElement>(
    'button[aria-label="Toggle Timeline and Graph view"]',
    'Timeline/Graph toggle',
  );
  if (toggle.getAttribute('aria-pressed') === 'true') {
    throw new Error('MD2 evidence expected Timeline mode before opening Graph');
  }
  toggle.click();
  const surfaceRoot = await waitForElement<HTMLElement>(
    '[data-testid="timeline-global-curve-surface"]',
    'Global Graph surface',
  );
  await waitForFrames(3, 120);
  const ratioWhileOpen = readSplitRatio(target.split.id);
  const expanded = target.timelineChildIndex === 0
    ? ratioWhileOpen > ratioBeforeOpen + 0.0005
    : ratioWhileOpen < ratioBeforeOpen - 0.0005;
  if (!expanded) throw new Error('Global Graph did not expand a deliberately short Timeline panel');

  const rows = [...surfaceRoot.querySelectorAll<HTMLElement>('.timeline-global-curve-series-row')];
  if (rows.length < 3) throw new Error('Global Graph did not expose the expected parameter rows');
  const hide = surfaceRoot.querySelector<HTMLButtonElement>('button[aria-label^="Hide "]');
  if (!hide) throw new Error('Global Graph did not expose per-series mute controls');
  hide.click();
  await waitForFrames(1, 50);
  const mutedAfterHide = surfaceRoot.querySelectorAll('.timeline-global-curve-series-row.muted').length;
  if (mutedAfterHide < 1) throw new Error('Global Graph mute control did not hide a series');
  const showAll = surfaceRoot.querySelector<HTMLButtonElement>('button[aria-label="Show all curves"]');
  const solo = surfaceRoot.querySelector<HTMLButtonElement>('button[aria-label="Show only the active curve"]');
  if (!showAll || !solo) throw new Error('Global Graph did not expose show-all and solo controls');
  showAll.click();
  await waitForFrames(1, 50);
  solo.click();
  await waitForFrames(1, 50);
  const mutedAfterSolo = surfaceRoot.querySelectorAll('.timeline-global-curve-series-row.muted').length;
  if (mutedAfterSolo < 1) throw new Error('Global Graph solo control did not mute inactive series');
  showAll.click();
  await waitForFrames(1, 50);

  const graphSvg = surfaceRoot.querySelector<SVGSVGElement>('svg[aria-label="Global property curve editor"]');
  if (!graphSvg) throw new Error('MD2 evidence could not find the real Global Graph SVG');
  const surface = await rasterizeMd2SvgElement(graphSvg);
  const labels = rows.map((row) => row.textContent?.replace(/\s+/g, ' ').trim() ?? '');
  const close = surfaceRoot.querySelector<HTMLButtonElement>('button[aria-label="Close Graph"]');
  if (!close) throw new Error('Global Graph did not expose its close control');
  close.click();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!document.querySelector('[data-testid="timeline-global-curve-surface"]')) break;
    await waitForFrames(1, 50);
  }
  if (document.querySelector('[data-testid="timeline-global-curve-surface"]')) {
    throw new Error('Global Graph did not close');
  }
  await waitForFrames(2, 80);
  const ratioAfterClose = readSplitRatio(target.split.id);
  if (Math.abs(ratioAfterClose - ratioBeforeOpen) > 0.001) {
    throw new Error('Closing Global Graph did not restore the prior Timeline panel ratio');
  }
  return {
    surface,
    evidence: {
      splitId: target.split.id,
      timelineChildIndex: target.timelineChildIndex,
      ratioBeforeOpen,
      ratioWhileOpen,
      ratioAfterClose,
      parameterRowCount: rows.length,
      parameterLabels: labels,
      mutedAfterHide,
      mutedAfterSolo,
    },
  };
}

function requirePairedPositionIds(
  aiKeyframes: readonly Record<string, unknown>[],
  time: number,
): { x: string; y: string } {
  const findId = (property: string) => {
    const entry = aiKeyframes.find((candidate) => (
      candidate.property === property && candidate.resolvedTime === time
    ));
    return typeof entry?.keyframeId === 'string' ? entry.keyframeId : '';
  };
  const x = findId('position.x');
  const y = findId('position.y');
  if (!x || !y) throw new Error(`AI sequence did not return paired position ids at ${time}`);
  return { x, y };
}

function validateAiSequence(
  expected: readonly Md2EvidenceSequenceEntry[],
  actual: readonly Record<string, unknown>[],
): void {
  if (actual.length !== expected.length) {
    throw new Error(`MD2 AI sequence returned ${actual.length}/${expected.length} keyframes`);
  }
  const ids = new Set<string>();
  expected.forEach((entry, index) => {
    const candidate = actual[index]!;
    if (candidate.property !== entry.property) {
      throw new Error(`AI keyframe ${index} property mismatch`);
    }
    if (candidate.resolvedTime !== entry.time) {
      throw new Error(`AI keyframe ${index} resolved-time mismatch`);
    }
    if (candidate.canonicalValue !== entry.value) {
      throw new Error(`AI keyframe ${index} canonical-value mismatch`);
    }
    if (candidate.easing !== entry.easing) {
      throw new Error(`AI keyframe ${index} easing mismatch`);
    }
    if (candidate.status !== 'created' || candidate.created !== true) {
      throw new Error(`AI keyframe ${index} was not reported as created`);
    }
    const id = typeof candidate.keyframeId === 'string' ? candidate.keyframeId : '';
    if (!id || ids.has(id)) throw new Error(`AI keyframe ${index} has a missing/duplicate stable id`);
    ids.add(id);
  });
}

export async function runMotionDesignMd2EvidenceDebugAction(args: Record<string, unknown>) {
  const sessionUrl = assertMd2DisposableEvidenceSession(args);
  const restoreSnapshot = captureMd2EvidenceRestoreSnapshot();
  const surfaces: SurfaceDataUrls = {};
  const failures: string[] = [];
  let fixtureId = 'motion-design-md2-authoring-animation-v1';

  return runWithMd2EvidenceRestore(async () => {
    const fixture = createMd2EvidenceFixture();
    fixtureId = fixture.id;
    let aiSequence: Record<string, unknown> | null = null;
    let motionPathEvidence: Record<string, unknown> | null = null;
    let graphEvidence: Record<string, unknown> | null = null;
    const parity: Record<string, Md1PixelComparison> = {};
    const temporalDifferentials: Record<string, Md1PixelComparison> = {};
    const baselineComparisons: Partial<Record<Md2EvidenceSurface, Md1PixelComparison>> = {};
    const coverage: Partial<Record<Md2EvidenceSurface, Record<string, number>>> = {};
    const previewDiagnostics: Record<string, unknown>[] = [];
    const staticSurfaces: Partial<Record<
      'direct-preview' | 'direct-export' | 'nested-preview' | 'nested-export',
      string
    >> = {};
    try {
      useMediaStore.setState((state) => ({
        compositions: [
          ...state.compositions.filter((composition) => (
            composition.id !== fixture.directComposition.id
            && composition.id !== fixture.nestedComposition.id
          )),
          fixture.directComposition,
          fixture.nestedComposition,
        ],
        activeCompositionId: fixture.directComposition.id,
        openCompositionIds: [fixture.directComposition.id],
      }));
      renderHostPort.setResolution(fixture.width, fixture.height);
      setHistoryDisabledForDebug(false);
      useTimelineStore.setState({
        tracks: fixture.tracks,
        clips: fixture.clips,
        clipKeyframes: fixture.keyframes,
        duration: fixture.duration,
        durationLocked: true,
        playheadPosition: fixture.sampleTime,
        selectedClipIds: new Set([fixture.ids.clipId]),
        primarySelectedClipId: fixture.ids.clipId,
        selectedLayerId: fixture.ids.clipId,
        selectedKeyframeIds: new Set(),
      });
      const aiResult = await handleAddKeyframe({
        sequence: fixture.expectedSequence.map((entry) => ({
          clipId: fixture.ids.clipId,
          property: entry.property,
          time: entry.time,
          value: entry.value,
          easing: entry.easing,
        })),
      }, useTimelineStore.getState());
      if (!aiResult.success) throw new Error(aiResult.error ?? 'MD2 AI keyframe sequence failed');
      aiSequence = asRecord(aiResult.data, 'MD2 AI sequence result');
      const aiKeyframesValue = aiSequence.keyframes;
      if (!Array.isArray(aiKeyframesValue) || aiKeyframesValue.length !== fixture.expectedSequence.length) {
        throw new Error('MD2 AI sequence did not return every authored keyframe');
      }
      const aiKeyframes = aiKeyframesValue.map((entry, index) => asRecord(entry, `AI keyframe ${index}`));
      validateAiSequence(fixture.expectedSequence, aiKeyframes);
      const pairedIds = requirePairedPositionIds(aiKeyframes, 0);

      layerBuilder.invalidateCache();
      const previewLayers = layerBuilder.buildLayersFromStore();
      const motionLayer = previewLayers.find((layer) => layer.sourceClipId === fixture.ids.clipId);
      if (!motionLayer || motionLayer.source?.type !== 'motion') {
        throw new Error('Production LayerBuilder produced no MD2 Motion Shape preview layer');
      }
      useTimelineStore.setState({
        layers: previewLayers,
        selectedLayerId: motionLayer.id,
      });

      const motionPath = await runMotionPathUiEvidence(
        fixture.ids.clipId,
        pairedIds.x,
        pairedIds.y,
      );
      surfaces['motion-path-overlay'] = motionPath.surface;
      motionPathEvidence = motionPath.evidence;

      const graph = await runGlobalGraphUiEvidence();
      surfaces['global-graph'] = graph.surface;
      graphEvidence = graph.evidence;
      await closeEvidenceUi();

      staticSurfaces['direct-preview'] = await renderPreviewDataUrl(
        0,
        'static-direct',
        previewDiagnostics,
      );
      staticSurfaces['direct-export'] = await renderExportPreviewDataUrl(
        0,
        fixture.width,
        fixture.height,
        args,
      );
      surfaces['direct-preview'] = await renderPreviewDataUrl(
        fixture.sampleTime,
        'animated-direct',
        previewDiagnostics,
      );
      surfaces['direct-export'] = await renderExportPreviewDataUrl(
        fixture.sampleTime,
        fixture.width,
        fixture.height,
        args,
      );

      const directKeyframes = useTimelineStore.getState().getClipKeyframes(fixture.ids.clipId);
      const nestedKeyframes = cloneKeyframesForNested(directKeyframes, fixture.ids.nestedClipId);
      const nestedClip: TimelineClip & { keyframes?: Keyframe[] } = {
        ...structuredClone(fixture.nestedClips[0]!),
        keyframes: nestedKeyframes,
      };
      if (JSON.stringify(nestedKeyframes.map(keyframeParityIdentity))
        !== JSON.stringify(directKeyframes.map(keyframeParityIdentity))) {
        throw new Error('Nested Motion keyframes lost ids/values/times/easing/handles');
      }
      const nestedWrapper: TimelineClip = {
        ...structuredClone(fixture.nestedWrapperClip),
        nestedTracks: structuredClone(fixture.nestedTracks),
        nestedClips: [nestedClip],
      };
      const wrapperTrack: TimelineTrack = {
        id: fixture.ids.nestedWrapperTrackId,
        name: 'MD2 Nested Wrapper',
        type: 'video',
        height: 70,
        muted: false,
        visible: true,
        solo: false,
        locked: false,
      };
      useTimelineStore.setState({
        tracks: [wrapperTrack],
        clips: [nestedWrapper],
        clipKeyframes: new Map(),
        selectedClipIds: new Set(),
        primarySelectedClipId: null,
        selectedLayerId: null,
        selectedKeyframeIds: new Set(),
      });
      staticSurfaces['nested-preview'] = await renderPreviewDataUrl(
        0,
        'static-nested',
        previewDiagnostics,
      );
      staticSurfaces['nested-export'] = await renderExportPreviewDataUrl(
        0,
        fixture.width,
        fixture.height,
        args,
      );
      surfaces['nested-preview'] = await renderPreviewDataUrl(
        fixture.sampleTime,
        'animated-nested',
        previewDiagnostics,
      );
      surfaces['nested-export'] = await renderExportPreviewDataUrl(
        fixture.sampleTime,
        fixture.width,
        fixture.height,
        args,
      );

      const pixels = Object.fromEntries(await Promise.all(MD2_EVIDENCE_SURFACES.map(async (surface) => {
        const dataUrl = surfaces[surface];
        if (!dataUrl) throw new Error(`MD2 evidence surface missing: ${surface}`);
        return [surface, await dataUrlToPixelBuffer(dataUrl)];
      }))) as Record<Md2EvidenceSurface, Md1PixelBuffer>;

      for (const surface of MD2_EVIDENCE_SURFACES) {
        const measured = measureMd1PixelCoverage(pixels[surface]);
        const alpha = alphaCoverage(pixels[surface]);
        coverage[surface] = {
          nonBlackCoverage: measured.nonBlackCoverage,
          lumaRange: measured.lumaRange,
          alphaCoverage: alpha,
        };
        if (!(alpha > 0) || measured.lumaRange < 1) {
          failures.push(`${surface} lacks visible/color-range evidence`);
        }
      }

      for (const surface of ['direct-export', 'nested-preview', 'nested-export'] as const) {
        const reference = surface.endsWith('-export')
          ? flattenPremultipliedMd1PixelBufferOnBlack(pixels['direct-preview'])
          : pixels['direct-preview'];
        const comparison = compareMd1PixelBuffers(
          reference,
          pixels[surface],
          MD1_GOLDEN_PIXEL_THRESHOLDS,
        );
        parity[`direct-preview:${surface}`] = comparison;
        failures.push(...comparison.failures.map((failure) => (
          `direct-preview:${surface}: ${failure}`
        )));
      }

      for (const surface of [
        'direct-preview', 'direct-export', 'nested-preview', 'nested-export',
      ] as const) {
        const staticDataUrl = staticSurfaces[surface];
        if (!staticDataUrl) throw new Error(`MD2 static control surface missing: ${surface}`);
        const comparison = compareMd1PixelBuffers(
          await dataUrlToPixelBuffer(staticDataUrl),
          pixels[surface],
          MD1_GOLDEN_PIXEL_THRESHOLDS,
        );
        temporalDifferentials[surface] = comparison;
        if (comparison.changedPixelRatio < 0.001 || comparison.meanAbsoluteChannelDelta < 0.1) {
          failures.push(`${surface} ignored the slide/overshoot animated-vs-static fixture delta`);
        }
      }

      const baselines = args.baselines && typeof args.baselines === 'object' && !Array.isArray(args.baselines)
        ? args.baselines as Record<string, unknown>
        : {};
      for (const surface of MD2_EVIDENCE_SURFACES) {
        const baseline = baselines[surface];
        if (baseline === undefined) continue;
        if (typeof baseline !== 'string') throw new Error(`MD2 ${surface} baseline must be a data URL`);
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
          sampleTime: fixture.sampleTime,
          surfaces,
          aiSequence,
          motionPathEvidence,
          graphEvidence,
          previewDiagnostics,
          nestedKeyframeIdentity: nestedClip.keyframes?.map((keyframe) => ({
            id: keyframe.id,
            clipId: keyframe.clipId,
            property: keyframe.property,
            time: keyframe.time,
            value: keyframe.value,
            easing: keyframe.easing,
            handleIn: keyframe.handleIn ?? null,
            handleOut: keyframe.handleOut ?? null,
          })),
          parity,
          temporalDifferentials,
          baselineComparisons,
          coverage,
          failures,
        },
      };
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      return {
        success: false,
        error: failures.join('; '),
        data: {
          fixtureId,
          surfaces,
          aiSequence,
          motionPathEvidence,
          graphEvidence,
          previewDiagnostics,
          parity,
          temporalDifferentials,
          baselineComparisons,
          coverage,
          failures,
        },
      };
    }
  }, async () => {
    await closeEvidenceUi();
    restoreMd2EvidenceSnapshot(restoreSnapshot);
  });
}
