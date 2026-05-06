import { useCallback } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import type { AnimatableProperty } from '../../../types';
import type {
  AppearanceItem,
  ColorFillAppearance,
  MotionColor,
  ReplicatorLayout,
  ShapePrimitive,
  StrokeAppearance,
} from '../../../types/motionDesign';
import { createColorFillAppearance, createDefaultReplicatorDefinition, createStrokeAppearance } from '../../../types/motionDesign';
import { DraggableNumber, KeyframeToggle } from './shared';

interface MotionShapeTabProps {
  clipId: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function componentToHex(value: number): string {
  return Math.round(clamp01(value) * 255).toString(16).padStart(2, '0');
}

function colorToHex(color: MotionColor | undefined, fallback = '#ffffff'): string {
  if (!color) return fallback;
  return `#${componentToHex(color.r)}${componentToHex(color.g)}${componentToHex(color.b)}`;
}

function hexToColor(hex: string, alpha: number): MotionColor {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((part) => part + part).join('')
    : normalized.padEnd(6, '0').slice(0, 6);

  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255,
    a: alpha,
  };
}

function NumberRow({
  clipId,
  label,
  property,
  value,
  min,
  max,
  suffix,
  defaultValue,
}: {
  clipId: string;
  label: string;
  property: AnimatableProperty;
  value: number;
  min?: number;
  max?: number;
  suffix?: string;
  defaultValue?: number;
}) {
  const setPropertyValue = useTimelineStore(state => state.setPropertyValue);

  return (
    <div className="labeled-value with-keyframe-toggle">
      <KeyframeToggle clipId={clipId} property={property} value={value} />
      <span className="labeled-value-label">{label}</span>
      <DraggableNumber
        value={value}
        onChange={(nextValue) => setPropertyValue(clipId, property, nextValue)}
        min={min}
        max={max}
        suffix={suffix}
        defaultValue={defaultValue}
      />
    </div>
  );
}

function updateAppearanceItem<T extends AppearanceItem>(
  items: AppearanceItem[],
  itemId: string,
  updater: (item: T) => T,
): AppearanceItem[] {
  return items.map((item) => item.id === itemId ? updater(item as T) : item);
}

function getGridLayout(layout: ReplicatorLayout | undefined): Extract<ReplicatorLayout, { mode: 'grid' }> {
  if (layout?.mode === 'grid') return layout;
  return createDefaultReplicatorDefinition().layout as Extract<ReplicatorLayout, { mode: 'grid' }>;
}

export function MotionShapeTab({ clipId }: MotionShapeTabProps) {
  const clip = useTimelineStore(state => state.clips.find(candidate => candidate.id === clipId));
  const updateMotionLayer = useTimelineStore(state => state.updateMotionLayer);
  const setPropertyValue = useTimelineStore(state => state.setPropertyValue);

  const motion = clip?.motion;
  const shape = motion?.shape;
  const appearanceItems = motion?.appearance?.items ?? [];
  const fill = appearanceItems.find((item): item is ColorFillAppearance => item.kind === 'color-fill');
  const stroke = appearanceItems.find((item): item is StrokeAppearance => item.kind === 'stroke');
  const replicator = motion?.replicator ?? createDefaultReplicatorDefinition();
  const gridLayout = getGridLayout(replicator.layout);

  const updatePrimitive = useCallback((primitive: ShapePrimitive) => {
    updateMotionLayer(clipId, (current) => ({
      ...current,
      shape: current.shape
        ? {
            ...current.shape,
            primitive,
            cornerRadius: primitive === 'rectangle' ? current.shape.cornerRadius ?? 0 : undefined,
          }
        : current.shape,
    }));
  }, [clipId, updateMotionLayer]);

  const updateFillColor = useCallback((hex: string) => {
    if (!fill) {
      updateMotionLayer(clipId, (current) => {
        const currentAppearance = current.appearance ?? { version: 1 as const, items: [] };
        return {
          ...current,
          appearance: {
            version: currentAppearance.version,
            items: [
              ...currentAppearance.items,
              createColorFillAppearance(hexToColor(hex, 1)),
            ],
          },
        };
      });
      return;
    }

    const nextColor = hexToColor(hex, fill.color.a);
    setPropertyValue(clipId, `appearance.${fill.id}.color.r` as AnimatableProperty, nextColor.r);
    setPropertyValue(clipId, `appearance.${fill.id}.color.g` as AnimatableProperty, nextColor.g);
    setPropertyValue(clipId, `appearance.${fill.id}.color.b` as AnimatableProperty, nextColor.b);
  }, [clipId, fill, setPropertyValue, updateMotionLayer]);

  const updateStrokeColor = useCallback((hex: string) => {
    if (!stroke) return;
    const nextColor = hexToColor(hex, stroke.color.a);
    setPropertyValue(clipId, `appearance.${stroke.id}.color.r` as AnimatableProperty, nextColor.r);
    setPropertyValue(clipId, `appearance.${stroke.id}.color.g` as AnimatableProperty, nextColor.g);
    setPropertyValue(clipId, `appearance.${stroke.id}.color.b` as AnimatableProperty, nextColor.b);
  }, [clipId, setPropertyValue, stroke]);

  const setStrokeVisible = useCallback((visible: boolean) => {
    updateMotionLayer(clipId, (current) => {
      const appearance = current.appearance ?? { version: 1 as const, items: [] };
      const existingStroke = appearance.items.find((item): item is StrokeAppearance => item.kind === 'stroke');
      if (!existingStroke) {
        return {
          ...current,
          appearance: {
            ...appearance,
            items: [
              ...appearance.items,
              { ...createStrokeAppearance(), visible },
            ],
          },
        };
      }

      return {
        ...current,
        appearance: {
          ...appearance,
          items: updateAppearanceItem<StrokeAppearance>(
            appearance.items,
            existingStroke.id,
            (item) => ({ ...item, visible }),
          ),
        },
      };
    });
  }, [clipId, updateMotionLayer]);

  const updateStrokeAlignment = useCallback((alignment: StrokeAppearance['alignment']) => {
    if (!stroke) return;
    updateMotionLayer(clipId, (current) => current.appearance
      ? {
          ...current,
          appearance: {
            ...current.appearance,
            items: updateAppearanceItem<StrokeAppearance>(
              current.appearance.items,
              stroke.id,
              (item) => ({ ...item, alignment }),
            ),
          },
        }
      : current);
  }, [clipId, stroke, updateMotionLayer]);

  const setReplicatorEnabled = useCallback((enabled: boolean) => {
    updateMotionLayer(clipId, (current) => {
      const currentReplicator = current.replicator ?? createDefaultReplicatorDefinition();
      return {
        ...current,
        replicator: {
          ...currentReplicator,
          enabled,
          layout: getGridLayout(currentReplicator.layout),
        },
      };
    });
  }, [clipId, updateMotionLayer]);

  if (!clip || !motion || !shape) {
    return <div className="properties-tab-content"><div className="panel-empty"><p>Select a motion shape clip</p></div></div>;
  }

  return (
    <div className="properties-tab-content transform-tab-compact">
      <div className="properties-section">
        <div className="control-row">
          <label className="prop-label">Shape</label>
          <select
            value={shape.primitive}
            onChange={(event) => updatePrimitive(event.target.value as ShapePrimitive)}
          >
            <option value="rectangle">Rectangle</option>
            <option value="ellipse">Ellipse</option>
          </select>
        </div>

        <NumberRow
          clipId={clipId}
          label="W"
          property="shape.size.w"
          value={shape.size.w}
          min={1}
          suffix="px"
          defaultValue={320}
        />
        <NumberRow
          clipId={clipId}
          label="H"
          property="shape.size.h"
          value={shape.size.h}
          min={1}
          suffix="px"
          defaultValue={180}
        />
        {shape.primitive === 'rectangle' && (
          <NumberRow
            clipId={clipId}
            label="Radius"
            property="shape.cornerRadius"
            value={shape.cornerRadius ?? 0}
            min={0}
            suffix="px"
            defaultValue={0}
          />
        )}
      </div>

      <div className="properties-section">
        <div className="control-row">
          {fill && (
            <KeyframeToggle
              clipId={clipId}
              property={`appearance.${fill.id}.opacity` as AnimatableProperty}
              value={fill.opacity}
            />
          )}
          <label className="prop-label">Fill</label>
          <input
            type="color"
            value={colorToHex(fill?.color)}
            onChange={(event) => updateFillColor(event.target.value)}
          />
          {fill && (
            <DraggableNumber
              value={Math.round(fill.opacity * 100)}
              onChange={(value) => setPropertyValue(clipId, `appearance.${fill.id}.opacity` as AnimatableProperty, clamp01(value / 100))}
              min={0}
              max={100}
              suffix="%"
              defaultValue={100}
            />
          )}
        </div>
      </div>

      <div className="properties-section">
        <div className="control-row">
          <label className="prop-label">Stroke</label>
          <input
            type="checkbox"
            checked={stroke?.visible ?? false}
            onChange={(event) => setStrokeVisible(event.target.checked)}
          />
          {stroke && (
            <>
              <input
                type="color"
                value={colorToHex(stroke.color, '#000000')}
                onChange={(event) => updateStrokeColor(event.target.value)}
                disabled={!stroke.visible}
              />
              <select
                value={stroke.alignment}
                onChange={(event) => updateStrokeAlignment(event.target.value as StrokeAppearance['alignment'])}
                disabled={!stroke.visible}
              >
                <option value="center">Center</option>
                <option value="inside">Inside</option>
                <option value="outside">Outside</option>
              </select>
            </>
          )}
        </div>
        {stroke && (
          <NumberRow
            clipId={clipId}
            label="Width"
            property={`appearance.${stroke.id}.stroke.width` as AnimatableProperty}
            value={stroke.width}
            min={0}
            suffix="px"
            defaultValue={4}
          />
        )}
      </div>

      <div className="properties-section">
        <div className="control-row">
          <label className="prop-label">Replicator</label>
          <input
            type="checkbox"
            checked={replicator.enabled}
            onChange={(event) => setReplicatorEnabled(event.target.checked)}
          />
          <select value="grid" onChange={() => undefined} disabled={!replicator.enabled}>
            <option value="grid">Grid</option>
          </select>
        </div>
        {replicator.enabled && (
          <>
            <NumberRow
              clipId={clipId}
              label="Count X"
              property="replicator.count.x"
              value={gridLayout.count.x}
              min={1}
              max={10}
              defaultValue={3}
            />
            <NumberRow
              clipId={clipId}
              label="Count Y"
              property="replicator.count.y"
              value={gridLayout.count.y}
              min={1}
              max={10}
              defaultValue={3}
            />
            <NumberRow
              clipId={clipId}
              label="Spacing X"
              property="replicator.spacing.x"
              value={gridLayout.spacing.x}
              suffix="px"
              defaultValue={120}
            />
            <NumberRow
              clipId={clipId}
              label="Spacing Y"
              property="replicator.spacing.y"
              value={gridLayout.spacing.y}
              suffix="px"
              defaultValue={120}
            />
            <div className="labeled-value with-keyframe-toggle">
              <KeyframeToggle
                clipId={clipId}
                property="replicator.offset.opacity"
                value={replicator.offset.opacity}
              />
              <span className="labeled-value-label">Fade</span>
              <DraggableNumber
                value={Math.round(replicator.offset.opacity * 100)}
                onChange={(value) => setPropertyValue(clipId, 'replicator.offset.opacity', clamp01(value / 100))}
                min={0}
                max={100}
                suffix="%"
                defaultValue={100}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
