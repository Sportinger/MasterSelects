import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { googleFontsService, POPULAR_FONTS } from '../../../services/googleFontsService';
import { resolveEditableHookLayerMetadata } from '../../../services/aiTools/editableHookIdentity';
import { createTextBoundsFromRect, resolveTextBoxRect } from '../../../services/textLayout';
import { endBatch, startBatch } from '../../../stores/historyStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import {
  createColorFillAppearance,
  createStrokeAppearance,
  type ColorFillAppearance,
  type MotionColor,
  type MotionLayerDefinition,
  type StrokeAppearance,
} from '../../../types/motionDesign';
import { LabeledValue } from './transformTab/ValueControls';

export interface EditableHookEditorRow {
  backgroundClip: TimelineClip;
  index: number;
  textClip: TimelineClip;
}

export interface EditableHookLayoutValues {
  gap: number;
  paddingX: number;
  paddingY: number;
  rowHeight: number;
  width: number;
  x: number;
  y: number;
}

interface BackgroundPatch {
  color?: string;
  cornerRadius?: number;
  opacity?: number;
  strokeAlignment?: StrokeAppearance['alignment'];
  strokeColor?: string;
  strokeEnabled?: boolean;
  strokeOpacity?: number;
  strokeWidth?: number;
}

interface HookTabProps {
  hookId: string;
}

type StyleTarget = 'all' | number;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function channelToHex(value: number): string {
  return Math.round(clamp01(value) * 255).toString(16).padStart(2, '0');
}

function motionColorToHex(color: MotionColor | undefined, fallback: string): string {
  if (!color) return fallback;
  return `#${channelToHex(color.r)}${channelToHex(color.g)}${channelToHex(color.b)}`;
}

function hexToMotionColor(hex: string, alpha = 1): MotionColor {
  const normalized = hex.replace('#', '').padEnd(6, '0').slice(0, 6);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16) / 255,
    g: Number.parseInt(normalized.slice(2, 4), 16) / 255,
    b: Number.parseInt(normalized.slice(4, 6), 16) / 255,
    a: alpha,
  };
}

function getFill(clip: TimelineClip): ColorFillAppearance | undefined {
  return clip.motion?.appearance?.items.find(
    (item): item is ColorFillAppearance => item.kind === 'color-fill',
  );
}

function getStroke(clip: TimelineClip): StrokeAppearance | undefined {
  return clip.motion?.appearance?.items.find(
    (item): item is StrokeAppearance => item.kind === 'stroke',
  );
}

function collectEditableHookEditorRows(
  clips: readonly TimelineClip[],
  tracks: readonly Pick<TimelineTrack, 'id'>[],
  hookId: string,
): EditableHookEditorRow[] {
  const identities = resolveEditableHookLayerMetadata(clips, tracks);
  const rows = new Map<number, Partial<EditableHookEditorRow>>();

  for (const clip of clips) {
    const identity = identities.get(clip.id);
    if (identity?.id !== hookId) continue;
    const row = rows.get(identity.rowIndex) ?? { index: identity.rowIndex };
    if (identity.role === 'text' && clip.textProperties) row.textClip = clip;
    if (identity.role === 'background' && clip.motion?.shape?.primitive === 'rectangle') {
      row.backgroundClip = clip;
    }
    rows.set(identity.rowIndex, row);
  }

  return [...rows.values()]
    .filter((row): row is EditableHookEditorRow => (
      typeof row.index === 'number' && Boolean(row.textClip) && Boolean(row.backgroundClip)
    ))
    .sort((left, right) => left.index - right.index);
}

function rowTextBox(row: EditableHookEditorRow, width: number, height: number) {
  return resolveTextBoxRect(row.textClip.textProperties!, width, height);
}

function deriveEditableHookLayoutValues(
  rows: readonly EditableHookEditorRow[],
  compositionWidth: number,
  compositionHeight: number,
): EditableHookLayoutValues | null {
  const first = rows[0];
  if (!first) return null;
  const box = rowTextBox(first, compositionWidth, compositionHeight);
  const shape = first.backgroundClip.motion?.shape;
  const paddingX = Math.max(0, ((shape?.size.w ?? box.width) - box.width) / 2);
  const paddingY = Math.max(0, ((shape?.size.h ?? box.height) - box.height) / 2);
  const next = rows[1];
  const gap = next
    ? Math.max(0, (
        rowTextBox(next, compositionWidth, compositionHeight).y
        - Math.max(0, ((next.backgroundClip.motion?.shape?.size.h
          ?? rowTextBox(next, compositionWidth, compositionHeight).height)
          - rowTextBox(next, compositionWidth, compositionHeight).height) / 2)
        - (box.y + box.height + paddingY)
      ))
    : 0;

  return {
    x: box.x,
    y: box.y,
    width: box.width,
    rowHeight: box.height,
    gap,
    paddingX,
    paddingY,
  };
}

function patchBackgroundMotion(
  motion: MotionLayerDefinition,
  patch: BackgroundPatch,
): MotionLayerDefinition {
  const appearance = motion.appearance ?? { version: 1 as const, items: [] };
  const items = appearance.items.map((item) => structuredClone(item));

  if (patch.color !== undefined || patch.opacity !== undefined) {
    const fillIndex = items.findIndex((item) => item.kind === 'color-fill');
    const fill = fillIndex >= 0
      ? items[fillIndex] as ColorFillAppearance
      : createColorFillAppearance();
    const nextFill: ColorFillAppearance = {
      ...fill,
      color: patch.color === undefined
        ? fill.color
        : hexToMotionColor(patch.color, fill.color.a),
      opacity: patch.opacity ?? fill.opacity,
      visible: true,
    };
    if (fillIndex >= 0) items[fillIndex] = nextFill;
    else items.push(nextFill);
  }

  const hasStrokePatch = patch.strokeEnabled !== undefined
    || patch.strokeColor !== undefined
    || patch.strokeOpacity !== undefined
    || patch.strokeWidth !== undefined
    || patch.strokeAlignment !== undefined;
  if (hasStrokePatch) {
    const strokeIndex = items.findIndex((item) => item.kind === 'stroke');
    const stroke = strokeIndex >= 0
      ? items[strokeIndex] as StrokeAppearance
      : createStrokeAppearance();
    const nextStroke: StrokeAppearance = {
      ...stroke,
      visible: patch.strokeEnabled ?? stroke.visible,
      color: patch.strokeColor === undefined
        ? stroke.color
        : hexToMotionColor(patch.strokeColor, stroke.color.a),
      opacity: patch.strokeOpacity ?? stroke.opacity,
      width: patch.strokeWidth ?? stroke.width,
      alignment: patch.strokeAlignment ?? stroke.alignment,
    };
    if (strokeIndex >= 0) items[strokeIndex] = nextStroke;
    else items.push(nextStroke);
  }

  return {
    ...motion,
    shape: motion.shape && patch.cornerRadius !== undefined
      ? { ...motion.shape, cornerRadius: Math.max(0, patch.cornerRadius) }
      : motion.shape,
    appearance: {
      ...appearance,
      items,
      selectedItemId: appearance.selectedItemId ?? items[0]?.id,
    },
  };
}

function HookColorControl({
  disabled = false,
  label,
  value,
  onChange,
}: {
  disabled?: boolean;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [draftState, setDraftState] = useState({ source: value, value });
  const draft = draftState.source === value ? draftState.value : value;

  const commit = useCallback(() => {
    if (/^#[0-9a-fA-F]{6}$/.test(draft)) onChange(draft);
    else setDraftState({ source: value, value });
  }, [draft, onChange, value]);

  return (
    <div className="tt-color-row hook-color-row">
      <input
        aria-label={`${label} color`}
        className="tt-color-swatch"
        disabled={disabled}
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="tt-color-label">{label}</span>
      <input
        aria-label={`${label} hex`}
        className="tt-color-hex"
        disabled={disabled}
        type="text"
        value={draft}
        onBlur={commit}
        onChange={(event) => setDraftState({ source: value, value: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') setDraftState({ source: value, value });
        }}
      />
    </div>
  );
}

function HookRowTextInput({
  disabled = false,
  index,
  value,
  onCommit,
}: {
  disabled?: boolean;
  index: number;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draftState, setDraftState] = useState({ source: value, value });
  const draft = draftState.source === value ? draftState.value : value;

  return (
    <label className="hook-row-text">
      <span>Row {index + 1}</span>
      <input
        aria-label={`Hook row ${index + 1} text`}
        disabled={disabled}
        type="text"
        value={draft}
        onBlur={() => {
          if (draft !== value) onCommit(draft);
        }}
        onChange={(event) => setDraftState({
          source: value,
          value: event.target.value.replace(/[\r\n]+/g, ' '),
        })}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') setDraftState({ source: value, value });
        }}
      />
    </label>
  );
}

export function HookTab({ hookId }: HookTabProps) {
  const clips = useTimelineStore((state) => state.clips);
  const tracks = useTimelineStore((state) => state.tracks);
  const activeComposition = useMediaStore((state) => (
    state.compositions.find((composition) => composition.id === state.activeCompositionId)
  ));
  const compositionWidth = activeComposition?.width ?? 1920;
  const compositionHeight = activeComposition?.height ?? 1080;
  const rows = useMemo(
    () => collectEditableHookEditorRows(clips, tracks, hookId),
    [clips, hookId, tracks],
  );
  const layout = useMemo(
    () => deriveEditableHookLayoutValues(rows, compositionWidth, compositionHeight),
    [compositionHeight, compositionWidth, rows],
  );
  const [styleTarget, setStyleTarget] = useState<StyleTarget>('all');
  const dragBatchOpened = useRef(false);

  useEffect(() => {
    if (styleTarget !== 'all' && !rows.some((row) => row.index === styleTarget)) {
      setStyleTarget('all');
    }
  }, [rows, styleTarget]);

  const targetRows = styleTarget === 'all'
    ? rows
    : rows.filter((row) => row.index === styleTarget);
  const lockedTrackIds = new Set(tracks.filter((track) => track.locked).map((track) => track.id));
  const targetLocked = targetRows.some((row) => (
    lockedTrackIds.has(row.textClip.trackId) || lockedTrackIds.has(row.backgroundClip.trackId)
  ));
  const layoutLocked = rows.some((row) => (
    lockedTrackIds.has(row.textClip.trackId) || lockedTrackIds.has(row.backgroundClip.trackId)
  ));
  const styleRow = targetRows[0] ?? rows[0];
  const text = styleRow?.textClip.textProperties;
  const fill = styleRow ? getFill(styleRow.backgroundClip) : undefined;
  const stroke = styleRow ? getStroke(styleRow.backgroundClip) : undefined;
  const availableWeights = text
    ? googleFontsService.getAvailableWeights?.(text.fontFamily) ?? [400, 700]
    : [400, 700];
  const fontOptions = POPULAR_FONTS ?? [{ family: 'Arial' }];

  const beginDrag = useCallback(() => {
    dragBatchOpened.current = startBatch('Adjust editable hook').opened;
  }, []);
  const finishDrag = useCallback(() => {
    if (dragBatchOpened.current) endBatch();
    dragBatchOpened.current = false;
  }, []);
  const runDiscrete = useCallback((label: string, update: () => void) => {
    const batch = startBatch(label);
    try {
      update();
    } finally {
      if (batch.opened) endBatch();
    }
  }, []);

  const updateTargetText = useCallback((patch: Record<string, unknown>) => {
    if (targetLocked) return;
    const store = useTimelineStore.getState();
    for (const row of targetRows) {
      store.updateTextProperties(row.textClip.id, {
        ...patch,
        textAlign: 'center',
        verticalAlign: 'middle',
        wrapMode: 'none',
      });
    }
  }, [targetLocked, targetRows]);

  const updateTargetBackground = useCallback((patch: BackgroundPatch) => {
    if (targetLocked) return;
    const store = useTimelineStore.getState();
    for (const row of targetRows) {
      store.updateMotionLayer(
        row.backgroundClip.id,
        (motion) => patchBackgroundMotion(motion, patch),
      );
    }
  }, [targetLocked, targetRows]);

  const updateLayout = useCallback((patch: Partial<EditableHookLayoutValues>) => {
    if (!layout || layoutLocked) return;
    const next = { ...layout, ...patch };
    const store = useTimelineStore.getState();
    let nextY = next.y;

    for (const row of rows) {
      const box = {
        x: next.x,
        y: nextY,
        width: Math.max(24, next.width),
        height: Math.max(24, next.rowHeight),
      };
      store.updateTextProperties(row.textClip.id, {
        boxEnabled: true,
        boxX: Math.round(box.x),
        boxY: Math.round(box.y),
        boxWidth: Math.round(box.width),
        boxHeight: Math.round(box.height),
        textBounds: createTextBoundsFromRect(box, compositionWidth, compositionHeight, undefined, {
          clampToCanvas: false,
        }),
        textAlign: 'center',
        verticalAlign: 'middle',
        wrapMode: 'none',
      });
      store.updateClipTransform(row.backgroundClip.id, {
        position: {
          x: box.x + box.width / 2 - compositionWidth / 2,
          y: box.y + box.height / 2 - compositionHeight / 2,
          z: row.backgroundClip.transform.position.z,
        },
      });
      store.updateMotionLayer(row.backgroundClip.id, (motion) => ({
        ...motion,
        shape: motion.shape
          ? {
              ...motion.shape,
              size: {
                w: box.width + Math.max(0, next.paddingX) * 2,
                h: box.height + Math.max(0, next.paddingY) * 2,
              },
            }
          : motion.shape,
      }));
      nextY += box.height + Math.max(0, next.paddingY) * 2 + Math.max(0, next.gap);
    }
  }, [compositionHeight, compositionWidth, layout, layoutLocked, rows]);

  if (!styleRow || !text || !layout) {
    return (
      <div className="properties-tab-content">
        <div className="panel-empty"><p>This hook is incomplete or no longer editable.</p></div>
      </div>
    );
  }

  const backgroundColor = motionColorToHex(fill?.color, '#000000');
  const strokeColor = motionColorToHex(stroke?.color, '#000000');

  return (
    <div className="properties-tab-content hook-tab">
      <div className="tt-section">
        <div className="tt-section-header">Hook</div>
        <div className="hook-id" title={hookId}>{hookId}</div>
        <div className="hook-row-list">
          {rows.map((row) => (
            <HookRowTextInput
              key={row.textClip.id}
              disabled={lockedTrackIds.has(row.textClip.trackId)}
              index={row.index}
              value={row.textClip.textProperties?.text ?? ''}
              onCommit={(value) => runDiscrete('Edit hook text', () => {
                useTimelineStore.getState().updateTextProperties(row.textClip.id, {
                  text: value,
                  textAlign: 'center',
                  verticalAlign: 'middle',
                  wrapMode: 'none',
                });
              })}
            />
          ))}
        </div>
      </div>

      <div className="tt-section">
        <div className="tt-section-header">Style Target</div>
        <select
          aria-label="Hook style target"
          className="tt-select-full"
          value={styleTarget}
          onChange={(event) => setStyleTarget(
            event.target.value === 'all' ? 'all' : Number(event.target.value),
          )}
        >
          <option value="all">All rows</option>
          {rows.map((row) => <option key={row.index} value={row.index}>Row {row.index + 1}</option>)}
        </select>
        <div className="properties-hint">Shared changes affect every row. Select one row for a different style.</div>
      </div>

      <div className="tt-section">
        <div className="tt-section-header">Text</div>
        <select
          aria-label="Hook font family"
          className="tt-select-full"
          disabled={targetLocked}
          value={text.fontFamily}
          onChange={(event) => runDiscrete('Change hook font', () => updateTargetText({
            fontFamily: event.target.value,
          }))}
        >
          {fontOptions.map((font) => <option key={font.family} value={font.family}>{font.family}</option>)}
        </select>
        <select
          aria-label="Hook font weight"
          className="tt-select-full"
          disabled={targetLocked}
          value={text.fontWeight}
          onChange={(event) => runDiscrete('Change hook font weight', () => updateTargetText({
            fontWeight: Number(event.target.value),
          }))}
        >
          {availableWeights.map((weight) => <option key={weight} value={weight}>{weight}</option>)}
        </select>
        <div className="tt-row-2col">
          <LabeledValue label="Size" value={text.fontSize} onChange={(value) => runDiscrete('Change hook font size', () => updateTargetText({ fontSize: value }))} min={8} max={500} decimals={0} suffix="px" defaultValue={64} ariaLabel="Hook font size" disabled={targetLocked} onDragStart={beginDrag} onDragEnd={finishDrag} />
          <LabeledValue label="Line" value={text.lineHeight} onChange={(value) => runDiscrete('Change hook line height', () => updateTargetText({ lineHeight: value }))} min={0.5} max={3} decimals={1} defaultValue={1.12} ariaLabel="Hook line height" disabled={targetLocked} onDragStart={beginDrag} onDragEnd={finishDrag} />
        </div>
        <div className="tt-row-2col">
          <LabeledValue label="Track" value={text.letterSpacing} onChange={(value) => runDiscrete('Change hook letter spacing', () => updateTargetText({ letterSpacing: value }))} min={-10} max={50} decimals={0} suffix="px" defaultValue={0} ariaLabel="Hook letter spacing" disabled={targetLocked} onDragStart={beginDrag} onDragEnd={finishDrag} />
          <span aria-hidden="true" />
        </div>
        <HookColorControl
          disabled={targetLocked}
          label="Text"
          value={text.color}
          onChange={(value) => runDiscrete('Change hook text color', () => updateTargetText({ color: value }))}
        />
      </div>

      <div className="tt-section">
        <div className="tt-section-header">Background</div>
        <HookColorControl
          disabled={targetLocked}
          label="Fill"
          value={backgroundColor}
          onChange={(value) => runDiscrete('Change hook background', () => updateTargetBackground({ color: value }))}
        />
        <div className="tt-row-2col">
          <LabeledValue label="Opacity" value={(fill?.opacity ?? 1) * 100} onChange={(value) => runDiscrete('Change hook background opacity', () => updateTargetBackground({ opacity: clamp01(value / 100) }))} min={0} max={100} decimals={0} suffix="%" defaultValue={90} ariaLabel="Hook background opacity" disabled={targetLocked} onDragStart={beginDrag} onDragEnd={finishDrag} />
          <LabeledValue label="Radius" value={styleRow.backgroundClip.motion?.shape?.cornerRadius ?? 0} onChange={(value) => runDiscrete('Change hook corner radius', () => updateTargetBackground({ cornerRadius: value }))} min={0} max={10000} decimals={0} suffix="px" defaultValue={0} ariaLabel="Hook corner radius" disabled={targetLocked} onDragStart={beginDrag} onDragEnd={finishDrag} />
        </div>
        <label className="hook-toggle-row">
          <input
            type="checkbox"
            disabled={targetLocked}
            checked={stroke?.visible ?? false}
            onChange={(event) => runDiscrete('Toggle hook background stroke', () => updateTargetBackground({
              strokeEnabled: event.target.checked,
            }))}
          />
          <span>Stroke</span>
        </label>
        {(stroke?.visible ?? false) && (
          <>
            <HookColorControl
              disabled={targetLocked}
              label="Stroke"
              value={strokeColor}
              onChange={(value) => runDiscrete('Change hook background stroke', () => updateTargetBackground({ strokeColor: value }))}
            />
            <div className="tt-row-2col">
              <LabeledValue label="Width" value={stroke?.width ?? 4} onChange={(value) => runDiscrete('Change hook background stroke width', () => updateTargetBackground({ strokeWidth: value }))} min={0} max={10000} decimals={1} suffix="px" defaultValue={4} ariaLabel="Hook background stroke width" disabled={targetLocked} onDragStart={beginDrag} onDragEnd={finishDrag} />
              <LabeledValue label="Opacity" value={(stroke?.opacity ?? 1) * 100} onChange={(value) => runDiscrete('Change hook background stroke opacity', () => updateTargetBackground({ strokeOpacity: clamp01(value / 100) }))} min={0} max={100} decimals={0} suffix="%" defaultValue={100} ariaLabel="Hook background stroke opacity" disabled={targetLocked} onDragStart={beginDrag} onDragEnd={finishDrag} />
            </div>
            <select
              aria-label="Hook background stroke alignment"
              className="tt-select-full"
              disabled={targetLocked}
              value={stroke?.alignment ?? 'center'}
              onChange={(event) => runDiscrete('Align hook background stroke', () => updateTargetBackground({
                strokeAlignment: event.target.value as StrokeAppearance['alignment'],
              }))}
            >
              <option value="inside">Inside</option>
              <option value="center">Center</option>
              <option value="outside">Outside</option>
            </select>
          </>
        )}
      </div>

      <div className="tt-section">
        <div className="tt-section-header">Layout</div>
        <div className="tt-row-2col">
          <LabeledValue label="X" value={layout.x} onChange={(value) => runDiscrete('Move hook', () => updateLayout({ x: value }))} min={-100000} max={100000} decimals={0} suffix="px" ariaLabel="Hook X" disabled={layoutLocked} onDragStart={beginDrag} onDragEnd={finishDrag} />
          <LabeledValue label="Y" value={layout.y} onChange={(value) => runDiscrete('Move hook', () => updateLayout({ y: value }))} min={-100000} max={100000} decimals={0} suffix="px" ariaLabel="Hook Y" disabled={layoutLocked} onDragStart={beginDrag} onDragEnd={finishDrag} />
        </div>
        <div className="tt-row-2col">
          <LabeledValue label="W" value={layout.width} onChange={(value) => runDiscrete('Resize hook', () => updateLayout({ width: value }))} min={24} max={100000} decimals={0} suffix="px" ariaLabel="Hook width" disabled={layoutLocked} onDragStart={beginDrag} onDragEnd={finishDrag} />
          <LabeledValue label="H" value={layout.rowHeight} onChange={(value) => runDiscrete('Resize hook', () => updateLayout({ rowHeight: value }))} min={24} max={100000} decimals={0} suffix="px" ariaLabel="Hook row height" disabled={layoutLocked} onDragStart={beginDrag} onDragEnd={finishDrag} />
        </div>
        <div className="tt-row-2col">
          <LabeledValue label="Gap" value={layout.gap} onChange={(value) => runDiscrete('Change hook gap', () => updateLayout({ gap: value }))} min={0} max={100000} decimals={0} suffix="px" defaultValue={0} ariaLabel="Hook gap" disabled={layoutLocked} onDragStart={beginDrag} onDragEnd={finishDrag} />
          <span aria-hidden="true" />
        </div>
        <div className="tt-row-2col">
          <LabeledValue label="Pad X" value={layout.paddingX} onChange={(value) => runDiscrete('Change hook padding', () => updateLayout({ paddingX: value }))} min={0} max={10000} decimals={0} suffix="px" ariaLabel="Hook horizontal padding" disabled={layoutLocked} onDragStart={beginDrag} onDragEnd={finishDrag} />
          <LabeledValue label="Pad Y" value={layout.paddingY} onChange={(value) => runDiscrete('Change hook padding', () => updateLayout({ paddingY: value }))} min={0} max={10000} decimals={0} suffix="px" ariaLabel="Hook vertical padding" disabled={layoutLocked} onDragStart={beginDrag} onDragEnd={finishDrag} />
        </div>
      </div>
    </div>
  );
}
