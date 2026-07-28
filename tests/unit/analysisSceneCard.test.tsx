import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisSceneCard } from '../../src/components/panels/properties/analysisWorkspace/AnalysisSceneCard';

describe('AnalysisSceneCard', () => {
  const scene = {
    id: 'scene-1', boundarySource: 'shot-fallback' as const, index: 1, range: { start: 10, end: 13 },
    keyframe: { sourceTime: 11, ref: 'frame:11' }, setup: { label: 'Interview A' }, camera: { label: 'Medium' },
    people: [{ id: 'ava', label: 'Ava', confidence: .92 }],
    speakerTurns: [{ id: 'turn', start: 10, end: 13, speakerId: 'ava', speakerLabel: 'Ava', personId: 'ava', state: 'active' as const }],
    transcript: [{ id: 'word', text: 'Hello', start: 10.5, end: 11, speakerId: 'ava' }],
    ocr: [], qualityIssues: [], coverage: { faces: { state: 'partial' as const, detail: 'Only first pass complete' } },
  };

  it('keeps keyframe loading lazy and routes people and word interactions', () => {
    const onRequestKeyframe = vi.fn(); const onPersonSelect = vi.fn(); const onWordClick = vi.fn();
    render(<AnalysisSceneCard scene={scene} playheadTime={10.7} onRequestKeyframe={onRequestKeyframe} onPersonSelect={onPersonSelect} onWordClick={onWordClick} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Partial analysis')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load keyframe' }));
    fireEvent.click(screen.getByRole('button', { name: /Ava, active speaker/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Hello' }));
    expect(onRequestKeyframe).toHaveBeenCalledWith('frame:11', scene);
    expect(onPersonSelect).toHaveBeenCalledWith(scene.people[0], scene);
    expect(onWordClick).toHaveBeenCalledWith(scene.transcript[0], scene);
    expect(screen.getByRole('button', { name: 'Hello' })).toHaveAttribute('aria-current', 'true');
  });
});
