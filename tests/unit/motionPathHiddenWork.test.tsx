import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types/timeline';
import { createMockClip, createMockKeyframe } from '../helpers/mockData';
const { state } = vi.hoisted(() => ({ state: { clipKeyframes: new Map(), selectedKeyframeIds: new Set(), getClipKeyframes: () => [], applyTimelineEditOperation: () => undefined } }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), { setState: (patch: Partial<typeof state>) => Object.assign(state, patch) }) }));
import { useTimelineStore } from '../../src/stores/timeline';
import { useMotionPathEditing } from '../../src/components/preview/useMotionPathEditing';
const clip = createMockClip({ id: 'clip-motion', trackId: 'video-1', duration: 60 });
const projection = { sourceWidth: 100, sourceHeight: 100, outputWidth: 100, outputHeight: 100, canvasWidth: 100, canvasHeight: 100, scale: { x: 1, y: 1 }, rotation: 0 };

  it('does not sample hidden paths for camera clips or disabled motion editing', () => {
    let propertyReads = 0;
    const denseKeys = Array.from({ length: 1800 }, (_, i) => ({
      ...createMockKeyframe({ id: `dense-${i}`, clipId: clip.id, time: i / 30 }),
      get property() { propertyReads++; return i % 2 ? 'position.x' as const : 'position.y' as const; },
    }));
    useTimelineStore.setState({ clipKeyframes: new Map([[clip.id, denseKeys]]) });
    propertyReads = 0;
    function Harness({ camera, enabled }: { camera: boolean; enabled: boolean }) {
      const result = useMotionPathEditing({ enabled,
        clip: camera ? { ...clip, source: { ...clip.source, type: 'camera' } } as TimelineClip : clip,
        projection, editableSource: true, sourceMonitorActive: false, playbackActive: false,
        maskModeActive: false, textModeActive: false, trackLocked: false,
        playheadPosition: 0, frameRate: 30, viewZoom: 1 });
      return <div data-testid="path-result">{result.overlayProps.visible ? 'visible' : 'hidden'}:{result.overlayProps.samples.length}</div>;
    }
    const view = render(<Harness camera enabled />);
    expect(screen.getByTestId('path-result')).toHaveTextContent('hidden:0');
    view.rerender(<Harness camera={false} enabled={false} />);
    expect(screen.getByTestId('path-result')).toHaveTextContent('hidden:0');
    expect(propertyReads).toBe(0);
    act(() => useTimelineStore.setState({ clipKeyframes: new Map([[clip.id, [
      createMockKeyframe({ clipId: clip.id, id: 'visible-x', property: 'position.x', time: 0, value: 1 }),
    ]]]) }));
    view.rerender(<Harness camera={false} enabled />);
    expect(screen.getByTestId('path-result')).toHaveTextContent('visible:1');
  });
