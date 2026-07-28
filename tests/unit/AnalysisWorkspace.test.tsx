import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisWorkspace } from '../../src/components/panels/properties/analysisWorkspace/AnalysisWorkspace';
import { buildAnalysisWorkspaceViewModel } from '../../src/components/panels/properties/analysisWorkspace/analysisWorkspaceAdapter';

describe('AnalysisWorkspace', () => {
  it('keeps scene and transcript navigation on one source-time model', () => {
    const model = buildAnalysisWorkspaceViewModel({
      range: { inPoint: 0, outPoint: 4 },
      sceneSegments: [
        { id: 'scene-a', start: 0, end: 2, text: 'Opening setup' },
        { id: 'scene-b', start: 2, end: 4, text: 'Second setup' },
      ],
      analysis: {
        sampleInterval: 1000,
        frames: [],
        faceAnalysis: {
          schemaVersion: 1,
          modelVersion: 'test',
          detector: 'YuNet',
          recognizer: 'SFace',
          backend: 'wasm',
          observationCount: 1,
          people: [{
            id: 'ava',
            label: 'Ava',
            firstSeen: 0,
            lastSeen: 2,
            sampleCount: 1,
            averageConfidence: 0.9,
            maxConfidence: 0.9,
            appearances: [{ start: 0, end: 2 }],
          }],
        },
      },
      transcript: [{
        id: 'hello',
        text: 'Hello',
        start: 0.5,
        end: 0.8,
        speaker: 'Ava',
      }],
    });
    const onSeekSourceTime = vi.fn();

    render(
      <AnalysisWorkspace
        model={model}
        sourceTime={0.6}
        onSeekSourceTime={onSeekSourceTime}
      />,
    );

    expect(screen.getByText('Hello')).toHaveClass('AnalysisSceneBlob__word--active');
    expect(screen.queryByText('Ava')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Seek word Hello' }));
    expect(onSeekSourceTime).toHaveBeenCalledWith(0.5);
    fireEvent.click(screen.getByRole('button', { name: /^Scene 1\b/ }));
    expect(onSeekSourceTime).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole('button', { name: 'Seek to speech segment 1 in scene 1' }));
    expect(onSeekSourceTime).toHaveBeenCalledWith(0.5);
    expect(screen.queryByText('00:00.5–00:00.8')).not.toBeInTheDocument();
    // The overview map's "People" lane label is legitimate; only a People
    // statistics section (heading) would be redundant in the workspace.
    expect(screen.queryByRole('heading', { name: 'People' })).not.toBeInTheDocument();
  });

  it('shows several speech segments without inventing visual scene cuts', () => {
    const model = buildAnalysisWorkspaceViewModel({
      range: { inPoint: 0, outPoint: 24 },
      cuts: [],
      transcript: Array.from({ length: 24 }, (_, index) => ({
        id: `word-${index}`,
        text: index === 9 || index === 19 ? `word${index}.` : `word${index}`,
        start: index,
        end: index + 0.4,
        speaker: 'Ava',
      })),
    });

    render(
      <AnalysisWorkspace
        model={model}
        sourceTime={0}
        onSeekSourceTime={vi.fn()}
      />,
    );

    expect(model.scenes).toHaveLength(1);
    expect(model.overview.lanes.scenes).toHaveLength(1);
    expect(screen.getByText('3/3')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('article', { name: 'Scene 1, speech segment 2 of 3' })).toBeInTheDocument();
  });

  it('keeps redundant playhead and summary statistics out of the scene workspace', () => {
    const model = buildAnalysisWorkspaceViewModel({
      range: { inPoint: 10, outPoint: 14 },
      transcript: [{ id: 'word', text: 'Audio only', start: 11, end: 12 }],
    });

    render(
      <AnalysisWorkspace
        model={model}
        sourceTime={11}
        onSeekSourceTime={vi.fn()}
      />,
    );

    expect(screen.queryByRole('region', { name: 'Analysis at playhead and clip summary' }))
      .not.toBeInTheDocument();
    expect(screen.getByText('Audio only')).toBeInTheDocument();
  });
});
