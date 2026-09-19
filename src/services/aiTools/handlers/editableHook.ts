import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { getTimelineRevision } from '../../../stores/timeline/revisionMiddleware';
import type { TimelineClip } from '../../../types';
import type { ToolResult } from '../types';
import { resolveEditableHookLayerMetadata } from '../editableHookIdentity';
import { handleCreateEditableTitleStack } from './editableTitleStack';
import {
  handleUpdateMotionAppearances,
  handleUpdateMotionProperties,
} from './motionDesign';
import {
  handleSetTextBox,
  handleUpdateTextProperties,
} from './text';
import { authorEditableHookMotion } from './editableHookMotion';
import {
  editableHookExistsInProject,
  executeInEditableHookComposition,
  updateNestedHookWrapper,
  wrapEditableHookInSubcomposition,
} from './editableHookSubcomposition';

import {
  EDITABLE_HOOK_PRESETS,
  PRESET_PLACEMENTS,
  failure,
  isRecord,
  parseRefinementRequest,
  parseRequest,
  resolveFontSize,
  resolvePixelMeasure,
  type EditableHookPlacementPatch,
  type EditableHookPreset,
  type EditableHookRefinementRequest,
  type EditableHookRequest,
  type EditableHookRowInput,
  type ExistingHookRow,
  type ResolvedPlacement,
} from './editableHookParsing';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

export { EDITABLE_HOOK_PRESETS };

function resolvePlacement(
  preset: EditableHookPreset | undefined,
  patch: EditableHookPlacementPatch | undefined,
  compositionWidth: number,
  compositionHeight: number,
): ResolvedPlacement {
  const relativePreset = PRESET_PLACEMENTS[preset ?? 'stacked-center'];
  return {
    x: relativePreset.x * compositionWidth,
    y: relativePreset.y * compositionHeight,
    width: relativePreset.width * compositionWidth,
    rowHeight: relativePreset.rowHeight * compositionHeight,
    gap: relativePreset.gap * compositionHeight,
    ...patch,
  };
}

function boxesForRows(
  placement: ResolvedPlacement,
  rowCount: number,
  width: number,
  height: number,
  verticalPadding: number | readonly number[] = 0,
): Array<{ height: number; width: number; x: number; y: number }> | Error {
  if (placement.x + placement.width > width * 1.05) {
    return new Error('Hook placement extends beyond the right edge');
  }
  const paddings = Array.from({ length: rowCount }, (_unused, index) => Math.max(
    0,
    typeof verticalPadding === 'number' ? verticalPadding : (verticalPadding[index] ?? 0),
  ));
  const boxes: Array<{ height: number; width: number; x: number; y: number }> = [];
  let nextY = placement.y;
  for (let index = 0; index < rowCount; index += 1) {
    boxes.push({
      x: placement.x,
      y: nextY,
      width: placement.width,
      height: placement.rowHeight,
    });
    if (index < rowCount - 1) {
      nextY += placement.rowHeight
        + paddings[index]!
        + placement.gap
        + paddings[index + 1]!;
    }
  }
  const finalBox = boxes.at(-1);
  const finalBottom = finalBox
    ? finalBox.y + finalBox.height + paddings[paddings.length - 1]!
    : placement.y;
  if (finalBottom > height * 1.05) return new Error('Hook placement extends beyond the bottom edge');
  return boxes;
}

function reflowCurrentBoxesForPadding(
  rows: readonly ExistingHookRow[],
  verticalPadding: readonly number[],
  compositionHeight: number,
): Array<{ height: number; width: number; x: number; y: number }> | Error {
  const currentBoxes = rows.map((row) => currentTextBox(row.textClip));
  const currentPadding = rows.map((row) => currentPlatePadding(row).y);
  const boxes: Array<{ height: number; width: number; x: number; y: number }> = [];
  let nextY = currentBoxes[0]?.y ?? 0;
  for (const [index, current] of currentBoxes.entries()) {
    boxes.push({ ...current, y: nextY });
    const following = currentBoxes[index + 1];
    if (!following) continue;
    const textBoxGap = Math.max(0, following.y - (current.y + current.height));
    const currentOuterGap = textBoxGap
      - (currentPadding[index] ?? 0)
      - (currentPadding[index + 1] ?? 0);
    const authoredGap = currentOuterGap >= 0 ? currentOuterGap : textBoxGap;
    nextY += current.height
      + (verticalPadding[index] ?? 0)
      + authoredGap
      + (verticalPadding[index + 1] ?? 0);
  }
  const finalBox = boxes.at(-1);
  const finalBottom = finalBox
    ? finalBox.y + finalBox.height + (verticalPadding[verticalPadding.length - 1] ?? 0)
    : 0;
  return finalBottom > compositionHeight * 1.05
    ? new Error('Hook placement extends beyond the bottom edge')
    : boxes;
}

function hookClips(store: TimelineStore, hookId: string): TimelineClip[] {
  const metadata = resolveEditableHookLayerMetadata(store.clips, store.tracks);
  return store.clips.filter((clip) => metadata.get(clip.id)?.id === hookId);
}

function collectExistingRows(store: TimelineStore, hookId: string): ExistingHookRow[] | Error {
  const metadata = resolveEditableHookLayerMetadata(store.clips, store.tracks);
  const rows = new Map<number, { backplateClip?: TimelineClip; textClip?: TimelineClip }>();
  for (const clip of store.clips) {
    const identity = metadata.get(clip.id);
    if (identity?.id !== hookId) continue;
    const row = rows.get(identity.rowIndex) ?? {};
    if (identity.role === 'text') {
      if (!clip.textProperties || row.textClip) {
        return new Error(`Hook ${hookId} has an invalid text row ${identity.rowIndex}`);
      }
      row.textClip = clip;
    } else {
      if (clip.motion?.shape?.primitive !== 'rectangle' || row.backplateClip) {
        return new Error(`Hook ${hookId} has an invalid background row ${identity.rowIndex}`);
      }
      row.backplateClip = clip;
    }
    rows.set(identity.rowIndex, row);
  }
  const indexes = [...rows.keys()].sort((left, right) => left - right);
  if (indexes.length === 0 || indexes.some((rowIndex, index) => rowIndex !== index)) {
    return new Error(`Hook ${hookId} is incomplete or not editable`);
  }
  const resolvedRows: ExistingHookRow[] = [];
  for (const index of indexes) {
    const row = rows.get(index)!;
    if (!row.textClip || !row.backplateClip) {
      return new Error(`Hook ${hookId} is incomplete or not editable`);
    }
    resolvedRows.push({ index, textClip: row.textClip, backplateClip: row.backplateClip });
  }
  return resolvedRows;
}

function persistHookRowIdentity(hookId: string, rows: readonly ExistingHookRow[]): void {
  for (const row of rows) {
    useTimelineStore.getState().updateClip(row.textClip.id, {
      linkedGroupId: hookId,
      editableHook: { id: hookId, role: 'text', rowIndex: row.index },
    });
    useTimelineStore.getState().updateClip(row.backplateClip.id, {
      linkedGroupId: hookId,
      editableHook: { id: hookId, role: 'background', rowIndex: row.index },
    });
  }
}

function tagCreatedHookRows(
  hookId: string,
  createdRows: Array<{ backplateClipId: string; textClipId: string }>,
  rows: EditableHookRowInput[],
): void {
  const store = useTimelineStore.getState();
  for (const [index, created] of createdRows.entries()) {
    store.updateClip(created.textClipId, {
      linkedGroupId: hookId,
      editableHook: { id: hookId, role: 'text', rowIndex: index },
      name: `Hook ${index + 1}: ${rows[index]?.text ?? 'Text'}`,
    });
    store.updateClip(created.backplateClipId, {
      linkedGroupId: hookId,
      editableHook: { id: hookId, role: 'background', rowIndex: index },
      name: `Hook ${index + 1} Background`,
    });
  }
}

async function createHook(
  request: EditableHookRequest,
  store: TimelineStore,
  nestInSubcomposition = true,
): Promise<ToolResult> {
  if (editableHookExistsInProject(request.hookId)) {
    return failure(`Hook already exists: ${request.hookId}`);
  }
  const composition = useMediaStore.getState().getActiveComposition();
  const compositionWidth = composition?.width ?? 1920;
  const compositionHeight = composition?.height ?? 1080;
  const rows = request.rows!;
  const placement = resolvePlacement(
    request.preset,
    request.placement,
    compositionWidth,
    compositionHeight,
  );
  const style = request.style ?? {};
  const defaultFontSize = Math.max(18, Math.min(120, placement.rowHeight * 0.55));
  const styleFontSize = resolveFontSize(style.fontSize);
  const paddingX = resolvePixelMeasure(style.paddingX);
  const paddingY = resolvePixelMeasure(style.paddingY);
  const cornerRadius = resolvePixelMeasure(style.cornerRadius);
  const resolvedPaddingY = paddingY ?? Math.max(6, compositionHeight * 0.0075);
  const boxes = boxesForRows(
    placement,
    rows.length,
    compositionWidth,
    compositionHeight,
    resolvedPaddingY,
  );
  if (boxes instanceof Error) return failure(boxes.message);
  const result = await handleCreateEditableTitleStack({
    ...(request.startTime === undefined ? {} : { startTime: request.startTime }),
    duration: request.duration ?? 4,
    rows: rows.map((row, index) => ({
      text: row.text,
      name: `Hook ${index + 1}`,
      box: boxes[index],
      textStyle: {
        fontFamily: style.fontFamily ?? 'Arial',
        fontSize: resolveFontSize(row.fontSize) ?? styleFontSize ?? defaultFontSize,
        fontWeight: row.fontWeight ?? style.fontWeight ?? 800,
        color: row.textColor ?? style.textColor ?? '#ffffff',
        textAlign: style.textAlign ?? 'center',
        verticalAlign: 'middle',
        wrapMode: 'none',
      },
      backplate: {
        color: row.backgroundColor ?? style.backgroundColor ?? '#000000',
        opacity: row.backgroundOpacity ?? style.backgroundOpacity ?? 0.9,
        paddingX: paddingX ?? Math.max(12, compositionWidth * 0.0125),
        paddingY: resolvedPaddingY,
        cornerRadius: cornerRadius ?? Math.max(8, compositionHeight * 0.011),
      },
    })),
  }, store);
  if (!result.success || !isRecord(result.data) || !Array.isArray(result.data.rows)) return result;
  const createdRows = result.data.rows as Array<{ backplateClipId: string; textClipId: string }>;
  tagCreatedHookRows(request.hookId, createdRows, rows);
  const motionResult = request.motion
    ? await authorEditableHookMotion({
        clipIds: createdRows.flatMap((row) => [row.backplateClipId, row.textClipId]),
        compositionHeight,
        compositionWidth,
        duration: request.duration ?? 4,
        motion: request.motion,
        store: useTimelineStore.getState(),
      })
    : undefined;
  if (motionResult && !motionResult.success) return motionResult;
  const compositionName = `${request.preset === 'lower-third' ? 'Lower Third' : 'Hook'} — ${rows[0]!.text}`;
  const subcompositionResult = nestInSubcomposition
    ? await wrapEditableHookInSubcomposition({
        clipIds: createdRows.flatMap((row) => [row.backplateClipId, row.textClipId]),
        hookId: request.hookId,
        name: compositionName,
      })
    : undefined;
  if (subcompositionResult && !subcompositionResult.success) return subcompositionResult;
  return {
    success: true,
    data: {
      action: 'created',
      hookId: request.hookId,
      preset: request.preset ?? 'stacked-center',
      startTime: request.startTime ?? store.playheadPosition,
      duration: request.duration ?? 4,
      rows: createdRows,
      ...(motionResult === undefined ? {} : { motion: motionResult.data }),
      ...(subcompositionResult === undefined ? {} : { subcomposition: subcompositionResult.data }),
      stateRevisionAfter: getTimelineRevision(),
      detail: nestInSubcomposition
        ? 'The parent timeline contains one nested composition; its editable text, Motion backplates, and keyframes share this hookId.'
        : 'Editable text and native Motion backplates share this hookId for later updates.',
    },
  };
}

function currentTextBox(clip: TimelineClip): { height: number; width: number; x: number; y: number } {
  const props = clip.textProperties!;
  const composition = useMediaStore.getState().getActiveComposition();
  return {
    x: props.boxX ?? 0,
    y: props.boxY ?? 0,
    width: props.boxWidth ?? composition?.width ?? 1920,
    height: props.boxHeight ?? composition?.height ?? 1080,
  };
}

function currentPlatePadding(row: ExistingHookRow): { x: number; y: number } {
  const box = currentTextBox(row.textClip);
  const size = row.backplateClip.motion?.shape?.size;
  return {
    x: Math.max(0, ((size?.w ?? box.width) - box.width) / 2),
    y: Math.max(0, ((size?.h ?? box.height) - box.height) / 2),
  };
}

function validateTimingUpdate(
  rows: ExistingHookRow[],
  startTime: number,
  duration: number,
  store: TimelineStore,
): Error | null {
  const hookClipIds = new Set(rows.flatMap((row) => [row.textClip.id, row.backplateClip.id]));
  const endTime = startTime + duration;
  for (const row of rows) {
    for (const clip of [row.textClip, row.backplateClip]) {
      const track = store.tracks.find((candidate) => candidate.id === clip.trackId);
      if (track?.locked) return new Error(`Hook track is locked: ${track.id}`);
      const collision = store.clips.find((candidate) => (
        candidate.trackId === clip.trackId
        && !hookClipIds.has(candidate.id)
        && candidate.startTime < endTime
        && candidate.startTime + candidate.duration > startTime
      ));
      if (collision) return new Error(`Hook timing would overlap clip ${collision.id}`);
    }
  }
  return null;
}

async function updateExistingRows(
  request: EditableHookRequest,
  rows: ExistingHookRow[],
): Promise<ToolResult> {
  const store = useTimelineStore.getState();
  const composition = useMediaStore.getState().getActiveComposition();
  const compositionWidth = composition?.width ?? 1920;
  const compositionHeight = composition?.height ?? 1080;
  const nextStartTime = request.startTime ?? rows[0]!.textClip.startTime;
  const nextDuration = request.duration ?? rows[0]!.textClip.duration;
  const timingError = validateTimingUpdate(rows, nextStartTime, nextDuration, store);
  if (timingError) return failure(timingError.message);

  const style = request.style ?? {};
  const layoutChanged = request.preset !== undefined || request.placement !== undefined;
  const resolvedPaddingY = rows.map((row) => (
    resolvePixelMeasure(style.paddingY) ?? currentPlatePadding(row).y
  ));
  const boxes = layoutChanged
    ? boxesForRows(
        resolvePlacement(
          request.preset,
          request.placement,
          compositionWidth,
          compositionHeight,
        ),
        rows.length,
        compositionWidth,
        compositionHeight,
        resolvedPaddingY,
      )
    : style.paddingY !== undefined
      ? reflowCurrentBoxesForPadding(rows, resolvedPaddingY, compositionHeight)
    : rows.map((row) => currentTextBox(row.textClip));
  if (boxes instanceof Error) return failure(boxes.message);
  const geometryChanged = layoutChanged || style.paddingY !== undefined;

  for (const row of rows) {
    const rowPatch = request.rows?.[row.index];
    const textUpdates: Record<string, unknown> = {
      clipId: row.textClip.id,
      textAlign: 'center',
      verticalAlign: 'middle',
      wrapMode: 'none',
    };
    if (rowPatch?.text !== undefined) textUpdates.text = rowPatch.text;
    if (style.fontFamily !== undefined) textUpdates.fontFamily = style.fontFamily;
    if (rowPatch?.fontSize !== undefined || style.fontSize !== undefined) {
      textUpdates.fontSize = resolveFontSize(rowPatch?.fontSize ?? style.fontSize);
    }
    if (rowPatch?.fontWeight !== undefined || style.fontWeight !== undefined) {
      textUpdates.fontWeight = rowPatch?.fontWeight ?? style.fontWeight;
    }
    if (rowPatch?.textColor !== undefined || style.textColor !== undefined) {
      textUpdates.color = rowPatch?.textColor ?? style.textColor;
    }
    if (Object.keys(textUpdates).length > 1) {
      const textResult = await handleUpdateTextProperties(textUpdates, useTimelineStore.getState());
      if (!textResult.success) return textResult;
    }

    const box = boxes[row.index]!;
    if (geometryChanged) {
      const boxResult = await handleSetTextBox({
        clipId: row.textClip.id,
        enabled: true,
        ...box,
      }, useTimelineStore.getState());
      if (!boxResult.success) return boxResult;
    }

    const oldPadding = currentPlatePadding(row);
    const paddingX = resolvePixelMeasure(style.paddingX) ?? oldPadding.x;
    const paddingY = resolvePixelMeasure(style.paddingY) ?? oldPadding.y;
    if (
      geometryChanged
      || style.paddingX !== undefined
      || style.paddingY !== undefined
      || style.cornerRadius !== undefined
    ) {
      const shapeX = box.x + box.width / 2 - compositionWidth / 2;
      const shapeY = box.y + box.height / 2 - compositionHeight / 2;
      const updates = [
        { path: 'position.x', value: shapeX },
        { path: 'position.y', value: shapeY },
        { path: 'shape.size.w', value: box.width + paddingX * 2 },
        { path: 'shape.size.h', value: box.height + paddingY * 2 },
      ];
      if (style.cornerRadius !== undefined) {
        updates.push({
          path: 'shape.cornerRadius',
          value: resolvePixelMeasure(style.cornerRadius)!,
        });
      }
      const motionResult = await handleUpdateMotionProperties({
        clipId: row.backplateClip.id,
        updates,
      }, useTimelineStore.getState());
      if (!motionResult.success) return motionResult;
    }

    const backgroundColor = rowPatch?.backgroundColor ?? style.backgroundColor;
    const backgroundOpacity = rowPatch?.backgroundOpacity ?? style.backgroundOpacity;
    if (backgroundColor !== undefined || backgroundOpacity !== undefined) {
      const appearanceResult = await handleUpdateMotionAppearances({
        clipId: row.backplateClip.id,
        fill: {
          ...(backgroundColor === undefined ? {} : { color: backgroundColor }),
          ...(backgroundOpacity === undefined ? {} : { opacity: backgroundOpacity }),
        },
      }, useTimelineStore.getState());
      if (!appearanceResult.success) return appearanceResult;
    }
  }

  for (const row of rows) {
    const text = request.rows?.[row.index]?.text ?? row.textClip.textProperties?.text ?? 'Text';
    useTimelineStore.getState().updateClip(row.textClip.id, {
      startTime: nextStartTime,
      duration: nextDuration,
      outPoint: row.textClip.inPoint + nextDuration,
      name: `Hook ${row.index + 1}: ${text}`,
    });
    useTimelineStore.getState().updateClip(row.backplateClip.id, {
      startTime: nextStartTime,
      duration: nextDuration,
      outPoint: row.backplateClip.inPoint + nextDuration,
    });
  }

  return {
    success: true,
    data: {
      action: 'updated',
      hookId: request.hookId,
      startTime: nextStartTime,
      duration: nextDuration,
      rows: rows.map((row) => ({
        index: row.index,
        textClipId: row.textClip.id,
        backplateClipId: row.backplateClip.id,
      })),
      stateRevisionAfter: getTimelineRevision(),
    },
  };
}

async function replaceHookRows(
  request: EditableHookRequest,
  existingRows: ExistingHookRow[],
): Promise<ToolResult> {
  const originalIds = existingRows.flatMap((row) => [row.textClip.id, row.backplateClip.id]);
  const replacementId = `${request.hookId}-replacement`;
  const createResult = await createHook({
    ...request,
    action: 'create',
    hookId: replacementId,
    startTime: request.startTime ?? existingRows[0]!.textClip.startTime,
    duration: request.duration ?? existingRows[0]!.textClip.duration,
  }, useTimelineStore.getState(), false);
  if (!createResult.success) return createResult;

  const replacementClips = hookClips(useTimelineStore.getState(), replacementId);
  const deleteResult = useTimelineStore.getState().applyTimelineEditOperation({
    id: `replace-editable-hook:${request.hookId}`,
    type: 'delete-clips',
    clipIds: originalIds,
    includeLinked: false,
  }, {
    source: 'ai-tool',
    historyLabel: 'AI: replace editable hook rows',
  });
  if (!deleteResult.success) return failure('Could not replace the previous hook rows');
  for (const clip of replacementClips) {
    useTimelineStore.getState().updateClip(clip.id, {
      linkedGroupId: request.hookId,
      editableHook: clip.editableHook
        ? { ...clip.editableHook, id: request.hookId }
        : undefined,
    });
  }
  const finalRows = collectExistingRows(useTimelineStore.getState(), request.hookId);
  if (finalRows instanceof Error) return failure(finalRows.message);
  return {
    success: true,
    data: {
      action: 'replaced',
      hookId: request.hookId,
      rows: finalRows.map((row) => ({
        index: row.index,
        textClipId: row.textClip.id,
        backplateClipId: row.backplateClip.id,
      })),
      stateRevisionAfter: getTimelineRevision(),
    },
  };
}

async function updateHookInActiveComposition(request: EditableHookRequest): Promise<ToolResult> {
  const existingRows = collectExistingRows(useTimelineStore.getState(), request.hookId);
  if (existingRows instanceof Error) return failure(existingRows.message);
  persistHookRowIdentity(request.hookId, existingRows);
  if (request.rows !== undefined && request.rows.length !== existingRows.length) {
    return replaceHookRows(request, existingRows);
  }
  return updateExistingRows(request, existingRows);
}

export async function handleManageEditableHook(
  rawArgs: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const request = parseRequest(rawArgs);
  if (request instanceof Error) return failure(request.message);
  if (request.action === 'create') return createHook(request, timelineStore);

  const execution = await executeInEditableHookComposition(request.hookId, async (context) => {
    const nestedRequest = context.isNested && request.startTime !== undefined
      ? { ...request, startTime: 0 }
      : request;
    const result = await updateHookInActiveComposition(nestedRequest);
    if (result.success && context.isNested && request.duration !== undefined) {
      useTimelineStore.setState({ duration: request.duration, durationLocked: true });
    }
    return result;
  });
  if (!execution.result.success) return execution.result;
  const wrapperError = updateNestedHookWrapper(execution.context, request);
  if (wrapperError) return wrapperError;
  const data = isRecord(execution.result.data) ? execution.result.data : {};
  return {
    ...execution.result,
    data: {
      ...data,
      ...(execution.context?.isNested
        ? {
            startTime: request.startTime ?? execution.context.wrapperStartTime,
            duration: request.duration ?? execution.context.wrapperDuration,
            subcompositionId: execution.context.hookCompositionId,
            wrapperClipId: execution.context.wrapperClipId,
          }
        : {}),
      stateRevisionAfter: getTimelineRevision(),
    },
  };
}

async function refineEditableHookInActiveComposition(
  request: EditableHookRefinementRequest,
): Promise<ToolResult> {
  const rows = collectExistingRows(useTimelineStore.getState(), request.hookId);
  if (rows instanceof Error) return failure(rows.message);
  persistHookRowIdentity(request.hookId, rows);
  const composition = useMediaStore.getState().getActiveComposition();
  const compositionWidth = composition?.width ?? 1920;
  const compositionHeight = composition?.height ?? 1080;
  const targetedRows = new Set([
    ...(request.textEdits?.map((edit) => edit.rowIndex) ?? []),
    ...(request.backgroundEdits?.map((edit) => edit.rowIndex) ?? []),
  ]);
  for (const rowIndex of targetedRows) {
    const row = rows[rowIndex];
    if (!row) return failure(`Hook ${request.hookId} has no row ${rowIndex}`);
    for (const clip of [row.textClip, row.backplateClip]) {
      const track = useTimelineStore.getState().tracks.find((candidate) => candidate.id === clip.trackId);
      if (track?.locked) return failure(`Hook track is locked: ${track.id}`);
    }
  }
  for (const edit of request.textEdits ?? []) {
    if (edit.box?.width !== undefined && edit.box.width < 24) {
      return failure(`textEdits row ${edit.rowIndex} box width is below 24 pixels`);
    }
    if (edit.box?.height !== undefined && edit.box.height < 24) {
      return failure(`textEdits row ${edit.rowIndex} box height is below 24 pixels`);
    }
  }
  const pending: Array<{ label: string; run: () => Promise<ToolResult> }> = [];

  const textEditedRows = new Set(request.textEdits?.map((edit) => edit.rowIndex) ?? []);
  for (const rowIndex of targetedRows) {
    if (textEditedRows.has(rowIndex)) continue;
    const row = rows[rowIndex]!;
    pending.push({
      label: `text layout row ${rowIndex}`,
      run: () => handleUpdateTextProperties({
        clipId: row.textClip.id,
        textAlign: 'center',
        verticalAlign: 'middle',
        wrapMode: 'none',
      }, useTimelineStore.getState()),
    });
  }

  for (const edit of request.textEdits ?? []) {
    const row = rows[edit.rowIndex];
    if (!row) return failure(`Hook ${request.hookId} has no text row ${edit.rowIndex}`);
    const textArgs: Record<string, unknown> = {
      clipId: row.textClip.id,
      textAlign: 'center',
      verticalAlign: 'middle',
      wrapMode: 'none',
    };
    for (const key of [
      'text', 'fontFamily', 'fontStyle', 'fontWeight',
      'lineHeight', 'letterSpacing', 'strokeEnabled', 'strokeColor', 'strokeWidth',
      'shadowEnabled', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'shadowBlur',
    ] as const) {
      if (edit[key] !== undefined) textArgs[key] = edit[key];
    }
    if (edit.fontSize !== undefined) {
      textArgs.fontSize = resolveFontSize(edit.fontSize);
    }
    if (edit.textColor !== undefined) textArgs.color = edit.textColor;
    if (Object.keys(textArgs).length > 1) {
      pending.push({
        label: `text row ${edit.rowIndex}`,
        run: () => handleUpdateTextProperties(textArgs, useTimelineStore.getState()),
      });
    }
    const box = edit.box;
    if (box && Object.keys(box).length > 0) {
      pending.push({
        label: `text box row ${edit.rowIndex}`,
        run: () => handleSetTextBox({
          clipId: row.textClip.id,
          enabled: true,
          ...(box.x === undefined ? {} : { x: box.x }),
          ...(box.y === undefined ? {} : { y: box.y }),
          ...(box.width === undefined ? {} : { width: box.width }),
          ...(box.height === undefined ? {} : { height: box.height }),
        }, useTimelineStore.getState()),
      });
    }
  }

  for (const edit of request.backgroundEdits ?? []) {
    const row = rows[edit.rowIndex];
    if (!row) return failure(`Hook ${request.hookId} has no background row ${edit.rowIndex}`);
    const updates: Array<{ path: string; value: number }> = [];
    if (edit.centerX !== undefined) {
      updates.push({ path: 'position.x', value: edit.centerX - compositionWidth / 2 });
    }
    if (edit.centerY !== undefined) {
      updates.push({ path: 'position.y', value: edit.centerY - compositionHeight / 2 });
    }
    if (edit.width !== undefined) {
      updates.push({ path: 'shape.size.w', value: edit.width });
    }
    if (edit.height !== undefined) {
      updates.push({ path: 'shape.size.h', value: edit.height });
    }
    if (edit.cornerRadius !== undefined) {
      updates.push({
        path: 'shape.cornerRadius',
        value: resolvePixelMeasure(edit.cornerRadius)!,
      });
    }
    if (updates.length > 0) {
      pending.push({
        label: `background geometry row ${edit.rowIndex}`,
        run: () => handleUpdateMotionProperties({
          clipId: row.backplateClip.id,
          updates,
        }, useTimelineStore.getState()),
      });
    }
    const hasFill = edit.fillColor !== undefined || edit.fillOpacity !== undefined;
    const hasStroke = edit.strokeEnabled !== undefined
      || edit.strokeColor !== undefined
      || edit.strokeOpacity !== undefined
      || edit.strokeWidth !== undefined
      || edit.strokeAlignment !== undefined;
    if (hasFill || hasStroke) {
      pending.push({
        label: `background appearance row ${edit.rowIndex}`,
        run: () => handleUpdateMotionAppearances({
          clipId: row.backplateClip.id,
          ...(hasFill ? {
            fill: {
              ...(edit.fillColor === undefined ? {} : { color: edit.fillColor }),
              ...(edit.fillOpacity === undefined ? {} : { opacity: edit.fillOpacity }),
            },
          } : {}),
          ...(hasStroke ? {
            stroke: {
              ...(edit.strokeEnabled === undefined ? {} : { enabled: edit.strokeEnabled }),
              ...(edit.strokeColor === undefined ? {} : { color: edit.strokeColor }),
              ...(edit.strokeOpacity === undefined ? {} : { opacity: edit.strokeOpacity }),
              ...(edit.strokeWidth === undefined ? {} : { width: edit.strokeWidth }),
              ...(edit.strokeAlignment === undefined ? {} : { alignment: edit.strokeAlignment }),
            },
          } : {}),
        }, useTimelineStore.getState()),
      });
    }
  }

  for (const entry of pending) {
    const result = await entry.run();
    if (!result.success) {
      return failure(`${entry.label} failed: ${result.error ?? 'unknown error'}`);
    }
  }
  return {
    success: true,
    data: {
      action: 'refined',
      hookId: request.hookId,
      textRows: request.textEdits?.map((edit) => edit.rowIndex) ?? [],
      backgroundRows: request.backgroundEdits?.map((edit) => edit.rowIndex) ?? [],
      stateRevisionAfter: getTimelineRevision(),
    },
  };
}

export async function handleRefineEditableHook(
  rawArgs: Record<string, unknown>,
  _timelineStore: TimelineStore,
): Promise<ToolResult> {
  const request = parseRefinementRequest(rawArgs);
  if (request instanceof Error) return failure(request.message);
  const execution = await executeInEditableHookComposition(
    request.hookId,
    () => refineEditableHookInActiveComposition(request),
  );
  if (!execution.result.success || !execution.context?.isNested) return execution.result;
  const data = isRecord(execution.result.data) ? execution.result.data : {};
  return {
    ...execution.result,
    data: {
      ...data,
      subcompositionId: execution.context.hookCompositionId,
      wrapperClipId: execution.context.wrapperClipId,
      stateRevisionAfter: getTimelineRevision(),
    },
  };
}
