import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimelineHeader } from '../../src/components/timeline/TimelineHeader';
import type { ClipTransform, TimelineClip, TimelineTrack } from '../../src/types';

describe('TimelineHeader camera look controls', () => {
  it('edits the track name instead of expanding when the name is clicked', () => {
    const track = {
      id: 'video-1',
      name: 'Video 1',
      type: 'video',
      height: 48,
      visible: true,
      muted: false,
      solo: false,
    } as TimelineTrack;
    const onToggleExpand = vi.fn();

    const { container } = render(
      <TimelineHeader
        track={track}
        tracks={[track]}
        isDimmed={false}
        isExpanded={false}
        dynamicHeight={48}
        hasKeyframes={false}
        selectedClipIds={new Set()}
        clips={[]}
        playheadPosition={0}
        onToggleExpand={onToggleExpand}
        onToggleSolo={vi.fn()}
        onToggleMuted={vi.fn()}
        onToggleVisible={vi.fn()}
        onRenameTrack={vi.fn()}
        onContextMenu={vi.fn()}
        onWheel={vi.fn()}
        clipKeyframes={new Map()}
        getClipKeyframes={() => []}
        getInterpolatedTransform={() => ({
          opacity: 1,
          blendMode: 'normal',
          position: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1 },
          rotation: { x: 0, y: 0, z: 0 },
        })}
        getInterpolatedEffects={() => []}
        addKeyframe={vi.fn()}
        setPlayheadPosition={vi.fn()}
        setPropertyValue={vi.fn()}
        expandedCurveProperties={new Map()}
        onToggleCurveExpanded={vi.fn()}
        onSetTrackParent={vi.fn()}
        onTrackPickWhipDragStart={vi.fn()}
        onTrackPickWhipDragEnd={vi.fn()}
      />,
    );

    expect(container.textContent).toContain('(id:1)');

    fireEvent.click(container.querySelector('.track-name') as HTMLElement);

    expect(onToggleExpand).not.toHaveBeenCalled();
    expect(container.querySelector('.track-name-input')).not.toBeNull();
  });

  it('scrubs camera yaw as a look keyframe without moving the camera position', () => {
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
    expect(addKeyframe).toHaveBeenCalledWith('camera-clip', 'rotation.y', 10);
    expect(addKeyframe).toHaveBeenCalledTimes(1);
  });

  it('reports property row hover for matching keyframe row highlights', () => {
    const transform: ClipTransform = {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const clip = {
      id: 'clip-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 5,
      transform,
    } as TimelineClip;
    const onKeyframeRowHover = vi.fn();

    const { container } = render(
      <TimelineHeader
        track={{
          id: 'video-1',
          name: 'Video 1',
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
        selectedClipIds={new Set(['clip-1'])}
        clips={[clip]}
        playheadPosition={1}
        onToggleExpand={vi.fn()}
        onToggleSolo={vi.fn()}
        onToggleMuted={vi.fn()}
        onToggleVisible={vi.fn()}
        onRenameTrack={vi.fn()}
        onContextMenu={vi.fn()}
        onWheel={vi.fn()}
        clipKeyframes={new Map([[
          'clip-1',
          [
            { id: 'opacity-0', clipId: 'clip-1', property: 'opacity', time: 0, value: 1, easing: 'linear' },
          ],
        ]])}
        getClipKeyframes={() => []}
        getInterpolatedTransform={() => transform}
        getInterpolatedEffects={() => []}
        addKeyframe={vi.fn()}
        setPlayheadPosition={vi.fn()}
        setPropertyValue={vi.fn()}
        expandedCurveProperties={new Map()}
        onToggleCurveExpanded={vi.fn()}
        onKeyframeRowHover={onKeyframeRowHover}
        onSetTrackParent={vi.fn()}
        onTrackPickWhipDragStart={vi.fn()}
        onTrackPickWhipDragEnd={vi.fn()}
      />,
    );

    const row = container.querySelector('.property-label-row') as HTMLElement;

    fireEvent.mouseEnter(row);
    expect(onKeyframeRowHover).toHaveBeenLastCalledWith('video-1', 'opacity', true);

    fireEvent.mouseLeave(row);
    expect(onKeyframeRowHover).toHaveBeenLastCalledWith('video-1', 'opacity', false);
  });

  it('highlights the property row while a matching keyframe is hovered', () => {
    const transform: ClipTransform = {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const clip = {
      id: 'clip-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 5,
      transform,
    } as TimelineClip;

    const { container } = render(
      <TimelineHeader
        track={{
          id: 'video-1',
          name: 'Video 1',
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
        selectedClipIds={new Set(['clip-1'])}
        clips={[clip]}
        playheadPosition={1}
        onToggleExpand={vi.fn()}
        onToggleSolo={vi.fn()}
        onToggleMuted={vi.fn()}
        onToggleVisible={vi.fn()}
        onRenameTrack={vi.fn()}
        onContextMenu={vi.fn()}
        onWheel={vi.fn()}
        clipKeyframes={new Map([[
          'clip-1',
          [
            { id: 'opacity-0', clipId: 'clip-1', property: 'opacity', time: 0, value: 1, easing: 'linear' },
          ],
        ]])}
        getClipKeyframes={() => []}
        getInterpolatedTransform={() => transform}
        getInterpolatedEffects={() => []}
        addKeyframe={vi.fn()}
        setPlayheadPosition={vi.fn()}
        setPropertyValue={vi.fn()}
        expandedCurveProperties={new Map()}
        onToggleCurveExpanded={vi.fn()}
        hoveredKeyframeRow={{ trackId: 'video-1', property: 'opacity' }}
        onSetTrackParent={vi.fn()}
        onTrackPickWhipDragStart={vi.fn()}
        onTrackPickWhipDragEnd={vi.fn()}
      />,
    );

    expect(container.querySelector('.property-label-row')).toHaveClass('keyframe-row-highlighted');
  });

  it('adds keyframes while dragging across property-row keyframe buttons', () => {
    const transform: ClipTransform = {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const clip = {
      id: 'clip-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 5,
      transform,
    } as TimelineClip;
    const addKeyframe = vi.fn();

    const { container } = render(
      <TimelineHeader
        track={{
          id: 'video-1',
          name: 'Video 1',
          type: 'video',
          height: 48,
          visible: true,
          locked: false,
        } as TimelineTrack}
        tracks={[]}
        isDimmed={false}
        isExpanded
        dynamicHeight={140}
        hasKeyframes
        selectedClipIds={new Set(['clip-1'])}
        clips={[clip]}
        playheadPosition={1}
        onToggleExpand={vi.fn()}
        onToggleSolo={vi.fn()}
        onToggleMuted={vi.fn()}
        onToggleVisible={vi.fn()}
        onRenameTrack={vi.fn()}
        onContextMenu={vi.fn()}
        onWheel={vi.fn()}
        clipKeyframes={new Map([[
          'clip-1',
          [
            { id: 'opacity-0', clipId: 'clip-1', property: 'opacity', time: 0, value: 1, easing: 'linear' },
            { id: 'scale-x-0', clipId: 'clip-1', property: 'scale.x', time: 0, value: 2, easing: 'linear' },
          ],
        ]])}
        getClipKeyframes={() => []}
        getInterpolatedTransform={() => transform}
        getInterpolatedEffects={() => []}
        addKeyframe={addKeyframe}
        setPlayheadPosition={vi.fn()}
        setPropertyValue={vi.fn()}
        expandedCurveProperties={new Map()}
        onToggleCurveExpanded={vi.fn()}
        onSetTrackParent={vi.fn()}
        onTrackPickWhipDragStart={vi.fn()}
        onTrackPickWhipDragEnd={vi.fn()}
      />,
    );

    const buttons = container.querySelectorAll('.kf-add-btn');
    fireEvent.pointerDown(buttons[0], { button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerEnter(buttons[1], { buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(addKeyframe).toHaveBeenCalledWith('clip-1', 'opacity', 1);
    expect(addKeyframe).toHaveBeenCalledWith('clip-1', 'scale.x', 2);
  });
});
