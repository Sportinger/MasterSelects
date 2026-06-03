import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimelineTrack } from '../../src/components/timeline/TimelineTrack';
import type { TimelineTrackProps } from '../../src/components/timeline/types';
import { useMediaStore } from '../../src/stores/mediaStore';
import type { TimelineClip, TimelineTrack as TimelineTrackType } from '../../src/types';

function createTrack(): TimelineTrackType {
  return {
    id: 'track-video',
    name: 'Video 1',
    type: 'video',
    height: 64,
    visible: true,
    muted: false,
    solo: false,
    locked: false,
  } as TimelineTrackType;
}

function createClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-video',
    trackId: 'track-video',
    name: 'Canvas Clip',
    file: new File([], 'clip.mp4'),
    startTime: 2,
    duration: 4,
    inPoint: 0,
    outPoint: 4,
    source: { type: 'video', mediaFileId: 'media-video', naturalDuration: 4 },
    effects: [],
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    ...overrides,
  } as TimelineClip;
}

function renderTimelineTrack(overrides: Partial<TimelineTrackProps> = {}) {
  useMediaStore.setState({ files: [] });

  const props: TimelineTrackProps = {
    track: createTrack(),
    clips: [],
    isDimmed: false,
    isExpanded: false,
    baseHeight: 64,
    dynamicHeight: 64,
    isDragTarget: false,
    isExternalDragTarget: false,
    selectedClipIds: new Set(),
    selectedKeyframeIds: new Set(),
    activeTimelineToolId: 'select',
    waveformsEnabled: true,
    audioDisplayMode: 'detailed',
    isClipDragActive: false,
    clipDrag: null,
    clipDragPreview: null,
    clipTrim: null,
    clipFade: null,
    clipContextMenu: null,
    audioRegionSelection: null,
    audioRegionGainPreview: null,
    audioSpectralRegionSelection: null,
    videoBakeRegionSelection: null,
    clipStemSeparationJobs: {},
    externalDrag: null,
    zoom: 10,
    scrollX: 0,
    timelineRef: { current: document.createElement('div') },
    onClipMouseDown: vi.fn(),
    onClipContextMenu: vi.fn(),
    onEmptyMouseDown: vi.fn(),
    onEmptyContextMenu: vi.fn(),
    onTrimStart: vi.fn(),
    onFadeStart: vi.fn(),
    onDrop: vi.fn(),
    onDragOver: vi.fn(),
    onDragEnter: vi.fn(),
    onDragLeave: vi.fn(),
    renderClip: () => null,
    clipKeyframes: new Map(),
    renderKeyframeDiamonds: () => null,
    timeToPixel: (time) => time * 10,
    pixelToTime: (pixel) => pixel / 10,
    expandedCurveProperties: new Map(),
    onSelectKeyframe: vi.fn(),
    onMoveKeyframe: vi.fn(),
    onUpdateBezierHandle: vi.fn(),
    addKeyframe: vi.fn(),
    ...overrides,
  };

  const result = render(<TimelineTrack {...props} />);
  const row = result.container.querySelector<HTMLElement>('.track-clip-row');
  if (!row) {
    throw new Error('Expected track clip row to render.');
  }
  row.getBoundingClientRect = () => ({
    x: 20,
    y: 0,
    left: 20,
    top: 0,
    right: 820,
    bottom: 64,
    width: 800,
    height: 64,
    toJSON: () => ({}),
  });

  return { ...result, row, props };
}

describe('TimelineTrack empty lane right mouse behavior', () => {
  it('starts the empty-lane right-button path without opening the menu immediately', () => {
    const onEmptyMouseDown = vi.fn();
    const onEmptyContextMenu = vi.fn();
    const { row } = renderTimelineTrack({ onEmptyMouseDown, onEmptyContextMenu });

    fireEvent.mouseDown(row, { button: 2, clientX: 70, clientY: 24 });

    expect(onEmptyMouseDown).toHaveBeenCalledTimes(1);
    expect(onEmptyMouseDown.mock.calls[0][1]).toBe('track-video');
    expect(onEmptyMouseDown.mock.calls[0][2]).toBe(5);
    expect(onEmptyContextMenu).not.toHaveBeenCalled();
  });

  it('still opens the empty-lane menu for a normal single right-click', () => {
    const onEmptyContextMenu = vi.fn();
    const { row } = renderTimelineTrack({ onEmptyContextMenu });

    fireEvent.contextMenu(row, { button: 2, clientX: 90, clientY: 24 });

    expect(onEmptyContextMenu).toHaveBeenCalledTimes(1);
    expect(onEmptyContextMenu.mock.calls[0][1]).toBe('track-video');
    expect(onEmptyContextMenu.mock.calls[0][2]).toBe(7);
  });

  it('routes a primary click on a canvas-rendered clip to the clip handler', () => {
    const onClipMouseDown = vi.fn();
    const onEmptyMouseDown = vi.fn();
    const { row } = renderTimelineTrack({
      clips: [createClip()],
      onClipMouseDown,
      onEmptyMouseDown,
      renderClip: (clip) => <div className="timeline-clip" data-clip-id={clip.id} />,
    });

    fireEvent.mouseDown(row, { button: 0, clientX: 45, clientY: 24 });

    expect(onClipMouseDown).toHaveBeenCalledTimes(1);
    expect(onClipMouseDown.mock.calls[0][1]).toBe('clip-video');
    expect(onEmptyMouseDown).not.toHaveBeenCalled();
  });

  it('keeps the canvas renderer active at extreme zoom', () => {
    const renderClip = vi.fn((clip: TimelineClip) => (
      <div className="timeline-clip" data-clip-id={clip.id} />
    ));

    const { container } = renderTimelineTrack({
      clips: [createClip()],
      zoom: 5000,
      timeToPixel: (time) => time * 5000,
      pixelToTime: (pixel) => pixel / 5000,
      renderClip,
    });

    expect(container.querySelector('.timeline-clip-canvas')).toBeTruthy();
    expect(renderClip).not.toHaveBeenCalled();
  });

  it('mounts a hover-only interaction shell without the legacy overlay body', () => {
    const renderClip = vi.fn((clip: TimelineClip) => (
      <div className="timeline-clip" data-clip-id={clip.id} />
    ));

    const { container, row } = renderTimelineTrack({
      clips: [createClip()],
      renderClip,
    });

    fireEvent.mouseMove(row, { clientX: 45, clientY: 24 });

    const overlay = container.querySelector('.timeline-canvas-dom-overlay');
    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');
    const legacyClip = container.querySelector('.timeline-canvas-dom-overlay .timeline-clip');

    expect(overlay).toBeTruthy();
    expect(shell).toBeTruthy();
    expect(shell?.dataset.clipId).toBe('clip-video');
    expect(shell?.dataset.mountReasons).toBe('hover');
    expect(shell?.dataset.activeSlots).toBe('');
    expect(shell?.style.pointerEvents).toBe('none');
    expect(legacyClip).toBeNull();
    expect(renderClip).not.toHaveBeenCalled();
  });

  it('routes a primary click through the hover-only shell without the legacy body', () => {
    const onClipMouseDown = vi.fn();
    const onEmptyMouseDown = vi.fn();
    const renderClip = vi.fn((clip: TimelineClip) => (
      <div className="timeline-clip" data-clip-id={clip.id} />
    ));

    const { container, row } = renderTimelineTrack({
      clips: [createClip()],
      onClipMouseDown,
      onEmptyMouseDown,
      renderClip,
    });

    fireEvent.mouseMove(row, { clientX: 45, clientY: 24 });
    fireEvent.mouseDown(row, { button: 0, clientX: 45, clientY: 24 });

    expect(onClipMouseDown).toHaveBeenCalledTimes(1);
    expect(onClipMouseDown.mock.calls[0][1]).toBe('clip-video');
    expect(onEmptyMouseDown).not.toHaveBeenCalled();
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeNull();
    expect(renderClip).not.toHaveBeenCalled();
  });

  it('routes a clip context menu through the hover-only shell without the legacy body', () => {
    const onClipContextMenu = vi.fn();
    const onEmptyContextMenu = vi.fn();
    const renderClip = vi.fn((clip: TimelineClip) => (
      <div className="timeline-clip" data-clip-id={clip.id} />
    ));

    const { container, row } = renderTimelineTrack({
      clips: [createClip()],
      onClipContextMenu,
      onEmptyContextMenu,
      renderClip,
    });

    fireEvent.mouseMove(row, { clientX: 45, clientY: 24 });
    fireEvent.contextMenu(row, { button: 2, clientX: 45, clientY: 24 });

    expect(onClipContextMenu).toHaveBeenCalledTimes(1);
    expect(onClipContextMenu.mock.calls[0][1]).toBe('clip-video');
    expect(onEmptyContextMenu).not.toHaveBeenCalled();
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeNull();
    expect(renderClip).not.toHaveBeenCalled();
  });

  it('does not mount selected-only DOM controls in canvas mode', () => {
    const renderClip = vi.fn((clip: TimelineClip) => (
      <div className="timeline-clip" data-clip-id={clip.id} />
    ));

    const { container } = renderTimelineTrack({
      clips: [createClip()],
      selectedClipIds: new Set(['clip-video']),
      renderClip,
    });

    expect(container.querySelector('.timeline-clip-canvas')).toBeTruthy();
    expect(container.querySelector('.clip-interaction-shell')).toBeNull();
    expect(container.querySelector('.timeline-canvas-dom-overlay')).toBeNull();
    expect(renderClip).not.toHaveBeenCalled();
  });

  it('keeps the legacy overlay mounted for an active fade clip until shell parity exists', () => {
    const onFadeStart = vi.fn();
    const renderClip = vi.fn((clip: TimelineClip) => (
      <div className="timeline-clip" data-clip-id={clip.id} />
    ));

    const { container } = renderTimelineTrack({
      clips: [createClip()],
      clipFade: {
        clipId: 'clip-video',
        edge: 'left',
        startX: 40,
        currentX: 56,
        clipDuration: 4,
        originalFadeDuration: 0.2,
      },
      onFadeStart,
      renderClip,
    });

    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');
    const leftFadeHandle = container.querySelector<HTMLElement>('.shell-fade-handle.left');

    expect(shell).toBeTruthy();
    expect(shell?.dataset.clipId).toBe('clip-video');
    expect(shell?.dataset.mountReasons).toBe('fade');
    expect(shell?.dataset.activeSlots).toBe('fade');
    expect(shell?.style.pointerEvents).toBe('none');
    expect(container.querySelectorAll('.shell-fade-handle')).toHaveLength(2);
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeTruthy();
    expect(renderClip).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'clip-video' }),
      'track-video',
      undefined,
      { passiveVisualsSuppressed: true },
    );

    fireEvent.mouseDown(leftFadeHandle as HTMLElement, { button: 0 });

    expect(onFadeStart).toHaveBeenCalledTimes(1);
    expect(onFadeStart.mock.calls[0][1]).toBe('clip-video');
    expect(onFadeStart.mock.calls[0][2]).toBe('left');
  });

  it('mounts shell trim handles for the active trim clip and dispatches trim commands', () => {
    const onTrimStart = vi.fn();
    const renderClip = vi.fn<TimelineTrackProps['renderClip']>((clip: TimelineClip) => (
      <div className="timeline-clip" data-clip-id={clip.id}>
        <div className="trim-handle left" />
        <div className="trim-handle right" />
      </div>
    ));

    const { container } = renderTimelineTrack({
      clips: [createClip()],
      clipTrim: {
        clipId: 'clip-video',
        edge: 'right',
        originalStartTime: 2,
        originalDuration: 4,
        originalInPoint: 0,
        originalOutPoint: 4,
        startX: 80,
        currentX: 90,
        altKey: false,
        snapIndicatorTime: null,
        isSnapping: false,
        appliedDelta: 0,
      },
      onTrimStart,
      renderClip,
    });

    const overlay = container.querySelector<HTMLElement>('.timeline-canvas-dom-overlay');
    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');
    const shellRightHandle = container.querySelector<HTMLElement>('.shell-trim-handle.right');

    expect(overlay).toBeTruthy();
    expect(shell?.dataset.mountReasons).toBe('trim');
    expect(shell?.dataset.activeSlots).toBe('trim');
    expect(container.querySelectorAll('.shell-trim-handle')).toHaveLength(2);
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeNull();
    expect(renderClip).not.toHaveBeenCalled();

    fireEvent.mouseDown(shellRightHandle as HTMLElement, { button: 0 });

    expect(onTrimStart).toHaveBeenCalledTimes(1);
    expect(onTrimStart.mock.calls[0][1]).toBe('clip-video');
    expect(onTrimStart.mock.calls[0][2]).toBe('right');
  });

  it('mounts a context-menu shell without the legacy overlay body for the open clip menu', () => {
    const renderClip = vi.fn((clip: TimelineClip) => (
      <div className="timeline-clip" data-clip-id={clip.id} />
    ));

    const { container } = renderTimelineTrack({
      clips: [createClip()],
      clipContextMenu: {
        clipId: 'clip-video',
        x: 96,
        y: 32,
      },
      renderClip,
    });

    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');

    expect(shell).toBeTruthy();
    expect(shell?.dataset.clipId).toBe('clip-video');
    expect(shell?.dataset.mountReasons).toBe('context-menu-open');
    expect(shell?.dataset.activeSlots).toBe('context-menu');
    expect(shell?.style.pointerEvents).toBe('none');
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeNull();
    expect(renderClip).not.toHaveBeenCalled();
  });

  it('mounts a drag-only shell without the legacy overlay body for an active clip drag', () => {
    const renderClip = vi.fn((clip: TimelineClip) => (
      <div className="timeline-clip" data-clip-id={clip.id} />
    ));

    const { container } = renderTimelineTrack({
      clips: [createClip()],
      isClipDragActive: true,
      clipDrag: {
        clipId: 'clip-video',
        originalStartTime: 2,
        originalTrackId: 'track-video',
        grabOffsetX: 20,
        grabY: 16,
        currentX: 120,
        currentTrackId: 'track-video',
        snappedTime: 3,
        snapIndicatorTime: null,
        isSnapping: false,
        trackChangeGuideTime: null,
        altKeyPressed: false,
        forcingOverlap: false,
        dragStartTime: 100,
      },
      renderClip,
    });

    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');

    expect(shell).toBeTruthy();
    expect(shell?.dataset.clipId).toBe('clip-video');
    expect(shell?.dataset.mountReasons).toBe('drag');
    expect(shell?.dataset.activeSlots).toBe('');
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeNull();
    expect(renderClip).not.toHaveBeenCalled();
  });

  it('keeps a drag-hover shell without the legacy overlay body', () => {
    const renderClip = vi.fn((clip: TimelineClip) => (
      <div className="timeline-clip" data-clip-id={clip.id} />
    ));

    const { container, row } = renderTimelineTrack({
      clips: [createClip()],
      isClipDragActive: true,
      clipDrag: {
        clipId: 'clip-video',
        originalStartTime: 2,
        originalTrackId: 'track-video',
        grabOffsetX: 20,
        grabY: 16,
        currentX: 120,
        currentTrackId: 'track-video',
        snappedTime: 3,
        snapIndicatorTime: null,
        isSnapping: false,
        trackChangeGuideTime: null,
        altKeyPressed: false,
        forcingOverlap: false,
        dragStartTime: 100,
      },
      renderClip,
    });

    fireEvent.mouseMove(row, { clientX: 45, clientY: 24 });

    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');

    expect(shell).toBeTruthy();
    expect(shell?.dataset.clipId).toBe('clip-video');
    expect(shell?.dataset.mountReasons).toBe('hover drag');
    expect(shell?.dataset.activeSlots).toBe('');
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeNull();
    expect(renderClip).not.toHaveBeenCalled();
  });

  it('keeps a multi-drag-hover shell without the legacy overlay body', () => {
    const renderClip = vi.fn((clip: TimelineClip) => (
      <div className="timeline-clip" data-clip-id={clip.id} />
    ));
    const secondaryClip = createClip({
      id: 'clip-secondary',
      name: 'Secondary Clip',
      startTime: 8,
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      source: { type: 'video', mediaFileId: 'media-secondary', naturalDuration: 2 },
    });

    const { container, row } = renderTimelineTrack({
      clips: [createClip(), secondaryClip],
      isClipDragActive: true,
      clipDrag: {
        clipId: 'clip-video',
        originalStartTime: 2,
        originalTrackId: 'track-video',
        grabOffsetX: 20,
        grabY: 16,
        currentX: 120,
        currentTrackId: 'track-video',
        snappedTime: 3,
        snapIndicatorTime: null,
        isSnapping: false,
        trackChangeGuideTime: null,
        altKeyPressed: false,
        forcingOverlap: false,
        dragStartTime: 100,
        multiSelectClipIds: ['clip-secondary'],
      },
      renderClip,
    });

    fireEvent.mouseMove(row, { clientX: 105, clientY: 24 });

    const secondaryShell = container.querySelector<HTMLElement>('.clip-interaction-shell[data-clip-id="clip-secondary"]');

    expect(secondaryShell).toBeTruthy();
    expect(secondaryShell?.dataset.mountReasons).toBe('hover multi-drag');
    expect(secondaryShell?.dataset.activeSlots).toBe('');
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeNull();
    expect(renderClip).not.toHaveBeenCalled();
  });

  it('keeps a keyframe shell and legacy overlay mounted for selected clip keyframes', () => {
    const renderClip = vi.fn((clip: TimelineClip) => (
      <div className="timeline-clip" data-clip-id={clip.id} />
    ));

    const { container } = renderTimelineTrack({
      clips: [createClip()],
      clipKeyframes: new Map([
        [
          'clip-video',
          [
            {
              id: 'kf-opacity',
              clipId: 'clip-video',
              time: 1,
              property: 'opacity',
              value: 0.5,
              easing: 'linear',
            },
          ],
        ],
      ]),
      selectedKeyframeIds: new Set(['kf-opacity']),
      renderClip,
    });

    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');

    expect(shell).toBeTruthy();
    expect(shell?.dataset.clipId).toBe('clip-video');
    expect(shell?.dataset.mountReasons).toBe('selected-keyframes');
    expect(shell?.dataset.activeSlots).toBe('keyframe');
    expect(shell?.style.pointerEvents).toBe('none');
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeTruthy();
  });

  it('keeps an audio-region shell and legacy overlay mounted for an active audio region', () => {
    const renderClip = vi.fn((clip: TimelineClip) => (
      <div className="timeline-clip" data-clip-id={clip.id} />
    ));

    const { container } = renderTimelineTrack({
      clips: [createClip()],
      audioRegionSelection: {
        clipId: 'clip-video',
        trackId: 'track-video',
        startTime: 2.5,
        endTime: 3.5,
        sourceInPoint: 0.5,
        sourceOutPoint: 1.5,
      },
      renderClip,
    });

    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');

    expect(shell).toBeTruthy();
    expect(shell?.dataset.mountReasons).toBe('audio-region-active');
    expect(shell?.dataset.activeSlots).toBe('audio-region');
    expect(shell?.style.pointerEvents).toBe('none');
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeTruthy();
  });

  it('keeps a spectral-region shell and legacy overlay mounted for an active spectral selection', () => {
    const renderClip = vi.fn((clip: TimelineClip) => (
      <div className="timeline-clip" data-clip-id={clip.id} />
    ));

    const { container } = renderTimelineTrack({
      clips: [createClip()],
      audioSpectralRegionSelection: {
        clipId: 'clip-video',
        trackId: 'track-video',
        startTime: 2.5,
        endTime: 3.5,
        sourceInPoint: 0.5,
        sourceOutPoint: 1.5,
        frequencyMinHz: 120,
        frequencyMaxHz: 2400,
      },
      renderClip,
    });

    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');

    expect(shell).toBeTruthy();
    expect(shell?.dataset.mountReasons).toBe('spectral-region-active');
    expect(shell?.dataset.activeSlots).toBe('spectral-region');
    expect(shell?.style.pointerEvents).toBe('none');
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeTruthy();
  });

  it('keeps a video-bake shell and legacy overlay mounted for a clip bake region', () => {
    const renderClip = vi.fn((clip: TimelineClip) => (
      <div className="timeline-clip" data-clip-id={clip.id} />
    ));

    const { container } = renderTimelineTrack({
      clips: [
        createClip({
          videoState: {
            bakeRegions: [
              {
                id: 'bake-region',
                scope: 'clip',
                startTime: 2.5,
                endTime: 3.5,
                createdAt: 1,
                status: 'marked',
                clipId: 'clip-video',
                trackId: 'track-video',
                sourceInPoint: 0.5,
                sourceOutPoint: 1.5,
              },
            ],
          },
        }),
      ],
      renderClip,
    });

    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');

    expect(shell).toBeTruthy();
    expect(shell?.dataset.mountReasons).toBe('video-bake-active');
    expect(shell?.dataset.activeSlots).toBe('video-bake');
    expect(shell?.style.pointerEvents).toBe('none');
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeTruthy();
  });

  it('keeps a stem shell and legacy overlay mounted for an active stem job', () => {
    const renderClip = vi.fn((clip: TimelineClip) => (
      <div className="timeline-clip" data-clip-id={clip.id} />
    ));

    const { container } = renderTimelineTrack({
      clips: [createClip()],
      clipStemSeparationJobs: {
        'clip-video': {
          jobId: 'stem-job',
          clipId: 'clip-video',
          requestedClipId: 'clip-video',
          modelId: 'htdemucs',
          phase: 'separating',
          progress: 0.5,
          startedAt: 1,
          updatedAt: 2,
        },
      },
      renderClip,
    });

    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');

    expect(shell).toBeTruthy();
    expect(shell?.dataset.mountReasons).toBe('stem-active');
    expect(shell?.dataset.activeSlots).toBe('stem');
    expect(shell?.style.pointerEvents).toBe('none');
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeTruthy();
  });
});
