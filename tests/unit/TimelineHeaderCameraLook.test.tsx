import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimelineHeader } from '../../src/components/timeline/TimelineHeader';
import type { ClipTransform, TimelineClip, TimelineTrack } from '../../src/types';

describe('TimelineHeader camera look controls', () => {
  it('scrubs camera yaw as fixed-eye look keyframes instead of raw orbit rotation', () => {
    const transform: ClipTransform = {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const cameraClip = {
      id: 'camera-clip',
      trackId: 'camera-track',
      startTime: 0,
      duration: 5,
      transform,
      source: {
        type: 'camera',
        cameraSettings: { fov: 60, near: 0.1, far: 1000 },
      },
    } as TimelineClip;
    const addKeyframe = vi.fn();
    const setPropertyValue = vi.fn();

    const { container } = render(
      <TimelineHeader
        track={{
          id: 'camera-track',
          name: 'Camera',
          type: 'video',
          height: 48,
          visible: true,
          locked: false,
        } as TimelineTrack}
        tracks={[]}
        isDimmed={false}
        isExpanded
        dynamicHeight={120}
        hasKeyframes
        selectedClipIds={new Set(['camera-clip'])}
        clips={[cameraClip]}
        playheadPosition={1}
        onToggleExpand={vi.fn()}
        onToggleSolo={vi.fn()}
        onToggleMuted={vi.fn()}
        onToggleVisible={vi.fn()}
        onRenameTrack={vi.fn()}
        onContextMenu={vi.fn()}
        onWheel={vi.fn()}
        clipKeyframes={new Map([[
          'camera-clip',
          [
            { id: 'yaw-0', clipId: 'camera-clip', property: 'rotation.y', time: 0, value: 0, easing: 'linear' },
            { id: 'yaw-1', clipId: 'camera-clip', property: 'rotation.y', time: 2, value: 0, easing: 'linear' },
          ],
        ]])}
        getClipKeyframes={() => []}
        getInterpolatedTransform={() => transform}
        getInterpolatedEffects={() => []}
        addKeyframe={addKeyframe}
        setPlayheadPosition={vi.fn()}
        setPropertyValue={setPropertyValue}
        expandedCurveProperties={new Map()}
        onToggleCurveExpanded={vi.fn()}
        onSetTrackParent={vi.fn()}
        onTrackPickWhipDragStart={vi.fn()}
        onTrackPickWhipDragEnd={vi.fn()}
      />,
    );

    const value = container.querySelector('.property-value') as HTMLElement;
    fireEvent.mouseDown(value, { button: 0, clientY: 100 });
    fireEvent.mouseMove(window, { clientY: 80 });
    fireEvent.mouseUp(window);

    expect(setPropertyValue).not.toHaveBeenCalled();
    expect(addKeyframe).toHaveBeenCalledWith('camera-clip', 'position.x', expect.any(Number));
    expect(addKeyframe).toHaveBeenCalledWith('camera-clip', 'position.y', expect.any(Number));
    expect(addKeyframe).toHaveBeenCalledWith('camera-clip', 'scale.z', expect.any(Number));
    expect(addKeyframe).toHaveBeenCalledWith('camera-clip', 'rotation.y', 10);
  });
});
