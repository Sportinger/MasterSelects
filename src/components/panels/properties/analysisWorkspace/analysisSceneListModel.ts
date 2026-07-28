import type { AnalysisSceneView } from './analysisSceneViewModel';

export const ANALYSIS_SCENE_COLLAPSED_HEIGHT = 78;
export const ANALYSIS_SCENE_EXPANDED_HEIGHT = 350;
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

export function buildAnalysisSceneLayout(
  scenes: readonly AnalysisSceneView[],
  expandedSceneId?: string,
): AnalysisSceneLayout {
  let offset = 0;
  const rows = scenes.map((scene) => {
    const height = scene.id === expandedSceneId
      ? ANALYSIS_SCENE_EXPANDED_HEIGHT
      : ANALYSIS_SCENE_COLLAPSED_HEIGHT;
    const row = { offset, height };
    offset += height + ANALYSIS_SCENE_ROW_GAP;
    return row;
  });
  return {
    rows,
    totalHeight: Math.max(0, offset - ANALYSIS_SCENE_ROW_GAP),
  };
}
