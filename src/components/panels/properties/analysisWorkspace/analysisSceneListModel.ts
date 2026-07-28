import type { AnalysisSceneSpeechMarker, AnalysisSceneView } from './analysisSceneViewModel';
import type { AnalysisSceneSparklineCurve } from './AnalysisSceneSparkline';
import {
  buildAnalysisTranscriptChunks,
  type AnalysisTranscriptChunkPause,
  type AnalysisTranscriptChunk,
} from './analysisTranscriptChunks';

export const ANALYSIS_SCENE_COLLAPSED_HEIGHT = 78;
export const ANALYSIS_SCENE_ROW_GAP = 6;
export const ANALYSIS_SCENE_LIST_VIEWPORT_HEIGHT = 430;
const OVERSCAN_PIXELS = 180;

export interface AnalysisSceneLayoutRow {
  offset: number;
  height: number;
}

export interface AnalysisSceneLayout {
  rows: readonly AnalysisSceneLayoutRow[];
  totalHeight: number;
}

export interface AnalysisSceneListItem {
  id: string;
  scene: AnalysisSceneView;
  transcriptChunk: AnalysisTranscriptChunk;
  markers: readonly AnalysisSceneSpeechMarker[];
  energyCurve?: AnalysisSceneSparklineCurve;
}

function searchableSceneText(scene: AnalysisSceneView): string {
  return [
    scene.description?.text,
    ...scene.people.map((person) => person.label),
    ...scene.speakerTurns.map((turn) => turn.speakerLabel),
    ...scene.transcript.map((word) => word.text),
  ].filter(Boolean).join(' ').toLocaleLowerCase();
}

export function filterAnalysisScenes(
  scenes: readonly AnalysisSceneView[],
  query: string,
): readonly AnalysisSceneView[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return scenes;
  return scenes.filter((scene) => searchableSceneText(scene).includes(normalizedQuery));
}

export function buildAnalysisSceneListItems(
  scenes: readonly AnalysisSceneView[],
  options?: {
    pauses?: readonly AnalysisTranscriptChunkPause[];
    markers?: readonly AnalysisSceneSpeechMarker[];
    energyCurve?: AnalysisSceneSparklineCurve;
    maxTextCharacters?: number;
  },
): readonly AnalysisSceneListItem[] {
  return scenes.flatMap(scene => buildAnalysisTranscriptChunks(scene, {
    pauses: options?.pauses,
    maxTextCharacters: options?.maxTextCharacters,
  }).map(transcriptChunk => ({
    id: transcriptChunk.id,
    scene,
    transcriptChunk,
    markers: (options?.markers ?? []).filter(marker => (
      marker.start < transcriptChunk.end && transcriptChunk.start < marker.end
    )),
    energyCurve: options?.energyCurve,
  })));
}

function searchableListItemText(item: AnalysisSceneListItem): string {
  return [
    item.scene.description?.text,
    ...item.scene.people.map(person => person.label),
    item.transcriptChunk.speakerLabel,
    ...item.transcriptChunk.words.map(word => word.text),
  ].filter(Boolean).join(' ').toLocaleLowerCase();
}

export function filterAnalysisSceneListItems(
  items: readonly AnalysisSceneListItem[],
  query: string,
): readonly AnalysisSceneListItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return items;
  return items.filter(item => searchableListItemText(item).includes(normalizedQuery));
}

export function findActiveAnalysisSceneListItem(
  items: readonly AnalysisSceneListItem[],
  sourceTime: number,
  selectedSceneId?: string,
): AnalysisSceneListItem | undefined {
  const sourceScene = Number.isFinite(sourceTime)
    ? items.find(item => sourceTime >= item.scene.range.start && sourceTime < item.scene.range.end)?.scene
    : undefined;
  const sceneId = sourceScene?.id ?? selectedSceneId;
  const sceneItems = items
    .filter(item => item.scene.id === sceneId)
    .toSorted((left, right) => (
      left.transcriptChunk.start - right.transcriptChunk.start
      || left.transcriptChunk.end - right.transcriptChunk.end
      || left.id.localeCompare(right.id)
    ));
  if (sceneItems.length === 0) return undefined;
  const containing = sceneItems.find(item => (
    sourceTime >= item.transcriptChunk.start && sourceTime < item.transcriptChunk.end
  ));
  if (containing) return containing;
  return sceneItems.findLast(item => item.transcriptChunk.start <= sourceTime) ?? sceneItems[0];
}

export function getAnalysisSceneWindow(
  layout: AnalysisSceneLayout,
  scrollTop: number,
  viewportHeight = ANALYSIS_SCENE_LIST_VIEWPORT_HEIGHT,
): { start: number; end: number } {
  const rangeStart = Math.max(0, scrollTop - OVERSCAN_PIXELS);
  const rangeEnd = Math.max(rangeStart, scrollTop + viewportHeight + OVERSCAN_PIXELS);
  const start = Math.max(0, layout.rows.findIndex(
    (row) => row.offset + row.height >= rangeStart,
  ));
  let end = start;
  while (end < layout.rows.length && layout.rows[end].offset <= rangeEnd) end += 1;
  return { start, end };
}

export function getAnalysisSceneCenteredScrollTop(
  layout: AnalysisSceneLayout,
  rowIndex: number,
  viewportHeight: number,
): number {
  const row = layout.rows[rowIndex];
  if (!row) return 0;
  const safeViewportHeight = Math.max(1, viewportHeight);
  const centeredScrollTop = row.offset + (row.height / 2) - (safeViewportHeight / 2);
  const maxScrollTop = Math.max(0, layout.totalHeight - safeViewportHeight);
  return Math.min(maxScrollTop, Math.max(0, centeredScrollTop));
}

export function buildAnalysisSceneLayout(
  items: readonly unknown[],
): AnalysisSceneLayout {
  let offset = 0;
  const rows = items.map(() => {
    const height = ANALYSIS_SCENE_COLLAPSED_HEIGHT;
    const row = { offset, height };
    offset += height + ANALYSIS_SCENE_ROW_GAP;
    return row;
  });
  return {
    rows,
    totalHeight: Math.max(0, offset - ANALYSIS_SCENE_ROW_GAP),
  };
}
