import { afterEach, describe, expect, it } from 'vitest';
import { compileGuidedToolCall } from '../../src/services/guidedActions';
import { DEFAULT_TRANSFORM, useTimelineStore } from '../../src/stores/timeline';
import type { GuidedAction, GuidedToolCall } from '../../src/services/guidedActions';
import type { TimelineClip } from '../../src/types';

describe('guided action compiler', () => {
  afterEach(() => {
    useTimelineStore.setState({ clips: [] });
  });

  it('compiles selectClips into a visible clip click choreography', () => {
    const toolCall: GuidedToolCall = {
      tool: 'selectClips',
      args: {
        clipIds: ['clip-1'],
      },
    };

    const compiled = compileGuidedToolCall(toolCall);
    const actions = compiled.actions;

    expect(compiled.diagnostics.supported).toBe(true);
    expect(compiled.diagnostics.executionActionCount).toBe(1);
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'focusPanel',
      panel: 'timeline',
      family: 'selection-navigation',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'moveCursorTo',
      target: { kind: 'timelineClip', clipId: 'clip-1' },
      optional: true,
      family: 'selection-navigation',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'clickVisual',
      target: { kind: 'timelineClip', clipId: 'clip-1' },
      optional: true,
      family: 'selection-navigation',
    }));
    expect(getExecutionActions(actions)).toEqual([
      expect.objectContaining({
        type: 'executeTool',
        tool: 'selectClips',
        args: toolCall.args,
        family: 'selection-navigation',
      }),
    ]);
  });

  it('compiles setTransform into properties choreography with one execution point', () => {
    const toolCall: GuidedToolCall = {
      tool: 'setTransform',
      args: {
        clipId: 'clip-1',
        x: 240,
        scaleAll: 1.5,
      },
    };

    const compiled = compileGuidedToolCall(toolCall);
    const actions = compiled.actions;

    expect(compiled.diagnostics.supported).toBe(true);
    expect(compiled.diagnostics.executionActionCount).toBe(1);
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'openPropertiesTab',
      tab: 'transform',
      family: 'property-edit',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'moveCursorTo',
      target: { kind: 'propertyControl', property: 'position.x', clipId: 'clip-1' },
      family: 'property-edit',
      optional: true,
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'highlightTarget',
      target: { kind: 'propertyControl', property: 'position.x', clipId: 'clip-1' },
      family: 'property-edit',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'clickVisual',
      target: { kind: 'propertyControl', property: 'position.x', clipId: 'clip-1' },
      family: 'property-edit',
      optional: true,
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'highlightTarget',
      target: { kind: 'propertyControl', property: 'scale.all', clipId: 'clip-1' },
      family: 'property-edit',
    }));
    expect(getExecutionActions(actions)).toEqual([
      expect.objectContaining({
        type: 'executeTool',
        tool: 'setTransform',
        args: toolCall.args,
        family: 'property-edit',
      }),
    ]);
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'confirmState',
      check: {
        kind: 'clipTransformMatches',
        clipId: 'clip-1',
        property: 'position.x',
        value: 240,
        valueSpace: 'toolPixels',
      },
      family: 'property-edit',
    }));
  });

  it('compiles splitClip into timeline choreography', () => {
    const toolCall: GuidedToolCall = {
      tool: 'splitClip',
      args: {
        clipId: 'clip-1',
        splitTime: 12.5,
      },
    };

    const compiled = compileGuidedToolCall(toolCall);
    const actions = compiled.actions;

    expect(compiled.diagnostics.supported).toBe(true);
    expect(compiled.diagnostics.executionActionCount).toBe(1);
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'focusPanel',
      panel: 'timeline',
      family: 'timeline-edit',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'clickVisual',
      target: { kind: 'button', id: 'timeline-tool-group:cut' },
      button: 'right',
      gestureLabel: 'RMB',
      family: 'timeline-edit',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'setPlayheadVisual',
      time: 12.5,
      family: 'timeline-edit',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'scrollIntoView',
      target: { kind: 'timelineTime', time: 12.5 },
      family: 'timeline-edit',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'moveCursorTo',
      target: { kind: 'timelineTime', time: 12.5 },
      family: 'timeline-edit',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'clickVisual',
      target: { kind: 'timelineTime', time: 12.5 },
      button: 'left',
      gestureLabel: 'LMB',
      family: 'timeline-edit',
    }));
    expect(actions).not.toContainEqual(expect.objectContaining({
      type: 'highlightTarget',
      target: { kind: 'timelineTime', time: 12.5 },
    }));
    expect(getExecutionActions(actions)[0]).toEqual(expect.objectContaining({
      type: 'executeTool',
      tool: 'splitClip',
      args: toolCall.args,
      family: 'timeline-edit',
    }));
  });

  it('derives splitClipEvenly cursor cuts from the live clip timing', () => {
    useTimelineStore.setState({
      clips: [
        createTimelineClip({
          id: 'clip-even',
          trackId: 'video-1',
          startTime: 10,
          duration: 20,
          inPoint: 0,
          outPoint: 20,
        }),
      ],
    });
    const toolCall: GuidedToolCall = {
      tool: 'splitClipEvenly',
      args: {
        clipId: 'clip-even',
        parts: 5,
      },
    };

    const compiled = compileGuidedToolCall(toolCall);
    const cutTargets = [14, 18, 22, 26].map((time) => ({ kind: 'timelineTime' as const, trackId: 'video-1', time }));
    const lastCutClickIndex = compiled.actions.findLastIndex((action) => (
      action.type === 'clickVisual'
      && action.target?.kind === 'timelineTime'
      && action.target.time === 26
    ));
    const moveToToolGroupIndex = compiled.actions.findIndex((action) => (
      action.type === 'moveCursorTo'
      && action.target.kind === 'button'
      && action.target.id === 'timeline-tool-group:cut'
    ));
    const selectCutCategoryIndex = compiled.actions.findIndex((action) => (
      action.type === 'clickVisual'
      && action.target?.kind === 'button'
      && action.target.id === 'timeline-tool-group:cut'
      && action.button === 'left'
      && action.gestureDetail === 'Select category'
    ));
    const rightClickToolGroupIndex = compiled.actions.findIndex((action) => (
      action.type === 'clickVisual'
      && action.target?.kind === 'button'
      && action.target.id === 'timeline-tool-group:cut'
      && action.button === 'right'
    ));
    const openToolMenuIndex = compiled.actions.findIndex((action) => (
      action.type === 'openTimelineToolGroupVisual'
      && action.groupId === 'cut'
      && action.targetToolId === 'blade'
    ));
    const moveToBladeItemIndex = compiled.actions.findIndex((action) => (
      action.type === 'moveCursorTo'
      && action.target.kind === 'button'
      && action.target.id === 'timeline-tool:blade'
    ));
    const selectBladeItemIndex = compiled.actions.findIndex((action) => (
      action.type === 'clickVisual'
      && action.target?.kind === 'button'
      && action.target.id === 'timeline-tool:blade'
      && action.button === 'left'
    ));
    const moveToSelectionToolGroupIndex = compiled.actions.findLastIndex((action) => (
      action.type === 'moveCursorTo'
      && action.target.kind === 'button'
      && action.target.id === 'timeline-tool-group:selection'
    ));
    const selectSelectionCategoryIndex = compiled.actions.findLastIndex((action) => (
      action.type === 'clickVisual'
      && action.target?.kind === 'button'
      && action.target.id === 'timeline-tool-group:selection'
      && action.button === 'left'
      && action.gestureDetail === 'Select category'
    ));
    const rightClickSelectionToolGroupIndex = compiled.actions.findLastIndex((action) => (
      action.type === 'clickVisual'
      && action.target?.kind === 'button'
      && action.target.id === 'timeline-tool-group:selection'
      && action.button === 'right'
    ));
    const openSelectionToolMenuIndex = compiled.actions.findLastIndex((action) => (
      action.type === 'openTimelineToolGroupVisual'
      && action.groupId === 'selection'
      && action.targetToolId === 'select'
    ));
    const moveToSelectionItemIndex = compiled.actions.findLastIndex((action) => (
      action.type === 'moveCursorTo'
      && action.target.kind === 'button'
      && action.target.id === 'timeline-tool:select'
    ));
    const selectSelectionItemIndex = compiled.actions.findLastIndex((action) => (
      action.type === 'clickVisual'
      && action.target?.kind === 'button'
      && action.target.id === 'timeline-tool:select'
      && action.button === 'left'
    ));
    const setSelectToolIndex = compiled.actions.findLastIndex((action) => (
      action.type === 'setTimelineToolVisual'
      && action.toolId === 'select'
    ));
    const returnToTimelineIndex = compiled.actions.findLastIndex((action) => (
      action.type === 'moveCursorTo'
      && action.target.kind === 'timelineTime'
      && action.target.time === 26
    ));

    expect(compiled.diagnostics.supported).toBe(true);
    expect(compiled.diagnostics.executionActionCount).toBe(4);
    expect(moveToToolGroupIndex).toBeGreaterThanOrEqual(0);
    expect(selectCutCategoryIndex).toBeGreaterThan(moveToToolGroupIndex);
    expect(rightClickToolGroupIndex).toBeGreaterThan(selectCutCategoryIndex);
    expect(openToolMenuIndex).toBeGreaterThan(rightClickToolGroupIndex);
    expect(moveToBladeItemIndex).toBeGreaterThan(openToolMenuIndex);
    expect(selectBladeItemIndex).toBeGreaterThan(moveToBladeItemIndex);
    expect(moveToSelectionToolGroupIndex).toBeGreaterThan(lastCutClickIndex);
    expect(selectSelectionCategoryIndex).toBeGreaterThan(moveToSelectionToolGroupIndex);
    expect(rightClickSelectionToolGroupIndex).toBeGreaterThan(selectSelectionCategoryIndex);
    expect(openSelectionToolMenuIndex).toBeGreaterThan(rightClickSelectionToolGroupIndex);
    expect(moveToSelectionItemIndex).toBeGreaterThan(openSelectionToolMenuIndex);
    expect(selectSelectionItemIndex).toBeGreaterThan(moveToSelectionItemIndex);
    expect(setSelectToolIndex).toBeGreaterThan(selectSelectionItemIndex);
    expect(returnToTimelineIndex).toBeGreaterThan(setSelectToolIndex);
    expect(compiled.actions).toContainEqual(expect.objectContaining({
      type: 'moveCursorTo',
      target: { kind: 'timelineClip', clipId: 'clip-even' },
      family: 'timeline-edit',
    }));
    expect(compiled.actions).toContainEqual(expect.objectContaining({
      type: 'setTimelineToolVisual',
      toolId: 'blade',
      family: 'timeline-edit',
    }));
    for (const target of cutTargets) {
      expect(compiled.actions).toContainEqual(expect.objectContaining({
        type: 'setPlayheadVisual',
        time: target.time,
        family: 'timeline-edit',
      }));
      expect(compiled.actions).toContainEqual(expect.objectContaining({
        type: 'moveCursorTo',
        target,
        family: 'timeline-edit',
      }));
      expect(compiled.actions).toContainEqual(expect.objectContaining({
        type: 'clickVisual',
        target,
        button: 'left',
        gestureLabel: 'LMB',
        gestureDetail: 'Cut',
        family: 'timeline-edit',
      }));
      const cutClickIndex = compiled.actions.findIndex((action) => (
        action.type === 'clickVisual'
        && action.target?.kind === 'timelineTime'
        && action.target.time === target.time
      ));
      const cutExecuteIndex = compiled.actions.findIndex((action) => (
        action.type === 'executeTool'
        && action.tool === 'splitClip'
        && action.args.splitTime === target.time
      ));
      expect(cutExecuteIndex).toBeGreaterThan(cutClickIndex);
    }
    expect(compiled.actions).not.toContainEqual(expect.objectContaining({
      type: 'highlightTarget',
      target: expect.objectContaining({ kind: 'timelineTime' }),
    }));
    expect(lastCutClickIndex).toBeGreaterThan(0);
    expect(compiled.actions).toContainEqual(expect.objectContaining({
      type: 'setTimelineToolVisual',
      toolId: 'select',
      family: 'timeline-edit',
    }));
    expect(getExecutionActions(compiled.actions)).toEqual(cutTargets.map((target) => (
      expect.objectContaining({
        type: 'executeTool',
        tool: 'splitClip',
        args: expect.objectContaining({
          clipId: 'clip-even',
          splitTime: target.time,
          guidedResolveClipAtTimeTrackId: 'video-1',
        }),
        family: 'timeline-edit',
      })
    )));
  });

  it('compiles setPlayhead into a visible cursor choreography', () => {
    const toolCall: GuidedToolCall = {
      tool: 'setPlayhead',
      args: {
        time: 2.25,
      },
    };

    const compiled = compileGuidedToolCall(toolCall);
    const actions = compiled.actions;

    expect(compiled.diagnostics.supported).toBe(true);
    expect(compiled.diagnostics.executionActionCount).toBe(1);
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'setPlayheadVisual',
      time: 2.25,
      family: 'selection-navigation',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'moveCursorTo',
      target: { kind: 'timelineTime', time: 2.25 },
      family: 'selection-navigation',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'confirmState',
      check: { kind: 'playheadAtTime', time: 2.25, toleranceSeconds: 0.001 },
      family: 'selection-navigation',
    }));
    expect(getExecutionActions(actions)[0]).toEqual(expect.objectContaining({
      type: 'executeTool',
      tool: 'setPlayhead',
      args: toolCall.args,
      family: 'selection-navigation',
    }));
  });

  it('compiles addRectangleMask into mask toolbar choreography', () => {
    const toolCall: GuidedToolCall = {
      tool: 'addRectangleMask',
      args: {
        clipId: 'clip-1',
      },
    };

    const compiled = compileGuidedToolCall(toolCall);
    const actions = compiled.actions;

    expect(compiled.diagnostics.supported).toBe(true);
    expect(compiled.diagnostics.executionActionCount).toBe(1);
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'openPropertiesTab',
      tab: 'masks',
      family: 'mask-edit',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'moveCursorTo',
      target: { kind: 'maskToolbarButton', button: 'rectangle' },
      family: 'mask-edit',
      optional: true,
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'highlightTarget',
      target: { kind: 'maskToolbarButton', button: 'rectangle' },
      family: 'mask-edit',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'clickVisual',
      target: { kind: 'maskToolbarButton', button: 'rectangle' },
      family: 'mask-edit',
      optional: true,
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'confirmState',
      check: { kind: 'maskExists', clipId: 'clip-1' },
      family: 'mask-edit',
    }));
  });

  it('compiles custom masks into a cursor-drawn preview path', () => {
    const toolCall: GuidedToolCall = {
      tool: 'addMask',
      args: {
        clipId: 'clip-1',
        vertices: [
          { x: 0.2, y: 0.2 },
          { x: 0.7, y: 0.2 },
          { x: 0.8, y: 0.6 },
          { x: 0.4, y: 0.8 },
          { x: 0.15, y: 0.55 },
        ],
        closed: true,
      },
    };

    const compiled = compileGuidedToolCall(toolCall);

    expect(compiled.diagnostics.supported).toBe(true);
    expect(compiled.actions).toContainEqual(expect.objectContaining({
      type: 'focusPanel',
      panel: 'preview',
      family: 'mask-edit',
    }));
    expect(compiled.diagnostics.executionActionCount).toBe(1);
    expect(compiled.actions).toContainEqual(expect.objectContaining({
      type: 'drawMaskPath',
      clipId: 'clip-1',
      vertices: [
        { x: 0.2, y: 0.2 },
        { x: 0.7, y: 0.2 },
        { x: 0.8, y: 0.6 },
        { x: 0.4, y: 0.8 },
        { x: 0.15, y: 0.55 },
      ],
      close: true,
      family: 'mask-edit',
    }));
    expect(getExecutionActions(compiled.actions)).toHaveLength(0);
  });

  it('compiles mask path keyframes into a cursor-drawn preview path', () => {
    const toolCall: GuidedToolCall = {
      tool: 'addMaskPathKeyframe',
      args: {
        clipId: 'clip-1',
        maskId: 'mask-1',
        time: 4,
        pathValue: {
          closed: true,
          vertices: [
            { id: 'v1', x: 0.2, y: 0.2 },
            { id: 'v2', x: 0.7, y: 0.2 },
            { id: 'v3', x: 0.55, y: 0.35 },
          ],
        },
      },
    };

    const compiled = compileGuidedToolCall(toolCall);

    expect(compiled.diagnostics.supported).toBe(true);
    expect(compiled.actions).toContainEqual(expect.objectContaining({
      type: 'drawPreviewPath',
      points: [
        { x: 0.2, y: 0.2 },
        { x: 0.7, y: 0.2 },
        { x: 0.55, y: 0.35 },
      ],
      close: true,
      family: 'mask-edit',
    }));
    expect(compiled.actions).toContainEqual(expect.objectContaining({
      type: 'confirmState',
      check: {
        kind: 'keyframeExists',
        clipId: 'clip-1',
        property: 'mask.mask-1.path',
        time: 4,
      },
      family: 'mask-edit',
    }));
    expect(getExecutionActions(compiled.actions)).toEqual([
      expect.objectContaining({
        type: 'executeTool',
        tool: 'addMaskPathKeyframe',
        args: toolCall.args,
        family: 'mask-edit',
      }),
    ]);
  });

  it('normalizes executeBatch into visible substeps with a single batch execution point', () => {
    const toolCall: GuidedToolCall = {
      tool: 'executeBatch',
      args: {
        actions: [
          { tool: 'splitClip', args: { clipId: 'clip-1', splitTime: 4 } },
          { tool: 'setTransform', args: { clipId: 'clip-1', y: -25 } },
        ],
      },
    };

    const compiled = compileGuidedToolCall(toolCall);
    const executionActions = getExecutionActions(compiled.actions);

    expect(compiled.diagnostics.supported).toBe(true);
    expect(compiled.diagnostics.flattenedBatchActions).toBe(2);
    expect(executionActions).toEqual([
      expect.objectContaining({
        type: 'executeTool',
        tool: 'executeBatch',
        args: toolCall.args,
        family: 'semantic',
      }),
    ]);
    expect(compiled.actions).toContainEqual(expect.objectContaining({
      type: 'setPlayheadVisual',
      time: 4,
      family: 'timeline-edit',
    }));
    expect(compiled.actions).toContainEqual(expect.objectContaining({
      type: 'moveCursorTo',
      target: { kind: 'timelineTime', time: 4 },
      family: 'timeline-edit',
    }));
    expect(compiled.actions).toContainEqual(expect.objectContaining({
      type: 'highlightTarget',
      target: { kind: 'propertyControl', property: 'position.y', clipId: 'clip-1' },
      family: 'property-edit',
    }));
  });

  it('can inline executeBatch execution points for live guided drops', () => {
    const toolCall: GuidedToolCall = {
      tool: 'executeBatch',
      args: {
        actions: [
          { tool: 'addClipSegment', args: { mediaFileId: 'media-1', trackId: 'video-3', startTime: 0, inPoint: 0, outPoint: 5 } },
          { tool: 'addClipSegment', args: { mediaFileId: 'media-2', trackId: 'video-3', startTime: 5, inPoint: 0, outPoint: 5 } },
        ],
      },
    };

    const compiled = compileGuidedToolCall(toolCall, { batchMode: 'inlineExecutions' });
    const executionActions = getExecutionActions(compiled.actions);
    const firstDragIndex = compiled.actions.findIndex((action) => action.type === 'dragCursor');
    const firstExecuteIndex = compiled.actions.findIndex((action) => action.type === 'executeTool');

    expect(executionActions).toHaveLength(2);
    expect(executionActions).toEqual([
      expect.objectContaining({ tool: 'addClipSegment' }),
      expect.objectContaining({ tool: 'addClipSegment' }),
    ]);
    expect(firstExecuteIndex).toBeGreaterThan(firstDragIndex);
    expect(executionActions).not.toContainEqual(expect.objectContaining({ tool: 'executeBatch' }));
  });

  it('compiles addClipSegment into a media-to-timeline drag choreography', () => {
    const toolCall: GuidedToolCall = {
      tool: 'addClipSegment',
      args: {
        mediaFileId: 'media-1',
        trackId: 'video-3',
        startTime: 10,
        inPoint: 0,
        outPoint: 5,
      },
    };

    const compiled = compileGuidedToolCall(toolCall);
    const actions = compiled.actions;

    expect(compiled.diagnostics.supported).toBe(true);
    expect(compiled.diagnostics.executionActionCount).toBe(1);
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'focusPanel',
      panel: 'media',
      family: 'media',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'moveCursorTo',
      target: { kind: 'mediaItem', itemId: 'media-1' },
      family: 'media',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'clickVisual',
      target: { kind: 'mediaItem', itemId: 'media-1' },
      family: 'media',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'dragCursor',
      from: { kind: 'mediaItem', itemId: 'media-1' },
      to: { kind: 'timelineTime', trackId: 'video-3', time: 10 },
      family: 'media',
    }));
    const dragIndex = actions.findIndex((action) => action.type === 'dragCursor');
    const executeIndex = actions.findIndex((action) => action.type === 'executeTool');
    const calloutIndex = actions.findIndex((action) => (
      action.type === 'callout' && action.title === 'Added clip segment'
    ));
    expect(executeIndex).toBeGreaterThan(dragIndex);
    expect(calloutIndex).toBeGreaterThan(executeIndex);
    expect(getExecutionActions(actions)).toEqual([
      expect.objectContaining({
        type: 'executeTool',
        tool: 'addClipSegment',
        args: toolCall.args,
        family: 'media',
      }),
    ]);
  });

  it('compiles importLocalFiles with addToTimeline into a timeline placement choreography', () => {
    const toolCall: GuidedToolCall = {
      tool: 'importLocalFiles',
      args: {
        paths: ['C:/Users/admin/Downloads/source.mp4'],
        addToTimeline: true,
        trackId: 'video-3',
        startTime: 12,
      },
    };

    const compiled = compileGuidedToolCall(toolCall);
    const actions = compiled.actions;

    expect(compiled.diagnostics.supported).toBe(true);
    expect(compiled.diagnostics.executionActionCount).toBe(1);
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'focusPanel',
      panel: 'media',
      family: 'media',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'dragCursor',
      from: { kind: 'panel', panel: 'media' },
      to: { kind: 'timelineTime', trackId: 'video-3', time: 12 },
      family: 'media',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'highlightTarget',
      target: { kind: 'timelineTime', trackId: 'video-3', time: 12 },
      tone: 'success',
      family: 'media',
    }));
    expect(getExecutionActions(actions)).toEqual([
      expect.objectContaining({
        type: 'executeTool',
        tool: 'importLocalFiles',
        args: toolCall.args,
        family: 'media',
      }),
    ]);
  });

  it('keeps importLocalFiles media-only imports out of the timeline choreography', () => {
    const toolCall: GuidedToolCall = {
      tool: 'importLocalFiles',
      args: {
        paths: ['C:/Users/admin/Downloads/source.mp4'],
      },
    };

    const compiled = compileGuidedToolCall(toolCall);

    expect(compiled.diagnostics.supported).toBe(true);
    expect(compiled.actions).not.toContainEqual(expect.objectContaining({
      type: 'dragCursor',
    }));
    expect(compiled.actions).not.toContainEqual(expect.objectContaining({
      target: expect.objectContaining({ kind: 'timelineTime' }),
    }));
    expect(getExecutionActions(compiled.actions)).toEqual([
      expect.objectContaining({
        type: 'executeTool',
        tool: 'importLocalFiles',
        args: toolCall.args,
        family: 'media',
      }),
    ]);
  });

  it('compiles downloadAndImportVideo into a download-to-timeline choreography', () => {
    const toolCall: GuidedToolCall = {
      tool: 'downloadAndImportVideo',
      args: {
        url: 'https://example.com/video.mp4',
        title: 'Reference',
        startTime: 3,
      },
    };

    const compiled = compileGuidedToolCall(toolCall);
    const actions = compiled.actions;

    expect(compiled.diagnostics.supported).toBe(true);
    expect(compiled.diagnostics.executionActionCount).toBe(1);
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'focusPanel',
      panel: 'media',
      family: 'media',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'dragCursor',
      from: { kind: 'panel', panel: 'media' },
      to: { kind: 'timelineTime', time: 3 },
      family: 'media',
    }));
    const dragIndex = actions.findIndex((action) => action.type === 'dragCursor');
    const executeIndex = actions.findIndex((action) => action.type === 'executeTool');
    const highlightIndex = actions.findIndex((action) => (
      action.type === 'highlightTarget'
      && action.target.kind === 'timelineTime'
      && action.tone === 'success'
    ));
    expect(executeIndex).toBeGreaterThan(dragIndex);
    expect(highlightIndex).toBeGreaterThan(executeIndex);
    expect(getExecutionActions(actions)).toEqual([
      expect.objectContaining({
        type: 'executeTool',
        tool: 'downloadAndImportVideo',
        args: toolCall.args,
        family: 'media',
      }),
    ]);
  });

  it('uses generic choreography for unsupported tools', () => {
    const compiled = compileGuidedToolCall({
      tool: 'unknownTool',
      args: { value: 1 },
    });

    expect(compiled.diagnostics.supported).toBe(false);
    expect(compiled.diagnostics.executionActionCount).toBe(1);
    expect(compiled.actions).toContainEqual(expect.objectContaining({
      type: 'callout',
      title: 'Executing Unknown Tool',
      family: 'semantic',
    }));
    expect(getExecutionActions(compiled.actions)[0]).toEqual(expect.objectContaining({
      type: 'executeTool',
      tool: 'unknownTool',
      family: 'semantic',
    }));
  });
});

function getExecutionActions(actions: GuidedAction[]): GuidedAction[] {
  return actions.filter((action) => action.type === 'executeTool');
}

function createTimelineClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-1',
    trackId: 'video-1',
    name: 'Clip',
    file: new File([], 'clip.mp4'),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'video' },
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    ...overrides,
  };
}
