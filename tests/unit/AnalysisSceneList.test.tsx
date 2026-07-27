import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  AnalysisSceneList,
} from '../../src/components/panels/properties/analysisWorkspace/AnalysisSceneList';
import {
  buildAnalysisSceneLayout,
  filterAnalysisScenes,
  getAnalysisSceneWindow,
} from '../../src/components/panels/properties/analysisWorkspace/analysisSceneListModel';
import type { AnalysisSceneView } from '../../src/components/panels/properties/analysisWorkspace/analysisSceneViewModel';

function scene(index: number): AnalysisSceneView {
  return {
    id: `scene-${index}`,
    index: index + 1,
    boundarySource: 'shot-fallback',
    range: { start: index, end: index + 1 },
    people: index === 8 ? [{ id: 'ava', label: 'Ava' }] : [],
    speakerTurns: [],
    transcript: index === 8
      ? [{ id: 'word', text: 'Needle phrase', start: 8, end: 8.5 }]
      : [],
    ocr: [],
    qualityIssues: [],
    coverage: {},
  };
}

describe('AnalysisSceneList', () => {
  const scenes = Array.from({ length: 100 }, (_, index) => scene(index));

  it('filters scene facts without mutating the complete scene list', () => {
    expect(filterAnalysisScenes(scenes, 'needle').map((item) => item.id)).toEqual(['scene-8']);
    expect(filterAnalysisScenes(scenes, 'ava').map((item) => item.id)).toEqual(['scene-8']);
    expect(scenes).toHaveLength(100);
  });

  it('keeps the rendered window bounded for long sources', () => {
    const layout = buildAnalysisSceneLayout(scenes);
    const firstWindow = getAnalysisSceneWindow(layout, 0);
    const laterWindow = getAnalysisSceneWindow(layout, 460);

    expect(firstWindow.start).toBe(0);
    expect(firstWindow.end).toBeLessThan(10);
    expect(laterWindow.start).toBeGreaterThan(0);
    expect(laterWindow.end - laterWindow.start).toBeLessThan(15);
  });

  it('renders only the visible scene rows and selects by source scene', () => {
    const onSceneSelect = vi.fn();
    render(
      <AnalysisSceneList
        scenes={scenes}
        selectedSceneId="scene-0"
        sourceTime={0}
        onSceneSelect={onSceneSelect}
      />,
    );

    const items = screen.getAllByRole('listitem');
    expect(items.length).toBeLessThan(10);
    fireEvent.click(screen.getAllByRole('button', { expanded: false })[1]);
    expect(onSceneSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'scene-1' }));
  });
});
