import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisWorkspace } from '../../src/components/panels/properties/analysisWorkspace/AnalysisWorkspace';
import { buildAnalysisWorkspaceViewModel } from '../../src/components/panels/properties/analysisWorkspace/analysisWorkspaceAdapter';

describe('AnalysisWorkspace', () => {
  it('keeps scene, person, and transcript navigation on one source-time model', () => {
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
    const onPersonSelect = vi.fn();

    render(
      <AnalysisWorkspace
        model={model}
        sourceTime={0.6}
        onSeekSourceTime={onSeekSourceTime}
        onPersonSelect={onPersonSelect}
      />,
    );

    expect(screen.getByText('Hello')).toHaveClass('AnalysisSceneBlob__word--active');
    expect(screen.queryByText('Ava')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Seek word Hello' }));
    expect(onSeekSourceTime).toHaveBeenCalledWith(0.5);
    const sceneButtons = screen.getAllByRole('button', { expanded: false });
    fireEvent.click(sceneButtons[0]);
    expect(onSeekSourceTime).toHaveBeenCalledWith(0);

    fireEvent.click(screen.getByRole('button', { name: /Ava.*90% confidence/i }));
    expect(onPersonSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'ava' }));
    expect(screen.getByText('Person filter active')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hello' }));
    expect(onSeekSourceTime).toHaveBeenCalledWith(0.5);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getAllByRole('button', { expanded: false })[0]);
    expect(onSeekSourceTime).toHaveBeenCalledWith(2);
  });

  it('replaces legacy frame and summary boxes with one workspace inspector', () => {
    const model = buildAnalysisWorkspaceViewModel({
      range: { inPoint: 10, outPoint: 14 },
      transcript: [{ id: 'word', text: 'Audio only', start: 11, end: 12 }],
    });

    render(
      <AnalysisWorkspace
        model={model}
        sourceTime={11}
        currentFrame={{ sourceTime: 11, focus: 0.82, motion: 0.21, faceCount: 2 }}
        summary={{
          frameCount: 8,
          averageFocus: 75,
          peakFocus: 94,
          averageMotion: 22,
          peakMotion: 61,
          totalFaces: 5,
          groupedPeople: 2,
          cutStatusText: '3',
          totalSourceCuts: 7,
          transcriptWords: 1,
          describedScenes: 0,
        }}
        onSeekSourceTime={vi.fn()}
      />,
    );

    expect(screen.getByRole('region', { name: 'Analysis at playhead and clip summary' }))
      .toHaveTextContent('Now 00:11.0');
    expect(screen.getByText('Focus avg/peak:').parentElement).toHaveTextContent('75% / 94%');
    expect(screen.getByText('Cuts:').parentElement).toHaveTextContent('Cuts:3');
    expect(screen.getByText('Cuts:').nextElementSibling).toHaveAttribute('title', '7 in source');
    expect(screen.getByText('Audio only')).toBeInTheDocument();
  });

  it('keeps review assignment inside the expanded scene', () => {
    const model = buildAnalysisWorkspaceViewModel({
      range: { inPoint: 0, outPoint: 2 },
      analysis: {
        sampleInterval: 500,
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
    });
    const onSeekSourceTime = vi.fn();
    const onAssignReviewFaces = vi.fn();
    const reviewCandidate = {
      id: 'review-1',
      faceIds: ['face-1'],
      firstSeen: 0.8,
      lastSeen: 0.8,
      observationCount: 1,
      sample: {
        timestamp: 0.8,
        confidence: 0.75,
        box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      },
    };

    render(
      <AnalysisWorkspace
        model={model}
        sourceTime={0.5}
        reviewCandidates={[reviewCandidate]}
        onSeekSourceTime={onSeekSourceTime}
        onAssignReviewFaces={onAssignReviewFaces}
      />,
    );

    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const reviewButton = screen.getByRole('button', { name: /Review 1 · 1 frame/ });
    fireEvent.click(reviewButton);
    expect(onSeekSourceTime).toHaveBeenCalledWith(0.8);

    const values = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: 'uninitialized',
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? '',
    } as unknown as DataTransfer;
    fireEvent.dragStart(reviewButton, { dataTransfer });
    const personTarget = screen.getByRole('button', { name: /Ava.*90% confidence/i })
      .closest('.AnalysisSceneBlob__person');
    expect(personTarget).not.toBeNull();
    fireEvent.drop(personTarget as Element, { dataTransfer });
    expect(onAssignReviewFaces).toHaveBeenCalledWith('review-1', ['face-1'], 'ava');
  });

  it('keeps complete people and review correction controls below virtualized scenes', () => {
    const person = {
      id: 'ava',
      label: 'Ava',
      firstSeen: 0,
      lastSeen: 2,
      sampleCount: 1,
      averageConfidence: 0.9,
      maxConfidence: 0.9,
      appearances: [{ start: 0, end: 2 }],
    };
    const model = buildAnalysisWorkspaceViewModel({
      range: { inPoint: 0, outPoint: 2 },
      analysis: {
        sampleInterval: 500,
        frames: [{
          timestamp: 0.5,
          motion: 0,
          globalMotion: 0,
          localMotion: 0,
          focus: 1,
          brightness: 0.5,
          faceCount: 1,
          faces: [{
            id: 'face-1', personId: 'ava', label: 'Ava', confidence: 0.9,
            box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, landmarks: [],
          }],
        }],
        faceAnalysis: {
          schemaVersion: 1, modelVersion: 'test', detector: 'YuNet', recognizer: 'SFace',
          backend: 'wasm', observationCount: 1, people: [person],
        },
      },
    });
    const onSeekSourceTime = vi.fn();
    const reviewCandidate = {
      id: 'review-1', faceIds: ['face-review'], firstSeen: 1.1, lastSeen: 1.1,
      observationCount: 1,
      sample: { timestamp: 1.1, confidence: 0.7, box: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 } },
    };

    render(
      <AnalysisWorkspace
        model={model}
        sourceTime={0.5}
        facePeople={[person]}
        faceFrames={model.scenes.length ? [{
          timestamp: 0.5, motion: 0, globalMotion: 0, localMotion: 0, focus: 1,
          brightness: 0.5, faceCount: 1, faces: [{
            id: 'face-1', personId: 'ava', label: 'Ava', confidence: 0.9,
            box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, landmarks: [],
          }],
        }] : []}
        reviewCandidates={[reviewCandidate]}
        onSeekSourceTime={onSeekSourceTime}
        onMergePeople={vi.fn()}
        onMoveAppearance={vi.fn()}
        onAssignReviewFaces={vi.fn()}
      />,
    );

    expect(screen.getByRole('region', { name: 'Detected people and face corrections' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Faces needing review' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View Ava appearances' }));
    expect(screen.getByText('Ava appearances')).toBeInTheDocument();
  });
});
