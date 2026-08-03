import type {
  CameraItem,
  Composition,
  LightItem,
  MathSceneItem,
  MediaFile,
  MediaFolder,
  MediaState,
  MeshItem,
  MotionShapeItem,
  SignalAssetItem,
  SolidItem,
  SplatEffectorItem,
  TextItem,
} from '../../../stores/mediaStore/types';
import { isUserVisibleComposition } from '../../../stores/mediaStore/compositionVisibility';

export const HOSTED_AGENT_FAST_V2_PROJECT_CONTEXT_SCHEMA_VERSION = 2 as const;
export const HOSTED_AGENT_FAST_V2_MEDIA_POOL_MAX_CHARACTERS = 350_000 as const;
export const HOSTED_AGENT_FAST_V2_MEDIA_POOL_MAX_ITEMS = 2_000 as const;
export const HOSTED_AGENT_FAST_V2_MEDIA_POOL_MAX_FOLDERS = 500 as const;

const MAX_LABEL_CHARACTERS = 500;
const MAX_ID_CHARACTERS = 200;
const MAX_SELECTED_OR_OPEN_IDS = 32;
const MIN_PROJECT_CONTEXT_CHARACTERS = 25_000;
const MAX_TEXT_PREVIEW_CHARACTERS = 2_000;
const MAX_SCENE_DESCRIPTION_PREVIEWS = 12;
const MAX_COMPOSITION_SOURCE_IDS = 500;
const MAX_COMPOSITION_CAPTION_LAYERS = 200;

type ProjectContextMediaState = Pick<
  MediaState,
  | 'activeCompositionId'
  | 'cameraItems'
  | 'compositions'
  | 'currentProjectId'
  | 'currentProjectName'
  | 'files'
  | 'folders'
  | 'lightItems'
  | 'mathSceneItems'
  | 'meshItems'
  | 'motionShapeItems'
  | 'openCompositionIds'
  | 'selectedIds'
  | 'signalAssets'
  | 'solidItems'
  | 'splatEffectorItems'
  | 'textItems'
>;

export type HostedAgentFastV2MediaOrientation = 'landscape' | 'portrait' | 'square';

export interface HostedAgentFastV2AspectRatio {
  aspectLabel: string;
  aspectRatio: number;
  height: number;
  orientation: HostedAgentFastV2MediaOrientation;
  width: number;
}

export interface HostedAgentFastV2ProjectContextV2 {
  mediaPool: {
    activeCompositionId: string | null;
    characterBudget: number;
    complete: boolean;
    counts: Record<string, number>;
    folderCount: number;
    folders: Array<Record<string, unknown>>;
    includedFolderCount: number;
    includedItemCount: number;
    itemCount: number;
    items: Array<Record<string, unknown>>;
    omittedFolderCount: number;
    omittedItemCount: number;
    openCompositionIds: string[];
    selectedItemIds: string[];
  };
  project: {
    id: string | null;
    name: string;
  };
  schemaVersion: typeof HOSTED_AGENT_FAST_V2_PROJECT_CONTEXT_SCHEMA_VERSION;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nonnegativeNumber(value: unknown): number | undefined {
  const finite = finiteNumber(value);
  return finite === undefined ? undefined : Math.max(0, finite);
}

function boundedString(value: unknown, maximum = MAX_LABEL_CHARACTERS): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (/^\s*(?:blob:|data:|file:)/i.test(value)) return '[redacted-runtime-reference]';
  return value.slice(0, maximum);
}

function commonItem(item: {
  createdAt: number;
  id: string;
  labelColor?: string;
  name: string;
  parentId: string | null;
  type: string;
}): Record<string, unknown> {
  return {
    createdAt: nonnegativeNumber(item.createdAt) ?? 0,
    id: boundedString(item.id, MAX_ID_CHARACTERS) ?? '[invalid-id]',
    ...(item.labelColor === undefined ? {} : { labelColor: boundedString(item.labelColor, 40) }),
    name: boundedString(item.name) ?? '',
    parentFolderId: item.parentId === null ? null : boundedString(item.parentId, MAX_ID_CHARACTERS),
    type: boundedString(item.type, 80) ?? 'unknown',
  };
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return Math.max(1, a);
}

const COMMON_ASPECT_RATIOS: ReadonlyArray<readonly [number, string]> = [
  [1, '1:1'],
  [4 / 5, '4:5'],
  [5 / 4, '5:4'],
  [3 / 4, '3:4'],
  [4 / 3, '4:3'],
  [9 / 16, '9:16'],
  [16 / 9, '16:9'],
  [9 / 21, '9:21'],
  [21 / 9, '21:9'],
  [1.85, '1.85:1'],
  [2.39, '2.39:1'],
];

export function describeHostedAgentFastV2AspectRatio(
  rawWidth: unknown,
  rawHeight: unknown,
): HostedAgentFastV2AspectRatio | undefined {
  const finiteWidth = finiteNumber(rawWidth);
  const finiteHeight = finiteNumber(rawHeight);
  if (finiteWidth === undefined || finiteHeight === undefined || finiteWidth <= 0 || finiteHeight <= 0) {
    return undefined;
  }
  const width = Math.max(1, Math.round(finiteWidth));
  const height = Math.max(1, Math.round(finiteHeight));
  const ratio = width / height;
  const common = COMMON_ASPECT_RATIOS.find(([candidate]) => (
    Math.abs(ratio - candidate) / candidate <= 0.01
  ));
  const divisor = greatestCommonDivisor(width, height);
  const reducedWidth = width / divisor;
  const reducedHeight = height / divisor;
  const aspectLabel = common?.[1]
    ?? (reducedWidth <= 100 && reducedHeight <= 100
      ? `${reducedWidth}:${reducedHeight}`
      : `${Number(ratio.toFixed(3))}:1`);
  return {
    aspectLabel,
    aspectRatio: Number(ratio.toFixed(6)),
    height,
    orientation: Math.abs(width - height) / Math.max(width, height) <= 0.01
      ? 'square'
      : width > height ? 'landscape' : 'portrait',
    width,
  };
}

function transcriptPreview(file: MediaFile): Record<string, unknown> {
  const words = file.transcript ?? [];
  let previewText = '';
  let includedWords = 0;
  for (const word of words) {
    const text = boundedString(word.text, MAX_TEXT_PREVIEW_CHARACTERS)?.trim();
    if (!text) continue;
    const next = previewText.length === 0 ? text : `${previewText} ${text}`;
    if (next.length > MAX_TEXT_PREVIEW_CHARACTERS) break;
    previewText = next;
    includedWords += 1;
  }
  return {
    available: words.length > 0 || file.transcriptArtifact !== undefined,
    ...(finiteNumber(file.transcriptCoverage) === undefined
      ? {}
      : { coverage: Math.max(0, Math.min(1, file.transcriptCoverage!)) }),
    ...(previewText.length === 0 ? {} : { previewText }),
    status: file.transcriptStatus ?? 'none',
    truncatedPreview: includedWords < words.length,
    wordCount: words.length,
  };
}

function sceneDescriptionPreview(file: MediaFile): Record<string, unknown> {
  const descriptions = file.sceneDescriptions ?? [];
  return {
    available: descriptions.length > 0,
    items: descriptions.slice(0, MAX_SCENE_DESCRIPTION_PREVIEWS).map((scene) => ({
      end: nonnegativeNumber(scene.end) ?? 0,
      id: boundedString(scene.id) ?? '[invalid-scene-id]',
      start: nonnegativeNumber(scene.start) ?? 0,
      text: boundedString(scene.text, MAX_LABEL_CHARACTERS) ?? '',
    })),
    status: file.sceneDescriptionStatus ?? 'none',
    totalCount: descriptions.length,
    truncated: descriptions.length > MAX_SCENE_DESCRIPTION_PREVIEWS,
  };
}

function audioArtifactRefs(file: MediaFile): Record<string, unknown> | undefined {
  const refs = file.audioAnalysisRefs;
  if (!refs) return undefined;
  const singleIds = {
    beatGridId: refs.beatGridId,
    frequencySummaryId: refs.frequencySummaryId,
    loudnessEnvelopeId: refs.loudnessEnvelopeId,
    onsetMapId: refs.onsetMapId,
    phaseCorrelationId: refs.phaseCorrelationId,
    processedWaveformPyramidId: refs.processedWaveformPyramidId,
    prosodyContourId: refs.prosodyContourId,
    roomToneProfileId: refs.roomToneProfileId,
    speechMarkersId: refs.speechMarkersId,
    transcriptTimingId: refs.transcriptTimingId,
    voiceActivityId: refs.voiceActivityId,
    waveformPyramidId: refs.waveformPyramidId,
  };
  const result: Record<string, unknown> = Object.fromEntries(
    Object.entries(singleIds).flatMap(([key, value]) => (
    typeof value === 'string' && value.length > 0
      ? [[key, boundedString(value, MAX_ID_CHARACTERS)]]
      : []
    )),
  );
  if (refs.spectrogramTileSetIds?.length) {
    result.spectrogramTileSetIds = boundedIds(refs.spectrogramTileSetIds, 100);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function describeMediaFile(file: MediaFile): Record<string, unknown> {
  const geometry = describeHostedAgentFastV2AspectRatio(file.width, file.height);
  const facePeople = file.analysis?.faceAnalysis?.people.length ?? 0;
  return {
    ...commonItem(file),
    ...(geometry === undefined ? {} : { videoGeometry: geometry }),
    analysis: {
      available: file.analysis !== undefined,
      ...(finiteNumber(file.analysisCoverage) === undefined
        ? {}
        : { coverage: Math.max(0, Math.min(1, file.analysisCoverage!)) }),
      faceAnalysisStatus: file.faceAnalysisStatus ?? 'none',
      frameCount: file.analysis?.frames.length ?? 0,
      sceneCutStatus: file.sceneCutStatus ?? 'none',
      status: file.analysisStatus ?? 'none',
      uniquePeople: facePeople,
    },
    audio: {
      analysisAvailable: file.audioAnalysisRefs !== undefined,
      artifactRefs: audioArtifactRefs(file),
      codec: boundedString(file.audioCodec, 120),
      hasAudio: file.hasAudio === true || file.type === 'audio',
      stemsAvailable: file.stemInfo !== undefined,
      waveformStatus: file.waveformStatus ?? 'idle',
    },
    duration: nonnegativeNumber(file.duration),
    sceneDescriptions: sceneDescriptionPreview(file),
    technical: {
      bitrate: nonnegativeNumber(file.bitrate),
      codec: boundedString(file.codec, 120),
      container: boundedString(file.container, 120),
      fileSize: nonnegativeNumber(file.fileSize),
      fps: nonnegativeNumber(file.fps),
    },
    transcript: transcriptPreview(file),
  };
}

function compositionSourceMediaIds(composition: Composition): string[] {
  return [...new Set((composition.timelineData?.clips ?? [])
    .map((clip) => clip.mediaFileId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0))]
    .slice(0, MAX_COMPOSITION_SOURCE_IDS)
    .map((id) => boundedString(id, MAX_ID_CHARACTERS) ?? '[invalid-id]');
}

function describeCompositionCaptionLayers(composition: Composition): {
  captionLayerCount: number;
  captionLayers: Array<Record<string, unknown>>;
  captionLayersTruncated: boolean;
} {
  const captions = (composition.timelineData?.clips ?? []).filter((clip) => (
    clip.captionProperties !== undefined
  ));
  const captionLayers = captions.slice(0, MAX_COMPOSITION_CAPTION_LAYERS).map((clip) => {
    const properties = clip.captionProperties!;
    const text = clip.textProperties;
    return {
      captionProperties: {
        background: { ...properties.background },
        gapThreshold: nonnegativeNumber(properties.gapThreshold) ?? 0,
        highlight: { ...properties.highlight },
        holdAfter: nonnegativeNumber(properties.holdAfter) ?? 0,
        maxLines: nonnegativeNumber(properties.maxLines) ?? 1,
        maxWidth: nonnegativeNumber(properties.maxWidth) ?? 0,
        positionX: finiteNumber(properties.positionX) ?? 0,
        positionY: finiteNumber(properties.positionY) ?? 0,
        sourceClipId: properties.sourceClipId === null
          ? null
          : boundedString(properties.sourceClipId, MAX_ID_CHARACTERS),
        textTransform: properties.textTransform,
        wordsPerCaption: nonnegativeNumber(properties.wordsPerCaption) ?? 1,
      },
      clipId: boundedString(clip.id, MAX_ID_CHARACTERS) ?? '[invalid-id]',
      duration: nonnegativeNumber(clip.duration) ?? 0,
      endTime: nonnegativeNumber(clip.startTime + clip.duration) ?? 0,
      name: boundedString(clip.name) ?? 'Captions',
      startTime: nonnegativeNumber(clip.startTime) ?? 0,
      textStyle: text === undefined ? null : {
        boxEnabled: text.boxEnabled,
        boxHeight: nonnegativeNumber(text.boxHeight),
        boxWidth: nonnegativeNumber(text.boxWidth),
        boxX: finiteNumber(text.boxX),
        boxY: finiteNumber(text.boxY),
        color: boundedString(text.color, 100),
        fontFamily: boundedString(text.fontFamily, 200),
        fontSize: nonnegativeNumber(text.fontSize),
        fontStyle: text.fontStyle,
        fontWeight: nonnegativeNumber(text.fontWeight),
        letterSpacing: finiteNumber(text.letterSpacing),
        lineHeight: nonnegativeNumber(text.lineHeight),
        shadowBlur: nonnegativeNumber(text.shadowBlur),
        shadowColor: boundedString(text.shadowColor, 100),
        shadowEnabled: text.shadowEnabled,
        shadowOffsetX: finiteNumber(text.shadowOffsetX),
        shadowOffsetY: finiteNumber(text.shadowOffsetY),
        strokeColor: boundedString(text.strokeColor, 100),
        strokeEnabled: text.strokeEnabled,
        strokeWidth: nonnegativeNumber(text.strokeWidth),
        textAlign: text.textAlign,
      },
      trackId: boundedString(clip.trackId, MAX_ID_CHARACTERS) ?? '[invalid-track-id]',
    };
  });
  return {
    captionLayerCount: captions.length,
    captionLayers,
    captionLayersTruncated: captionLayers.length < captions.length,
  };
}

function describeComposition(composition: Composition): Record<string, unknown> {
  const sourceMediaItemIds = compositionSourceMediaIds(composition);
  const captionSummary = describeCompositionCaptionLayers(composition);
  const totalSourceCount = new Set((composition.timelineData?.clips ?? [])
    .map((clip) => clip.mediaFileId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)).size;
  return {
    ...commonItem(composition),
    backgroundColor: boundedString(composition.backgroundColor, 100),
    duration: nonnegativeNumber(composition.duration) ?? 0,
    frameRate: nonnegativeNumber(composition.frameRate) ?? 0,
    geometry: describeHostedAgentFastV2AspectRatio(composition.width, composition.height),
    timelineSummary: {
      ...captionSummary,
      clipCount: composition.timelineData?.clips.length ?? 0,
      sourceMediaItemIds,
      sourceMediaItemIdsTruncated: sourceMediaItemIds.length < totalSourceCount,
      trackCount: composition.timelineData?.tracks.length ?? 0,
    },
  };
}

function describeTextItem(item: TextItem): Record<string, unknown> {
  return {
    ...commonItem(item),
    color: boundedString(item.color, 100),
    duration: nonnegativeNumber(item.duration) ?? 0,
    fontFamily: boundedString(item.fontFamily, 200),
    fontSize: nonnegativeNumber(item.fontSize),
    text: boundedString(item.text, MAX_TEXT_PREVIEW_CHARACTERS) ?? '',
    textTruncated: item.text.length > MAX_TEXT_PREVIEW_CHARACTERS,
  };
}

function describeSolidItem(item: SolidItem): Record<string, unknown> {
  return {
    ...commonItem(item),
    color: boundedString(item.color, 100),
    duration: nonnegativeNumber(item.duration) ?? 0,
    geometry: describeHostedAgentFastV2AspectRatio(item.width, item.height),
  };
}

function describeMeshItem(item: MeshItem): Record<string, unknown> {
  return {
    ...commonItem(item),
    color: boundedString(item.color, 100),
    duration: nonnegativeNumber(item.duration) ?? 0,
    meshType: item.meshType,
  };
}

function describeCameraItem(item: CameraItem): Record<string, unknown> {
  return {
    ...commonItem(item),
    duration: nonnegativeNumber(item.duration) ?? 0,
    geometry: describeHostedAgentFastV2AspectRatio(
      item.cameraSettings.resolutionWidth,
      item.cameraSettings.resolutionHeight,
    ),
  };
}

function describeDurationItem(
  item: LightItem | MathSceneItem | MotionShapeItem | SplatEffectorItem,
): Record<string, unknown> {
  return {
    ...commonItem(item),
    duration: nonnegativeNumber(item.duration) ?? 0,
    ...('primitive' in item ? { primitive: item.primitive } : {}),
  };
}

function describeSignalAsset(item: SignalAssetItem): Record<string, unknown> {
  const diagnosticCounts = { error: 0, info: 0, warning: 0 };
  for (const diagnostic of item.diagnostics ?? []) diagnosticCounts[diagnostic.severity] += 1;
  return {
    ...commonItem(item),
    artifactCount: item.artifacts.length,
    diagnosticCodes: [...new Set((item.diagnostics ?? [])
      .map((diagnostic) => boundedString(diagnostic.code, 120))
      .filter((code): code is string => code !== undefined))].slice(0, 100),
    diagnosticCounts,
    fileSize: nonnegativeNumber(item.fileSize),
    providerId: boundedString(item.providerId, 160),
    signalKinds: item.signalKinds.slice(0, 100),
  };
}

function describeFolder(folder: MediaFolder): Record<string, unknown> {
  return {
    createdAt: nonnegativeNumber(folder.createdAt) ?? 0,
    id: boundedString(folder.id, MAX_ID_CHARACTERS) ?? '[invalid-id]',
    ...(folder.labelColor === undefined ? {} : { labelColor: folder.labelColor }),
    name: boundedString(folder.name) ?? '',
    parentFolderId: folder.parentId === null ? null : boundedString(folder.parentId, MAX_ID_CHARACTERS),
  };
}

function countMediaPool(state: ProjectContextMediaState): Record<string, number> {
  return {
    cameras: state.cameraItems.length,
    compositions: state.compositions.length,
    files: state.files.length,
    folders: state.folders.length,
    lights: state.lightItems.length,
    mathScenes: state.mathSceneItems.length,
    meshes: state.meshItems.length,
    motionShapes: state.motionShapeItems.length,
    signals: state.signalAssets.length,
    solids: state.solidItems.length,
    splatEffectors: state.splatEffectorItems.length,
    textItems: state.textItems.length,
  };
}

function allMediaPoolItems(state: ProjectContextMediaState): Array<Record<string, unknown>> {
  return [
    ...state.files.map(describeMediaFile),
    ...state.compositions.map(describeComposition),
    ...state.textItems.map(describeTextItem),
    ...state.solidItems.map(describeSolidItem),
    ...state.meshItems.map(describeMeshItem),
    ...state.cameraItems.map(describeCameraItem),
    ...state.lightItems.map(describeDurationItem),
    ...state.splatEffectorItems.map(describeDurationItem),
    ...state.mathSceneItems.map(describeDurationItem),
    ...state.motionShapeItems.map(describeDurationItem),
    ...state.signalAssets.map(describeSignalAsset),
  ];
}

function boundedIds(
  values: readonly string[],
  maximum: number = HOSTED_AGENT_FAST_V2_MEDIA_POOL_MAX_ITEMS,
): string[] {
  return [...new Set(values)]
    .slice(0, maximum)
    .map((value) => boundedString(value, MAX_ID_CHARACTERS) ?? '[invalid-id]');
}

/**
 * Builds the deterministic public projection of the project/media state sent
 * at turn start. This layer deliberately performs no intent-based relevance
 * selection; provider-facing selection and orchestration remain kernel-owned.
 * Runtime handles, paths, URLs, hashes, binary previews, and sample arrays are
 * excluded by construction rather than redacted after serialization.
 */
export function buildHostedAgentFastV2ProjectContext(
  state: ProjectContextMediaState,
  options: {
    maximumCharacters?: number;
    referencedMediaItemIds?: readonly string[];
  } = {},
): HostedAgentFastV2ProjectContextV2 {
  const maximumCharacters = Math.max(
    MIN_PROJECT_CONTEXT_CHARACTERS,
    Math.min(
      HOSTED_AGENT_FAST_V2_MEDIA_POOL_MAX_CHARACTERS,
      finiteNumber(options.maximumCharacters) ?? HOSTED_AGENT_FAST_V2_MEDIA_POOL_MAX_CHARACTERS,
    ),
  );
  const visibleCompositions = (state.compositions ?? []).filter(isUserVisibleComposition);
  const visibleCompositionIds = new Set(
    visibleCompositions.map((composition) => composition.id),
  );
  const visibleState: ProjectContextMediaState = {
    ...state,
    activeCompositionId: typeof state.activeCompositionId === 'string'
      && visibleCompositionIds.has(state.activeCompositionId)
      ? state.activeCompositionId
      : null,
    cameraItems: state.cameraItems ?? [],
    compositions: visibleCompositions,
    files: state.files ?? [],
    folders: state.folders ?? [],
    lightItems: state.lightItems ?? [],
    mathSceneItems: state.mathSceneItems ?? [],
    meshItems: state.meshItems ?? [],
    motionShapeItems: state.motionShapeItems ?? [],
    openCompositionIds: (state.openCompositionIds ?? [])
      .filter((id) => visibleCompositionIds.has(id)),
    selectedIds: state.selectedIds ?? [],
    signalAssets: state.signalAssets ?? [],
    solidItems: state.solidItems ?? [],
    splatEffectorItems: state.splatEffectorItems ?? [],
    textItems: state.textItems ?? [],
  };
  const prioritizedIds = boundedIds([
    ...(visibleState.selectedIds ?? []),
    ...(visibleState.activeCompositionId ? [visibleState.activeCompositionId] : []),
    ...(visibleState.openCompositionIds ?? []),
    ...(options.referencedMediaItemIds ?? []),
  ]);
  const priority = new Map(prioritizedIds.map((id, index) => [id, index]));
  const allItems = allMediaPoolItems(visibleState).sort((left, right) => {
    const leftId = String(left.id ?? '');
    const rightId = String(right.id ?? '');
    const leftPriority = priority.get(leftId) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = priority.get(rightId) ?? Number.MAX_SAFE_INTEGER;
    return leftPriority - rightPriority
      || String(left.type ?? '').localeCompare(String(right.type ?? ''))
      || String(left.name ?? '').localeCompare(String(right.name ?? ''))
      || leftId.localeCompare(rightId);
  });
  const allFolders = visibleState.folders
    .map(describeFolder)
    .sort((left, right) => (
      String(left.name ?? '').localeCompare(String(right.name ?? ''))
      || String(left.id ?? '').localeCompare(String(right.id ?? ''))
    ));

  const result: HostedAgentFastV2ProjectContextV2 = {
    mediaPool: {
      activeCompositionId: visibleState.activeCompositionId,
      characterBudget: maximumCharacters,
      complete: false,
      counts: countMediaPool(visibleState),
      folderCount: allFolders.length,
      folders: allFolders.slice(0, HOSTED_AGENT_FAST_V2_MEDIA_POOL_MAX_FOLDERS),
      includedFolderCount: 0,
      includedItemCount: 0,
      itemCount: allItems.length,
      items: allItems.slice(0, HOSTED_AGENT_FAST_V2_MEDIA_POOL_MAX_ITEMS),
      omittedFolderCount: 0,
      omittedItemCount: 0,
      openCompositionIds: boundedIds(visibleState.openCompositionIds ?? [], MAX_SELECTED_OR_OPEN_IDS),
      selectedItemIds: boundedIds(visibleState.selectedIds ?? [], MAX_SELECTED_OR_OPEN_IDS),
    },
    project: {
      id: visibleState.currentProjectId === null
        ? null
        : boundedString(visibleState.currentProjectId, MAX_ID_CHARACTERS) ?? null,
      name: boundedString(visibleState.currentProjectName) ?? '',
    },
    schemaVersion: HOSTED_AGENT_FAST_V2_PROJECT_CONTEXT_SCHEMA_VERSION,
  };

  const fitsBudget = () => (
    JSON.stringify(result).length <= maximumCharacters
  );
  const candidateFolders = result.mediaPool.folders;
  const candidateItems = result.mediaPool.items;
  result.mediaPool.items = [];
  if (!fitsBudget()) {
    let low = 0;
    let high = candidateFolders.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      result.mediaPool.folders = candidateFolders.slice(0, middle);
      if (fitsBudget()) low = middle;
      else high = middle - 1;
    }
    result.mediaPool.folders = candidateFolders.slice(0, low);
  }
  let low = 0;
  let high = candidateItems.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    result.mediaPool.items = candidateItems.slice(0, middle);
    if (fitsBudget()) low = middle;
    else high = middle - 1;
  }
  result.mediaPool.items = candidateItems.slice(0, low);
  result.mediaPool.includedFolderCount = result.mediaPool.folders.length;
  result.mediaPool.includedItemCount = result.mediaPool.items.length;
  result.mediaPool.omittedFolderCount = allFolders.length - result.mediaPool.folders.length;
  result.mediaPool.omittedItemCount = allItems.length - result.mediaPool.items.length;
  result.mediaPool.complete = result.mediaPool.omittedFolderCount === 0
    && result.mediaPool.omittedItemCount === 0;
  while (
    JSON.stringify(result).length > maximumCharacters
    && result.mediaPool.items.length > 0
  ) {
    result.mediaPool.items.pop();
    result.mediaPool.includedItemCount = result.mediaPool.items.length;
    result.mediaPool.omittedItemCount = allItems.length - result.mediaPool.items.length;
    result.mediaPool.complete = false;
  }
  while (
    JSON.stringify(result).length > maximumCharacters
    && result.mediaPool.folders.length > 0
  ) {
    result.mediaPool.folders.pop();
    result.mediaPool.includedFolderCount = result.mediaPool.folders.length;
    result.mediaPool.omittedFolderCount = allFolders.length - result.mediaPool.folders.length;
    result.mediaPool.complete = false;
  }
  return result;
}
