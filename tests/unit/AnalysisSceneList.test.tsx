import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  AnalysisSceneList,
} from '../../src/components/panels/properties/analysisWorkspace/AnalysisSceneList';
import {
  buildAnalysisSceneListItems,
  buildAnalysisSceneLayout,
  filterAnalysisSceneListItems,
  filterAnalysisScenes,
  findActiveAnalysisSceneListItem,
  getAnalysisSceneCenteredScrollTop,
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
  const items = buildAnalysisSceneListItems(scenes);

  it('filters scene facts without mutating the complete scene list', () => {
    expect(filterAnalysisScenes(scenes, 'needle').map((item) => item.id)).toEqual(['scene-8']);
    expect(filterAnalysisScenes(scenes, 'ava').map((item) => item.id)).toEqual(['scene-8']);
    expect(scenes).toHaveLength(100);
  });

  it('filters individual transcript segments without changing semantic scenes', () => {
    const longScene: AnalysisSceneView = {
      ...scene(0),
      range: { start: 0, end: 24 },
      transcript: Array.from({ length: 24 }, (_, index) => ({
        id: `long-${index}`,
        text: index === 9 ? 'Needle.' : index === 19 ? 'Second.' : `word${index}`,
        start: index,
        end: index + 0.4,
      })),
    };
    const longItems = buildAnalysisSceneListItems([longScene]);

    expect(longItems.length).toBeGreaterThan(1);
    expect(filterAnalysisSceneListItems(longItems, 'needle')).toHaveLength(1);
    expect(longScene.range).toEqual({ start: 0, end: 24 });
  });

  it('keeps the rendered window bounded for long sources', () => {
    const layout = buildAnalysisSceneLayout(items);
    const firstWindow = getAnalysisSceneWindow(layout, 0);
    const laterWindow = getAnalysisSceneWindow(layout, 460);

    expect(firstWindow.start).toBe(0);
    expect(firstWindow.end).toBeLessThan(10);
    expect(laterWindow.start).toBeGreaterThan(0);
    expect(laterWindow.end - laterWindow.start).toBeLessThan(15);
  });

  it('centers followed rows while clamping at the list edges', () => {
    const layout = buildAnalysisSceneLayout(items);

    expect(getAnalysisSceneCenteredScrollTop(layout, 50, 430)).toBe(4024);
    expect(getAnalysisSceneCenteredScrollTop(layout, 0, 430)).toBe(0);
    expect(getAnalysisSceneCenteredScrollTop(layout, 99, 430))
      .toBe(layout.totalHeight - 430);
  });

  it('scrolls the followed active segment to the viewport center', async () => {
    const clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockReturnValue(430);
    try {
      render(
        <AnalysisSceneList
          items={items}
          sourceTime={50.5}
          followPlayback
          onItemSelect={vi.fn()}
        />,
      );

      const list = screen.getByRole('list', { name: 'Scene and transcript segments' });
      expect(list.scrollTop).toBe(4024);
      await waitFor(() => {
        expect(screen.getByRole('article', { name: 'Scene 51' }).closest('[role="listitem"]'))
          .toHaveAttribute('aria-current', 'true');
      });
    } finally {
      clientHeight.mockRestore();
    }
  });

  it('renders only the visible scene rows and selects by source scene', () => {
    const onItemSelect = vi.fn();
    render(
      <AnalysisSceneList
        items={items}
        selectedSceneId="scene-0"
        sourceTime={0}
        onItemSelect={onItemSelect}
      />,
    );

    const rows = screen.getAllByRole('listitem');
    expect(rows.length).toBeLessThan(10);
    fireEvent.click(screen.getByRole('button', { name: 'Seek to scene 2' }));
    expect(onItemSelect).toHaveBeenCalledWith(expect.objectContaining({
      scene: expect.objectContaining({ id: 'scene-1' }),
    }));
  });

  it('selects exactly one transcript row through speech gaps', () => {
    const longScene: AnalysisSceneView = {
      ...scene(0),
      range: { start: 0, end: 20 },
      transcript: [
        { id: 'first', text: 'First.', start: 1, end: 2 },
        { id: 'second', text: 'Second.', start: 10, end: 11 },
      ],
    };
    const longItems = buildAnalysisSceneListItems([longScene]);

    expect(findActiveAnalysisSceneListItem(longItems, 1.5)?.transcriptChunk.words[0].id).toBe('first');
    expect(findActiveAnalysisSceneListItem(longItems, 6)?.transcriptChunk.words[0].id).toBe('first');
    expect(findActiveAnalysisSceneListItem(longItems, 10.5)?.transcriptChunk.words[0].id).toBe('second');
  });

  it('renders a breath marker in its word gap and styles its linked filler word', () => {
    const markerScene: AnalysisSceneView = {
      ...scene(0),
      range: { start: 0, end: 2 },
      transcript: [
        { id: 'first', text: 'Well', start: 0, end: 0.4 },
        { id: 'filler', text: 'um', start: 1, end: 1.4, emphasis: 0.8 },
      ],
    };
    const markerItems = buildAnalysisSceneListItems([markerScene], {
      markers: [
        { id: 'breath', kind: 'breath', start: 0.5, end: 0.8, confidence: 0.91 },
        { id: 'filler-marker', kind: 'filler', start: 1, end: 1.4, confidence: 0.88, wordIds: ['filler'] },
      ],
    });

    render(
      <AnalysisSceneList
        items={markerItems}
        sourceTime={0}
        onItemSelect={vi.fn()}
      />,
    );

    const breath = screen.getByLabelText('Breath marker');
    expect(breath).toHaveClass('analysis-scene-blob__marker--breath');
    expect(breath).toHaveAttribute('title', 'Breath (91% confidence)');
    expect(screen.getByRole('button', { name: 'Seek word um' })).toHaveClass(
      'AnalysisSceneBlob__word--filler',
      'AnalysisSceneBlob__word--emphasis',
    );
  });
});
