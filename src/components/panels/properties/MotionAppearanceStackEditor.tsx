import { useCallback } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import type { AnimatableProperty } from '../../../types/animationProperties';
import {
  MOTION_APPEARANCE_BLEND_MODES,
  createColorFillAppearance,
  createLinearGradientAppearance,
  createMotionAppearanceId,
  createRadialGradientAppearance,
  createStrokeAppearance,
  type AppearanceItem,
  type GradientStop,
  type MotionColor,
} from '../../../types/motionDesign';
import {
  MOTION_MAX_APPEARANCES,
  MOTION_MAX_GRADIENT_STOPS,
} from '../../../engine/motion/MotionBuffers';
import { DraggableNumber, KeyframeToggle } from './shared';

interface MotionAppearanceStackEditorProps {
  clipId: string;
}

type AddableAppearanceKind =
  | 'color-fill'
  | 'stroke'
  | 'linear-gradient'
  | 'radial-gradient';

const EMPTY_APPEARANCE_ITEMS: AppearanceItem[] = [];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function componentToHex(value: number): string {
  return Math.round(clamp01(value) * 255).toString(16).padStart(2, '0');
}

function colorToHex(color: MotionColor): string {
  return `#${componentToHex(color.r)}${componentToHex(color.g)}${componentToHex(color.b)}`;
}

function hexToColor(hex: string, alpha: number): MotionColor {
  const normalized = hex.replace('#', '').padEnd(6, '0').slice(0, 6);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16) / 255,
    g: Number.parseInt(normalized.slice(2, 4), 16) / 255,
    b: Number.parseInt(normalized.slice(4, 6), 16) / 255,
    a: alpha,
  };
}

function createAppearance(kind: AddableAppearanceKind): AppearanceItem {
  if (kind === 'stroke') return { ...createStrokeAppearance(), visible: true };
  if (kind === 'linear-gradient') return createLinearGradientAppearance();
  if (kind === 'radial-gradient') return createRadialGradientAppearance();
  return createColorFillAppearance();
}

function duplicateAppearance(item: AppearanceItem): AppearanceItem {
  const duplicate = structuredClone(item);
  duplicate.id = createMotionAppearanceId(item.kind);
  duplicate.name = `${item.name} Copy`;
  if (duplicate.kind === 'linear-gradient' || duplicate.kind === 'radial-gradient') {
    duplicate.stops = duplicate.stops.map((stop) => ({
      ...stop,
      id: createMotionAppearanceId('stop'),
    }));
  }
  return duplicate;
}

function AppearanceNumber({
  clipId,
  label,
  path,
  value,
  min,
  max,
  suffix,
}: {
  clipId: string;
  label: string;
  path: AnimatableProperty;
  value: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  const setPropertyValue = useTimelineStore((state) => state.setPropertyValue);
  return (
    <div className="labeled-value with-keyframe-toggle">
      <KeyframeToggle clipId={clipId} property={path} value={value} />
      <span className="labeled-value-label">{label}</span>
      <DraggableNumber
        value={value}
        onChange={(nextValue) => setPropertyValue(clipId, path, nextValue)}
        min={min}
        max={max}
        suffix={suffix}
        defaultValue={value}
      />
    </div>
  );
}

export function MotionAppearanceStackEditor({
  clipId,
}: MotionAppearanceStackEditorProps) {
  const clip = useTimelineStore((state) => (
    state.clips.find((candidate) => candidate.id === clipId)
  ));
  const updateMotionLayer = useTimelineStore((state) => state.updateMotionLayer);
  const setPropertyValue = useTimelineStore((state) => state.setPropertyValue);
  const appearance = clip?.motion?.appearance;
  const items = appearance?.items ?? EMPTY_APPEARANCE_ITEMS;
  const selectedId = appearance?.selectedItemId ?? items[items.length - 1]?.id;
  const selected = items.find((item) => item.id === selectedId) ?? items[items.length - 1];

  const replaceItems = useCallback((
    updater: (currentItems: AppearanceItem[]) => AppearanceItem[],
    nextSelectedId?: string | null,
  ) => {
    updateMotionLayer(clipId, (motion) => {
      const current = motion.appearance ?? { version: 1 as const, items: [] };
      const nextItems = updater(current.items.map((item) => structuredClone(item)));
      return {
        ...motion,
        appearance: {
          ...current,
          items: nextItems,
          selectedItemId: nextSelectedId === null
            ? undefined
            : nextSelectedId
              ?? current.selectedItemId
              ?? nextItems[nextItems.length - 1]?.id,
        },
      };
    });
  }, [clipId, updateMotionLayer]);

  const selectItem = useCallback((itemId: string) => {
    updateMotionLayer(clipId, (motion) => motion.appearance
      ? {
          ...motion,
          appearance: { ...motion.appearance, selectedItemId: itemId },
        }
      : motion);
  }, [clipId, updateMotionLayer]);

  const addItem = useCallback((kind: AddableAppearanceKind) => {
    if (items.length >= MOTION_MAX_APPEARANCES) return;
    const item = createAppearance(kind);
    replaceItems((current) => [...current, item], item.id);
  }, [items.length, replaceItems]);

  const updateItem = useCallback((
    itemId: string,
    updater: (item: AppearanceItem) => AppearanceItem,
  ) => {
    replaceItems(
      (current) => current.map((item) => (
        item.id === itemId ? updater(item) : item
      )),
      itemId,
    );
  }, [replaceItems]);

  const moveItem = useCallback((itemId: string, delta: number) => {
    replaceItems((current) => {
      const index = current.findIndex((item) => item.id === itemId);
      const target = Math.max(0, Math.min(current.length - 1, index + delta));
      if (index < 0 || target === index) return current;
      const [moved] = current.splice(index, 1);
      current.splice(target, 0, moved);
      return current;
    }, itemId);
  }, [replaceItems]);

  const removeItem = useCallback((itemId: string) => {
    const remaining = items.filter((item) => item.id !== itemId);
    replaceItems(
      () => remaining,
      remaining[Math.max(0, remaining.length - 1)]?.id ?? null,
    );
  }, [items, replaceItems]);

  const duplicateItem = useCallback((item: AppearanceItem) => {
    if (items.length >= MOTION_MAX_APPEARANCES) return;
    const duplicate = duplicateAppearance(item);
    replaceItems((current) => {
      const index = current.findIndex((candidate) => candidate.id === item.id);
      current.splice(index + 1, 0, duplicate);
      return current;
    }, duplicate.id);
  }, [items.length, replaceItems]);

  const updateSolidColor = useCallback((item: AppearanceItem, hex: string) => {
    if (item.kind !== 'color-fill' && item.kind !== 'stroke') return;
    const color = hexToColor(hex, item.color.a);
    (['r', 'g', 'b'] as const).forEach((channel) => {
      setPropertyValue(
        clipId,
        `appearance.${item.id}.color.${channel}` as AnimatableProperty,
        color[channel],
      );
    });
  }, [clipId, setPropertyValue]);

  const updateStopColor = useCallback((
    itemId: string,
    stop: GradientStop,
    hex: string,
  ) => {
    const color = hexToColor(hex, stop.color.a);
    (['r', 'g', 'b'] as const).forEach((channel) => {
      setPropertyValue(
        clipId,
        `appearance.${itemId}.gradient.stop.${stop.id}.color.${channel}` as AnimatableProperty,
        color[channel],
      );
    });
  }, [clipId, setPropertyValue]);

  const addGradientStop = useCallback((item: AppearanceItem) => {
    if (
      (item.kind !== 'linear-gradient' && item.kind !== 'radial-gradient')
      || item.stops.length >= MOTION_MAX_GRADIENT_STOPS
    ) {
      return;
    }
    const sorted = [...item.stops].sort((left, right) => left.offset - right.offset);
    const left = sorted[Math.max(0, Math.floor((sorted.length - 1) / 2))];
    const right = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length / 2))];
    const stop: GradientStop = {
      id: createMotionAppearanceId('stop'),
      offset: (left.offset + right.offset) * 0.5,
      color: {
        r: (left.color.r + right.color.r) * 0.5,
        g: (left.color.g + right.color.g) * 0.5,
        b: (left.color.b + right.color.b) * 0.5,
        a: (left.color.a + right.color.a) * 0.5,
      },
    };
    updateItem(item.id, (current) => (
      current.kind === 'linear-gradient' || current.kind === 'radial-gradient'
        ? {
            ...current,
            stops: [...current.stops, stop].sort(
              (first, second) => first.offset - second.offset,
            ),
          }
        : current
    ));
  }, [updateItem]);

  const removeGradientStop = useCallback((
    item: AppearanceItem,
    stopId: string,
  ) => {
    if (
      (item.kind !== 'linear-gradient' && item.kind !== 'radial-gradient')
      || item.stops.length <= 2
    ) {
      return;
    }
    updateItem(item.id, (current) => (
      current.kind === 'linear-gradient' || current.kind === 'radial-gradient'
        ? {
            ...current,
            stops: current.stops.filter((stop) => stop.id !== stopId),
          }
        : current
    ));
  }, [updateItem]);

  if (!appearance) return null;

  return (
    <div className="properties-section">
      <div className="control-row">
        <label className="prop-label">Appearances</label>
        <select
          aria-label="Add appearance"
          value=""
          disabled={items.length >= MOTION_MAX_APPEARANCES}
          onChange={(event) => {
            if (event.target.value) {
              addItem(event.target.value as AddableAppearanceKind);
            }
          }}
        >
          <option value="">Add…</option>
          <option value="color-fill">Color Fill</option>
          <option value="stroke">Stroke</option>
          <option value="linear-gradient">Linear Gradient</option>
          <option value="radial-gradient">Radial Gradient</option>
        </select>
      </div>

      {items.map((item, index) => (
        <div className="control-row" key={item.id}>
          <input
            aria-label={`Show ${item.name}`}
            type="checkbox"
            checked={item.visible}
            onChange={(event) => updateItem(
              item.id,
              (current) => ({ ...current, visible: event.target.checked }),
            )}
          />
          <button type="button" onClick={() => selectItem(item.id)}>
            {selected?.id === item.id ? '● ' : ''}{item.name}
          </button>
          <button
            type="button"
            aria-label={`Move ${item.name} down`}
            disabled={index === 0}
            onClick={() => moveItem(item.id, -1)}
          >
            ↓
          </button>
          <button
            type="button"
            aria-label={`Move ${item.name} up`}
            disabled={index === items.length - 1}
            onClick={() => moveItem(item.id, 1)}
          >
            ↑
          </button>
          <button type="button" onClick={() => duplicateItem(item)}>Duplicate</button>
          <button type="button" onClick={() => removeItem(item.id)}>Remove</button>
        </div>
      ))}

      {selected && (
        <>
          <div className="control-row">
            <label className="prop-label">Blend</label>
            <select
              value={selected.blendMode ?? 'normal'}
              onChange={(event) => updateItem(
                selected.id,
                (item) => ({
                  ...item,
                  blendMode: event.target.value as AppearanceItem['blendMode'],
                }),
              )}
            >
              {MOTION_APPEARANCE_BLEND_MODES.map((mode) => (
                <option value={mode} key={mode}>{mode}</option>
              ))}
            </select>
          </div>

          <AppearanceNumber
            clipId={clipId}
            label="Opacity"
            path={`appearance.${selected.id}.opacity` as AnimatableProperty}
            value={selected.opacity}
            min={0}
            max={1}
          />

          {(selected.kind === 'color-fill' || selected.kind === 'stroke') && (
            <div className="control-row">
              <label className="prop-label">Color</label>
              <input
                type="color"
                value={colorToHex(selected.color)}
                onChange={(event) => updateSolidColor(selected, event.target.value)}
              />
            </div>
          )}

          {selected.kind === 'stroke' && (
            <>
              <AppearanceNumber
                clipId={clipId}
                label="Width"
                path={`appearance.${selected.id}.stroke.width` as AnimatableProperty}
                value={selected.width}
                min={0}
                suffix="px"
              />
              <div className="control-row">
                <label className="prop-label">Alignment</label>
                <select
                  value={selected.alignment}
                  onChange={(event) => updateItem(
                    selected.id,
                    (item) => item.kind === 'stroke'
                      ? {
                          ...item,
                          alignment: event.target.value as typeof item.alignment,
                        }
                      : item,
                  )}
                >
                  <option value="center">Center</option>
                  <option value="inside">Inside</option>
                  <option value="outside">Outside</option>
                </select>
              </div>
            </>
          )}

          {selected.kind === 'linear-gradient' && (
            <>
              <AppearanceNumber
                clipId={clipId}
                label="Start X"
                path={`appearance.${selected.id}.gradient.start.x` as AnimatableProperty}
                value={selected.start.x}
              />
              <AppearanceNumber
                clipId={clipId}
                label="Start Y"
                path={`appearance.${selected.id}.gradient.start.y` as AnimatableProperty}
                value={selected.start.y}
              />
              <AppearanceNumber
                clipId={clipId}
                label="End X"
                path={`appearance.${selected.id}.gradient.end.x` as AnimatableProperty}
                value={selected.end.x}
              />
              <AppearanceNumber
                clipId={clipId}
                label="End Y"
                path={`appearance.${selected.id}.gradient.end.y` as AnimatableProperty}
                value={selected.end.y}
              />
            </>
          )}

          {selected.kind === 'radial-gradient' && (
            <>
              <AppearanceNumber
                clipId={clipId}
                label="Center X"
                path={`appearance.${selected.id}.gradient.center.x` as AnimatableProperty}
                value={selected.center.x}
              />
              <AppearanceNumber
                clipId={clipId}
                label="Center Y"
                path={`appearance.${selected.id}.gradient.center.y` as AnimatableProperty}
                value={selected.center.y}
              />
              <AppearanceNumber
                clipId={clipId}
                label="Radius"
                path={`appearance.${selected.id}.gradient.radius` as AnimatableProperty}
                value={selected.radius}
                min={0.001}
              />
            </>
          )}

          {(selected.kind === 'linear-gradient' || selected.kind === 'radial-gradient') && (
            <>
              <div className="control-row">
                <label className="prop-label">Gradient Stops</label>
                <button
                  type="button"
                  disabled={selected.stops.length >= MOTION_MAX_GRADIENT_STOPS}
                  onClick={() => addGradientStop(selected)}
                >
                  Add Stop
                </button>
              </div>
              {selected.stops.map((stop) => (
                <div className="control-row" key={stop.id}>
                  <input
                    aria-label={`${selected.name} stop color`}
                    type="color"
                    value={colorToHex(stop.color)}
                    onChange={(event) => updateStopColor(
                      selected.id,
                      stop,
                      event.target.value,
                    )}
                  />
                  <DraggableNumber
                    value={Math.round(stop.offset * 100)}
                    onChange={(value) => setPropertyValue(
                      clipId,
                      `appearance.${selected.id}.gradient.stop.${stop.id}.offset` as AnimatableProperty,
                      clamp01(value / 100),
                    )}
                    min={0}
                    max={100}
                    suffix="%"
                    defaultValue={Math.round(stop.offset * 100)}
                  />
                  <button
                    type="button"
                    disabled={selected.stops.length <= 2}
                    onClick={() => removeGradientStop(selected, stop.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
