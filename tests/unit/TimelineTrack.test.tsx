import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineTrack } from '../../src/components/timeline/TimelineTrack';
import type { TimelineTrackProps } from '../../src/components/timeline/types';
import {
  clearTimelineCanvasDiagnostics,
  getTimelineCanvasDiagnostics,
} from '../../src/services/timeline/timelineCanvasDiagnostics';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
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
    clipKeyframes: new Map(),
    renderKeyframeDiamonds: () => null,
    timeToPixel: (time) => time * 10,
    pixelToTime: (pixel) => pixel / 10,
    expandedCurveProperties: new Map(),
    onSelectKeyframe: vi.fn(),
    onMoveKeyframe: vi.fn(),
    onMoveKeyframeGroup: vi.fn(),
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
  beforeEach(() => {
    clearTimelineCanvasDiagnostics();
    useTimelineStore.setState({
      playheadPosition: 0,
      snappingEnabled: false,
      timelineToolPreview: null,
      activeTimelineToolId: 'select',
    });
  });

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
    });

    fireEvent.mouseDown(row, { button: 0, clientX: 45, clientY: 24 });

    expect(onClipMouseDown).toHaveBeenCalledTimes(1);
    expect(onClipMouseDown.mock.calls[0][1]).toBe('clip-video');
    expect(onEmptyMouseDown).not.toHaveBeenCalled();
  });

  it('dispatches blade clicks on canvas-rendered clips through the typed split operation', () => {
    const onClipMouseDown = vi.fn();
    const applyTimelineEditOperation = vi.fn(() => ({ success: true, warnings: [] }));
    const setTimelineToolPreview = vi.fn();
    useTimelineStore.setState({
      applyTimelineEditOperation: applyTimelineEditOperation as never,
      setTimelineToolPreview: setTimelineToolPreview as never,
      playheadPosition: 0,
      snappingEnabled: false,
    });

    const { row } = renderTimelineTrack({
      clips: [createClip()],
      activeTimelineToolId: 'blade',
      onClipMouseDown,
    });

    fireEvent.mouseMove(row, { clientX: 50, clientY: 24 });
    fireEvent.mouseDown(row, { button: 0, clientX: 50, clientY: 24 });

    expect(onClipMouseDown).not.toHaveBeenCalled();
    expect(setTimelineToolPreview).toHaveBeenCalledWith(expect.objectContaining({
      toolId: 'blade',
      clipId: 'clip-video',
      trackId: 'track-video',
      time: 3,
    }));
    expect(applyTimelineEditOperation).toHaveBeenCalledTimes(1);
    expect(applyTimelineEditOperation.mock.calls[0][0]).toMatchObject({
      type: 'split-at-time',
      clipIds: ['clip-video'],
      time: 3,
      includeLinked: true,
    });
    expect(applyTimelineEditOperation.mock.calls[0][1]).toMatchObject({
      source: 'ui',
      historyLabel: 'Blade split',
    });
  });

  it('keeps the canvas renderer active at extreme zoom', () => {

    const { container } = renderTimelineTrack({
      clips: [createClip()],
      zoom: 5000,
      timeToPixel: (time) => time * 5000,
      pixelToTime: (pixel) => pixel / 5000,
    });

    expect(container.querySelector('.timeline-clip-canvas')).toBeTruthy();
  });

  it('mounts a hover-only interaction shell without the legacy overlay body', () => {

    const { container, row } = renderTimelineTrack({
      clips: [createClip()],
    });

    fireEvent.mouseMove(row, { clientX: 45, clientY: 24 });

    const overlay = container.querySelector('.timeline-canvas-dom-overlay');
    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');
    const legacyClip = container.querySelector('.timeline-canvas-dom-overlay .timeline-clip');

    expect(overlay).toBeTruthy();
    expect(shell).toBeTruthy();
    expect(shell?.dataset.clipId).toBe('clip-video');
    expect(shell?.dataset.mountReasons).toBe('hover');
    expect(shell?.dataset.activeSlots).toBe('trim fade');
    expect(shell?.style.pointerEvents).toBe('none');
    expect(legacyClip).toBeNull();
  });

  it('reports zero DOM clip bodies for canvas interaction shells', () => {

    const { row } = renderTimelineTrack({
      clips: [createClip()],
    });

    fireEvent.mouseMove(row, { clientX: 45, clientY: 24 });

    const diagnostics = getTimelineCanvasDiagnostics();
    const totals = diagnostics.totals as {
      domOverlayCount: number;
      domClipBodyCount: number;
      shellCount: number;
    };

    expect(totals.domOverlayCount).toBe(1);
    expect(totals.shellCount).toBe(1);
    expect(totals.domClipBodyCount).toBe(0);
  });

  it('cleans up timeline canvas diagnostics when a track unmounts', () => {
    const rendered = renderTimelineTrack({
      clips: [createClip()],
    });

    fireEvent.mouseMove(rendered.row, { clientX: 45, clientY: 24 });

    let diagnostics = getTimelineCanvasDiagnostics() as {
      totals: { reportedTrackCount: number };
    };
    expect(diagnostics.totals.reportedTrackCount).toBe(1);

    rendered.unmount();

    diagnostics = getTimelineCanvasDiagnostics() as {
      totals: { reportedTrackCount: number; trackCount: number };
      tracks: unknown[];
      staleTracks: unknown[];
    };
    expect(diagnostics.totals.reportedTrackCount).toBe(0);
    expect(diagnostics.totals.trackCount).toBe(0);
    expect(diagnostics.tracks).toEqual([]);
    expect(diagnostics.staleTracks).toEqual([]);
  });

  it('routes a primary click through the hover-only shell without the legacy body', () => {
    const onClipMouseDown = vi.fn();
    const onEmptyMouseDown = vi.fn();

    const { container, row } = renderTimelineTrack({
      clips: [createClip()],
      onClipMouseDown,
      onEmptyMouseDown,
    });

    fireEvent.mouseMove(row, { clientX: 45, clientY: 24 });
    fireEvent.mouseDown(row, { button: 0, clientX: 45, clientY: 24 });

    expect(onClipMouseDown).toHaveBeenCalledTimes(1);
    expect(onClipMouseDown.mock.calls[0][1]).toBe('clip-video');
    expect(onEmptyMouseDown).not.toHaveBeenCalled();
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeNull();
  });

  it('routes a clip context menu through the hover-only shell without the legacy body', () => {
    const onClipContextMenu = vi.fn();
    const onEmptyContextMenu = vi.fn();

    const { container, row } = renderTimelineTrack({
      clips: [createClip()],
      onClipContextMenu,
      onEmptyContextMenu,
    });

    fireEvent.mouseMove(row, { clientX: 45, clientY: 24 });
    fireEvent.contextMenu(row, { button: 2, clientX: 45, clientY: 24 });

    expect(onClipContextMenu).toHaveBeenCalledTimes(1);
    expect(onClipContextMenu.mock.calls[0][1]).toBe('clip-video');
    expect(onEmptyContextMenu).not.toHaveBeenCalled();
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeNull();
  });

  it('does not mount selected-only DOM controls in canvas mode', () => {

    const { container } = renderTimelineTrack({
      clips: [createClip()],
      selectedClipIds: new Set(['clip-video']),
    });

    expect(container.querySelector('.timeline-clip-canvas')).toBeTruthy();
    expect(container.querySelector('.clip-interaction-shell')).toBeNull();
    expect(container.querySelector('.timeline-canvas-dom-overlay')).toBeNull();
  });

  it('marks keyframe property rows for data-driven marquee geometry', () => {

    const { container } = renderTimelineTrack({
      clips: [createClip()],
      isExpanded: true,
      dynamicHeight: 82,
      selectedClipIds: new Set(['clip-video']),
      clipKeyframes: new Map([
        [
          'clip-video',
          [
            {
              id: 'opacity-keyframe',
              clipId: 'clip-video',
              time: 1,
              property: 'opacity',
              value: 0.5,
              easing: 'linear',
            },
          ],
        ],
      ]),
    });

    const row = container.querySelector<HTMLElement>('.keyframe-track-row[data-keyframe-property="opacity"]');

    expect(row).toBeTruthy();
    expect(row?.dataset.trackId).toBe('track-video');
    expect(row?.dataset.keyframeProperty).toBe('opacity');
  });

  it('mounts a fade shell without the legacy overlay body for an active fade clip', () => {
    const onFadeStart = vi.fn();

    const { container } = renderTimelineTrack({
      clips: [createClip()],
      clipKeyframes: new Map([
        [
          'clip-video',
          [
            {
              id: 'fade-in-start',
              clipId: 'clip-video',
              time: 0,
              property: 'opacity',
              value: 0,
              easing: 'linear',
            },
            {
              id: 'fade-in-end',
              clipId: 'clip-video',
              time: 1,
              property: 'opacity',
              value: 1,
              easing: 'linear',
            },
            {
              id: 'fade-out-start',
              clipId: 'clip-video',
              time: 3,
              property: 'opacity',
              value: 1,
              easing: 'linear',
            },
            {
              id: 'fade-out-end',
              clipId: 'clip-video',
              time: 4,
              property: 'opacity',
              value: 0,
              easing: 'linear',
            },
          ],
        ],
      ]),
      clipFade: {
        clipId: 'clip-video',
        edge: 'left',
        startX: 40,
        currentX: 56,
        clipDuration: 4,
        originalFadeDuration: 0.2,
      },
      onFadeStart,
    });

    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');
    const leftFadeHandle = container.querySelector<HTMLElement>('.shell-fade-handle.left');
    const rightFadeHandle = container.querySelector<HTMLElement>('.shell-fade-handle.right');

    expect(shell).toBeTruthy();
    expect(shell?.dataset.clipId).toBe('clip-video');
    expect(shell?.dataset.mountReasons).toBe('fade');
    expect(shell?.dataset.activeSlots).toBe('trim fade');
    expect(shell?.style.pointerEvents).toBe('none');
    expect(container.querySelectorAll('.shell-fade-handle')).toHaveLength(2);
    expect(leftFadeHandle?.style.left).toBe('4px');
    expect(rightFadeHandle?.style.right).toBe('4px');
    expect(container.querySelector('.fade-curve-svg')).toBeTruthy();
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeNull();

    fireEvent.mouseDown(leftFadeHandle as HTMLElement, { button: 0 });

    expect(onFadeStart).toHaveBeenCalledTimes(1);
    expect(onFadeStart.mock.calls[0][1]).toBe('clip-video');
    expect(onFadeStart.mock.calls[0][2]).toBe('left');
  });

  it('mounts shell trim handles for the active trim clip and dispatches trim commands', () => {
    const onTrimStart = vi.fn();

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
    });

    const overlay = container.querySelector<HTMLElement>('.timeline-canvas-dom-overlay');
    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');
    const shellRightHandle = container.querySelector<HTMLElement>('.shell-trim-handle.right');

    expect(overlay).toBeTruthy();
    expect(shell?.dataset.mountReasons).toBe('trim');
    expect(shell?.dataset.activeSlots).toBe('trim fade');
    expect(container.querySelectorAll('.shell-trim-handle')).toHaveLength(2);
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeNull();

    fireEvent.mouseDown(shellRightHandle as HTMLElement, { button: 0 });

    expect(onTrimStart).toHaveBeenCalledTimes(1);
    expect(onTrimStart.mock.calls[0][1]).toBe('clip-video');
    expect(onTrimStart.mock.calls[0][2]).toBe('right');
  });

  it('mounts a context-menu shell without the legacy overlay body for the open clip menu', () => {

    const { container } = renderTimelineTrack({
      clips: [createClip()],
      clipContextMenu: {
        clipId: 'clip-video',
        x: 96,
        y: 32,
      },
    });

    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');

    expect(shell).toBeTruthy();
    expect(shell?.dataset.clipId).toBe('clip-video');
    expect(shell?.dataset.mountReasons).toBe('context-menu-open');
    expect(shell?.dataset.activeSlots).toBe('context-menu');
    expect(shell?.style.pointerEvents).toBe('none');
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeNull();
  });

  it('mounts a drag-only shell without the legacy overlay body for an active clip drag', () => {

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
    });

    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');

    expect(shell).toBeTruthy();
    expect(shell?.dataset.clipId).toBe('clip-video');
    expect(shell?.dataset.mountReasons).toBe('drag');
    expect(shell?.dataset.activeSlots).toBe('');
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeNull();
  });

  it('keeps a drag-hover shell without the legacy overlay body', () => {

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
    });

    fireEvent.mouseMove(row, { clientX: 45, clientY: 24 });

    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');

    expect(shell).toBeTruthy();
    expect(shell?.dataset.clipId).toBe('clip-video');
    expect(shell?.dataset.mountReasons).toBe('hover drag');
    expect(shell?.dataset.activeSlots).toBe('trim fade');
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeNull();
  });

  it('keeps a multi-drag-hover shell without the legacy overlay body', () => {
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
    });

    fireEvent.mouseMove(row, { clientX: 105, clientY: 24 });

    const secondaryShell = container.querySelector<HTMLElement>('.clip-interaction-shell[data-clip-id="clip-secondary"]');

    expect(secondaryShell).toBeTruthy();
    expect(secondaryShell?.dataset.mountReasons).toBe('hover multi-drag');
    expect(secondaryShell?.dataset.activeSlots).toBe('trim fade');
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeNull();
  });

  it('renders selected clip keyframe ticks through the shell without the legacy overlay', () => {
    const onMoveKeyframeGroup = vi.fn();

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
      onMoveKeyframeGroup,
    });

    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');
    const tick = container.querySelector<HTMLElement>('.clip-interaction-shell .keyframe-tick');

    expect(shell).toBeTruthy();
    expect(shell?.dataset.clipId).toBe('clip-video');
    expect(shell?.dataset.mountReasons).toBe('selected-keyframes');
    expect(shell?.dataset.activeSlots).toBe('keyframe');
    expect(shell?.style.pointerEvents).toBe('none');
    expect(tick).toBeTruthy();
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeNull();

    fireEvent.mouseDown(tick as HTMLElement, { button: 0, clientX: 20 });
    fireEvent.mouseMove(document, { clientX: 30 });
    fireEvent.mouseUp(document);

    expect(onMoveKeyframeGroup).toHaveBeenCalledTimes(1);
    expect(onMoveKeyframeGroup.mock.calls[0][0]).toEqual(['kf-opacity']);
    expect(onMoveKeyframeGroup.mock.calls[0][1]).toBeCloseTo(2);
  });

  it('routes selected clip keyframe tick drags through typed keyframe transactions', () => {
    const onMoveKeyframeGroup = vi.fn();
    const applyTimelineEditOperation = vi.fn(() => ({ success: true, warnings: [] }));

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
      onMoveKeyframeGroup,
      applyTimelineEditOperation: applyTimelineEditOperation as never,
    });

    const tick = container.querySelector<HTMLElement>('.clip-interaction-shell .keyframe-tick');
    expect(tick).toBeTruthy();

    fireEvent.mouseDown(tick as HTMLElement, { button: 0, clientX: 20 });
    fireEvent.mouseMove(document, { clientX: 30 });
    fireEvent.mouseUp(document);

    expect(onMoveKeyframeGroup).not.toHaveBeenCalled();
    expect(applyTimelineEditOperation).toHaveBeenCalledTimes(3);
    expect(applyTimelineEditOperation.mock.calls[0][0]).toMatchObject({
      type: 'keyframe-transaction-begin',
      phase: 'begin',
      clipId: 'clip-video',
      keyframeIds: ['kf-opacity'],
      intent: 'drag-diamond',
    });
    expect(applyTimelineEditOperation.mock.calls[1][0]).toMatchObject({
      type: 'keyframe-transaction-update',
      phase: 'update',
      clipId: 'clip-video',
      keyframeIds: ['kf-opacity'],
      operations: [
        {
          type: 'keyframe-move',
          keyframeId: 'kf-opacity',
          clipId: 'clip-video',
          property: 'opacity',
          originalTime: 1,
          requestedTime: 2,
          resolvedTime: 2,
        },
      ],
    });
    expect(applyTimelineEditOperation.mock.calls[1][1]).toMatchObject({
      source: 'ui',
      historyLabel: 'Move keyframes',
      deferHistoryCommit: true,
    });
    expect(applyTimelineEditOperation.mock.calls[2][0]).toMatchObject({
      type: 'keyframe-transaction-commit',
      phase: 'commit',
      clipId: 'clip-video',
      keyframeIds: ['kf-opacity'],
      operations: [
        {
          type: 'keyframe-move',
          keyframeId: 'kf-opacity',
          clipId: 'clip-video',
          property: 'opacity',
          originalTime: 1,
          requestedTime: 2,
          resolvedTime: 2,
        },
      ],
    });
    expect(applyTimelineEditOperation.mock.calls[2][1]).toMatchObject({
      source: 'ui',
      historyLabel: 'Move keyframes',
    });
  });

  it('does not fall back to legacy keyframe group moves when typed drag targets go stale', () => {
    const onMoveKeyframeGroup = vi.fn();
    const applyTimelineEditOperation = vi.fn(() => ({ success: true, warnings: [] }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const { container, props, rerender } = renderTimelineTrack({
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
        onMoveKeyframeGroup,
        applyTimelineEditOperation: applyTimelineEditOperation as never,
      });

      const tick = container.querySelector<HTMLElement>('.clip-interaction-shell .keyframe-tick');
      expect(tick).toBeTruthy();

      fireEvent.mouseDown(tick as HTMLElement, { button: 0, clientX: 20 });
      expect(applyTimelineEditOperation).toHaveBeenCalledTimes(1);

      rerender(
        <TimelineTrack
          {...props}
          clipKeyframes={new Map([
            [
              'clip-video',
              [
                {
                  id: 'kf-opacity-replacement',
                  clipId: 'clip-video',
                  time: 1.5,
                  property: 'opacity',
                  value: 0.75,
                  easing: 'linear',
                },
              ],
            ],
          ])}
          selectedKeyframeIds={new Set(['kf-opacity-replacement'])}
        />
      );

      fireEvent.mouseMove(document, { clientX: 30 });
      fireEvent.mouseUp(document);

      expect(onMoveKeyframeGroup).not.toHaveBeenCalled();
      expect(applyTimelineEditOperation).toHaveBeenCalledTimes(1);
      expect(applyTimelineEditOperation.mock.calls[0][0]).toMatchObject({
        type: 'keyframe-transaction-begin',
        phase: 'begin',
        clipId: 'clip-video',
        keyframeIds: ['kf-opacity'],
      });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not commit a keyframe tick transaction when the tick was clicked without movement', () => {
    const applyTimelineEditOperation = vi.fn(() => ({ success: true, warnings: [] }));

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
      applyTimelineEditOperation: applyTimelineEditOperation as never,
    });

    const tick = container.querySelector<HTMLElement>('.clip-interaction-shell .keyframe-tick');
    expect(tick).toBeTruthy();

    fireEvent.mouseDown(tick as HTMLElement, { button: 0, clientX: 20 });
    fireEvent.mouseUp(document);

    expect(applyTimelineEditOperation).toHaveBeenCalledTimes(1);
    expect(applyTimelineEditOperation.mock.calls[0][0]).toMatchObject({
      type: 'keyframe-transaction-begin',
      phase: 'begin',
      clipId: 'clip-video',
      keyframeIds: ['kf-opacity'],
    });
  });

  it('routes expanded curve-editor keyframe drags through typed move and value transactions', () => {
    const onMoveKeyframe = vi.fn();
    const applyTimelineEditOperation = vi.fn(() => ({ success: true, warnings: [] }));
    const rectSpy = vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      top: 0,
      right: 200,
      bottom: 100,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    try {
      const { container } = renderTimelineTrack({
        clips: [createClip()],
        isExpanded: true,
        dynamicHeight: 220,
        selectedClipIds: new Set(['clip-video']),
        selectedKeyframeIds: new Set(['kf-opacity']),
        expandedCurveProperties: new Map([['track-video', new Set(['opacity'])]]),
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
              {
                id: 'kf-opacity-right',
                clipId: 'clip-video',
                time: 3,
                property: 'opacity',
                value: 0.75,
                easing: 'linear',
              },
            ],
          ],
        ]),
        onMoveKeyframe,
        applyTimelineEditOperation: applyTimelineEditOperation as never,
      });

      const curveKeyframe = container.querySelector<HTMLElement>('.curve-editor-keyframe');
      expect(curveKeyframe).toBeTruthy();

      fireEvent.mouseDown(curveKeyframe as HTMLElement, { button: 0, clientX: 30, clientY: 50, buttons: 1 });
      fireEvent.mouseMove(window, { clientX: 40, clientY: 55, buttons: 1 });
      fireEvent.mouseUp(window);

      expect(onMoveKeyframe).not.toHaveBeenCalled();
      expect(applyTimelineEditOperation).toHaveBeenCalledTimes(3);
      expect(applyTimelineEditOperation.mock.calls[0][0]).toMatchObject({
        type: 'keyframe-transaction-begin',
        phase: 'begin',
        clipId: 'clip-video',
        property: 'opacity',
        keyframeIds: ['kf-opacity'],
        intent: 'curve-editor',
      });
      expect(applyTimelineEditOperation.mock.calls[1][0]).toMatchObject({
        type: 'keyframe-transaction-update',
        phase: 'update',
        clipId: 'clip-video',
        property: 'opacity',
        keyframeIds: ['kf-opacity'],
        operations: [
          {
            type: 'keyframe-move',
            keyframeId: 'kf-opacity',
            clipId: 'clip-video',
            property: 'opacity',
            originalTime: 1,
            requestedTime: 2,
            resolvedTime: 2,
          },
          {
            type: 'keyframe-update-value',
            keyframeId: 'kf-opacity',
            clipId: 'clip-video',
            property: 'opacity',
            value: { value: expect.any(Number) },
          },
        ],
      });
      expect(applyTimelineEditOperation.mock.calls[1][1]).toMatchObject({
        source: 'ui',
        historyLabel: 'Edit curve keyframe',
        deferHistoryCommit: true,
      });
      expect(applyTimelineEditOperation.mock.calls[2][0]).toMatchObject({
        type: 'keyframe-transaction-commit',
        phase: 'commit',
        clipId: 'clip-video',
        property: 'opacity',
        keyframeIds: ['kf-opacity'],
      });
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('does not fall back to legacy curve keyframe moves when typed drag targets go stale', () => {
    const onMoveKeyframe = vi.fn();
    const applyTimelineEditOperation = vi.fn(() => ({ success: true, warnings: [] }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rectSpy = vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      top: 0,
      right: 200,
      bottom: 100,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    try {
      const { container, props, rerender } = renderTimelineTrack({
        clips: [createClip()],
        isExpanded: true,
        dynamicHeight: 220,
        selectedClipIds: new Set(['clip-video']),
        selectedKeyframeIds: new Set(['kf-opacity']),
        expandedCurveProperties: new Map([['track-video', new Set(['opacity'])]]),
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
              {
                id: 'kf-opacity-right',
                clipId: 'clip-video',
                time: 3,
                property: 'opacity',
                value: 0.75,
                easing: 'linear',
              },
            ],
          ],
        ]),
        onMoveKeyframe,
        applyTimelineEditOperation: applyTimelineEditOperation as never,
      });

      const curveKeyframe = container.querySelector<HTMLElement>('.curve-editor-keyframe');
      expect(curveKeyframe).toBeTruthy();

      fireEvent.mouseDown(curveKeyframe as HTMLElement, { button: 0, clientX: 30, clientY: 50, buttons: 1 });
      expect(applyTimelineEditOperation).toHaveBeenCalledTimes(1);

      rerender(
        <TimelineTrack
          {...props}
          clipKeyframes={new Map([
            [
              'clip-video',
              [
                {
                  id: 'kf-opacity-replacement',
                  clipId: 'clip-video',
                  time: 1.5,
                  property: 'opacity',
                  value: 0.65,
                  easing: 'linear',
                },
                {
                  id: 'kf-opacity-right',
                  clipId: 'clip-video',
                  time: 3,
                  property: 'opacity',
                  value: 0.75,
                  easing: 'linear',
                },
              ],
            ],
          ])}
          selectedKeyframeIds={new Set(['kf-opacity-replacement'])}
        />
      );

      fireEvent.mouseMove(window, { clientX: 40, clientY: 55, buttons: 1 });
      fireEvent.mouseUp(window);

      expect(onMoveKeyframe).not.toHaveBeenCalled();
      expect(applyTimelineEditOperation).toHaveBeenCalledTimes(1);
      expect(applyTimelineEditOperation.mock.calls[0][0]).toMatchObject({
        type: 'keyframe-transaction-begin',
        phase: 'begin',
        clipId: 'clip-video',
        property: 'opacity',
        keyframeIds: ['kf-opacity'],
      });
    } finally {
      rectSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('routes expanded curve-editor bezier handle drags through typed handle transactions', () => {
    const onUpdateBezierHandle = vi.fn();
    const applyTimelineEditOperation = vi.fn(() => ({ success: true, warnings: [] }));
    const rectSpy = vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      top: 0,
      right: 200,
      bottom: 100,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    try {
      const { container } = renderTimelineTrack({
        clips: [createClip()],
        isExpanded: true,
        dynamicHeight: 220,
        selectedClipIds: new Set(['clip-video']),
        selectedKeyframeIds: new Set(['kf-opacity']),
        expandedCurveProperties: new Map([['track-video', new Set(['opacity'])]]),
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
                easing: 'bezier',
              },
              {
                id: 'kf-opacity-right',
                clipId: 'clip-video',
                time: 3,
                property: 'opacity',
                value: 0.75,
                easing: 'linear',
              },
            ],
          ],
        ]),
        onUpdateBezierHandle,
        applyTimelineEditOperation: applyTimelineEditOperation as never,
      });

      const handle = container.querySelector<HTMLElement>('.curve-editor-handle');
      expect(handle).toBeTruthy();

      fireEvent.mouseDown(handle as HTMLElement, { button: 0, clientX: 36, clientY: 50, buttons: 1 });
      fireEvent.mouseMove(window, { clientX: 50, clientY: 42, buttons: 1 });
      fireEvent.mouseUp(window);

      expect(onUpdateBezierHandle).not.toHaveBeenCalled();
      expect(applyTimelineEditOperation).toHaveBeenCalledTimes(3);
      expect(applyTimelineEditOperation.mock.calls[0][0]).toMatchObject({
        type: 'keyframe-transaction-begin',
        phase: 'begin',
        clipId: 'clip-video',
        property: 'opacity',
        keyframeIds: ['kf-opacity'],
        intent: 'curve-editor',
      });
      expect(applyTimelineEditOperation.mock.calls[1][0]).toMatchObject({
        type: 'keyframe-transaction-update',
        phase: 'update',
        clipId: 'clip-video',
        property: 'opacity',
        keyframeIds: ['kf-opacity'],
        operations: [
          {
            type: 'keyframe-update-bezier-handle',
            keyframeId: 'kf-opacity',
            clipId: 'clip-video',
            property: 'opacity',
            handle: 'out',
            position: expect.objectContaining({
              x: expect.any(Number),
              y: expect.any(Number),
            }),
          },
        ],
      });
      expect(applyTimelineEditOperation.mock.calls[1][1]).toMatchObject({
        source: 'ui',
        historyLabel: 'Edit bezier handle',
        deferHistoryCommit: true,
      });
      expect(applyTimelineEditOperation.mock.calls[2][0]).toMatchObject({
        type: 'keyframe-transaction-commit',
        phase: 'commit',
        clipId: 'clip-video',
        property: 'opacity',
        keyframeIds: ['kf-opacity'],
      });
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('renders mixed keyframe and audio-region shell modules without the legacy overlay body', () => {

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
      audioRegionSelection: {
        clipId: 'clip-video',
        trackId: 'track-video',
        startTime: 2.5,
        endTime: 3.5,
        sourceInPoint: 0.5,
        sourceOutPoint: 1.5,
      },
    });

    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');

    expect(shell).toBeTruthy();
    expect(shell?.dataset.mountReasons).toBe('selected-keyframes audio-region-active');
    expect(shell?.dataset.activeSlots).toBe('keyframe audio-region');
    expect(container.querySelector('.clip-interaction-shell .keyframe-tick')).toBeTruthy();
    expect(container.querySelector('.clip-interaction-shell .clip-audio-region-selection')).toBeTruthy();
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeNull();
  });

  it('renders mixed context-menu and keyframe shell modules without the legacy overlay body', () => {

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
      clipContextMenu: {
        clipId: 'clip-video',
        x: 96,
        y: 32,
      },
    });

    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');

    expect(shell).toBeTruthy();
    expect(shell?.dataset.mountReasons).toBe('context-menu-open selected-keyframes');
    expect(shell?.dataset.activeSlots).toBe('keyframe context-menu');
    expect(container.querySelector('.clip-interaction-shell .keyframe-tick')).toBeTruthy();
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeNull();
  });

  it('renders an audio-region shell without the legacy overlay body for an active audio region', () => {

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
    });

    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');

    expect(shell).toBeTruthy();
    expect(shell?.dataset.mountReasons).toBe('audio-region-active');
    expect(shell?.dataset.activeSlots).toBe('audio-region');
    expect(shell?.style.pointerEvents).toBe('none');
    expect(container.querySelector('.clip-interaction-shell .clip-audio-region-selection')).toBeTruthy();
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeNull();
  });

  it('renders a spectral-region shell without the legacy overlay body for an active spectral selection', () => {

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
    });

    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');

    expect(shell).toBeTruthy();
    expect(shell?.dataset.mountReasons).toBe('spectral-region-active');
    expect(shell?.dataset.activeSlots).toBe('spectral-region');
    expect(shell?.style.pointerEvents).toBe('none');
    expect(container.querySelector('.clip-interaction-shell .clip-spectral-region-selection')).toBeTruthy();
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeNull();
  });

  it('renders a video-bake shell without the legacy overlay body for a clip bake region', () => {

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
    });

    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');

    expect(shell).toBeTruthy();
    expect(shell?.dataset.mountReasons).toBe('video-bake-active');
    expect(shell?.dataset.activeSlots).toBe('video-bake');
    expect(shell?.style.pointerEvents).toBe('none');
    expect(container.querySelector('.clip-interaction-shell .clip-video-bake-region')).toBeTruthy();
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeNull();
  });

  it('renders a stem shell module without the legacy overlay body for an active stem job', () => {

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
    });

    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');
    const stemModule = container.querySelector<HTMLElement>('.shell-stem-module');

    expect(shell).toBeTruthy();
    expect(shell?.dataset.mountReasons).toBe('stem-active');
    expect(shell?.dataset.activeSlots).toBe('stem');
    expect(shell?.style.pointerEvents).toBe('none');
    expect(stemModule).toBeTruthy();
    expect(container.querySelector('.stem-percent')?.textContent).toBe('50%');
    expect(container.querySelector('.timeline-canvas-dom-overlay .timeline-clip')).toBeNull();
  });
});
