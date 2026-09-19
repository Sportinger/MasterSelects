import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimelineHeaderPropertyRow } from '../../src/components/timeline/components/TimelineHeaderPropertyRow';
import { CurveEditor } from '../../src/components/timeline/CurveEditor';
import { CurveEditorHeader } from '../../src/components/timeline/CurveEditorHeader';
import { createMockClip } from '../helpers/mockData';
import type { AnimatableProperty } from '../../src/types';

afterEach(cleanup);

describe('timeline volume readouts', () => {
  it.each([
    [0, '-∞ dB'],
    [0.5, '-6.0 dB'],
    [1, '0.0 dB'],
    [2, '+6.0 dB'],
  ])('displays gain %s in dB while recording the original linear gain', (gain, label) => {
    const volume = Number(gain);
    const effects = [{ id: 'volume-1', type: 'audio-volume', name: 'Volume', params: { volume } }];
    const clip = createMockClip({ effects });
    const addKeyframe = vi.fn();
    const { container, getByTitle } = render(
      <TimelineHeaderPropertyRow
        clip={clip} clipId={clip.id} trackId={clip.trackId}
        prop="effect.volume-1.volume" playheadPosition={clip.startTime}
        isAudioTrack isCurveExpanded={false} isKeyframeRowHovered={false}
        keyframes={[]} getInterpolatedEffects={() => effects}
        getInterpolatedTransform={() => clip.transform}
        addKeyframe={addKeyframe} setPlayheadPosition={vi.fn()}
        setPropertyValue={vi.fn()} onToggleCurveExpanded={vi.fn()}
      />,
    );
    expect(container.querySelector('.property-value')).toHaveTextContent(String(label));
    fireEvent.click(getByTitle('Add keyframe'));
    expect(addKeyframe).toHaveBeenCalledWith(clip.id, 'effect.volume-1.volume', volume);
  });

  it.each(['effect.volume-1.volume', 'opacity'] as AnimatableProperty[])('uses the correct units on both curve axes for %s', (property) => {
    const { container } = render(
      <>
        <CurveEditorHeader property={property} keyframes={[]} onClose={vi.fn()} />
        <CurveEditor
          trackId="audio-1" clipId="clip-1" property={property} keyframes={[]}
          clipStartTime={0} clipDuration={2} width={200}
          selectedKeyframeIds={new Set()} onSelectKeyframe={vi.fn()}
          onMoveKeyframe={vi.fn()} onUpdateBezierHandle={vi.fn()}
          timeToPixel={(time) => time * 100} pixelToTime={(pixel) => pixel / 100}
        />
      </>,
    );
    for (const selector of ['.curve-editor-tick-label', '.curve-editor-value-label']) {
      const labels = [...container.querySelectorAll(selector)].map((node) => node.textContent);
      expect(labels.length).toBeGreaterThan(0);
      if (property === 'opacity') {
        expect(labels).toContain('0%');
        expect(labels.every((label) => label?.endsWith('%'))).toBe(true);
      } else {
        if (selector === '.curve-editor-tick-label') expect(labels).toContain('0.0 dB');
        expect(labels).toContain('-∞ dB');
        expect(labels.every((label) => label?.endsWith(' dB'))).toBe(true);
      }
    }
  });
});
