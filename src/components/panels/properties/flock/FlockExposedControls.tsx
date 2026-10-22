import { useRef, useState } from 'react';
import { useTimelineStore } from '../../../../stores/timeline';
import { endBatch, startBatch } from '../../../../stores/historyStore';
import type { Keyframe } from '../../../../types/keyframes';
import type { TimelineClip } from '../../../../types/timeline';
import { createFlockProperty, type FlockExposedParam, type FlockParamComponent } from '../../../../types/flock';
import { readFlockParamValue, resolveFlockParamDescriptor } from '../../../../services/flock/flockPropertyValues';
import { readAnimatedFlockParam } from '../../../../services/flock/flockAnimatedParams';
import type { SourceOffsetResolver } from '../../../../services/flock/time/flockKeyframeTime';
import type { FlockParamDescriptor } from '../../../../services/flock/operators/flockOperatorTypes';
import { hexColorToRgb, normalizeHexColor, rgbColorToHex } from '../../../../utils/colorParam';
import { DraggableNumber, KeyframeToggle, MultiKeyframeToggle } from '../shared';
import { InspectorSelect } from '../../../inspector/InspectorSelect';
import { ResolveInspectorNumberRow } from '../resolveInspector/ResolveInspectorNumberRow';
import { ResolveInspectorIconButton, ResolveInspectorRow, ResolveInspectorSection, ResolveResetIcon } from '../resolveInspector/ResolveInspectorPrimitives';
// The swatch and bordered hex field of the shared colour row (its row component has no slot for the keyframe toggle and ×).
import '../resolveInspector/ResolveInspectorColorRow.css';
import { FlockPopulationRow } from './FlockPopulationRow';
import {
  clampFlockNumber,
  flockNumberDecimals,
  flockSliderRange,
  getFlockInvalidationHint,
  getFlockNumberDecimals,
  getFlockNumberSensitivity,
  isPresetFlockControl,
  presetFlockValue,
  isStructuralFlockParam,
} from './flockControlUtils';

export interface FlockControlContext {
  clip: TimelineClip;
  keyframes: Keyframe[] | undefined;
  clipLocalTime: number;
  /** Clip speed/reverse source offset, so keyed values display at the playhead's source time. */
  resolveSourceOffset?: SourceOffsetResolver;
}

interface ControlProps {
  ctx: FlockControlContext;
  exposed: FlockExposedParam;
  descriptor: FlockParamDescriptor;
}

function readAnimated(ctx: FlockControlContext, property: string): number | undefined {
  return readAnimatedFlockParam(ctx.clip, ctx.keyframes, property, ctx.clipLocalTime, ctx.resolveSourceOffset);
}

function withBatch(label: string, action: () => void) {
  startBatch(label);
  try {
    action();
  } finally {
    endBatch();
  }
}

/** × of a control added through Add (or in the Nodes tab); the preset's own controls have none. */
function RemoveControlButton({ clipId, exposed }: { clipId: string; exposed: FlockExposedParam }) {
  const unexposeFlockGraphParam = useTimelineStore((state) => state.unexposeFlockGraphParam);
  const own = useTimelineStore((state) => {
    const flock = state.clips.find((clip) => clip.id === clipId)?.flock;
    return !!flock && isPresetFlockControl(flock, exposed);
  });
  if (own) return null;
  return (
    <button
      type="button"
      className="flock-icon-button"
      aria-label={`Remove control ${exposed.label}`}
      title="Remove from clip panel (the node parameter stays unchanged)"
      onPointerUp={(event) => event.currentTarget.blur()}
      onClick={() => withBatch('Remove flock control', () => unexposeFlockGraphParam(clipId, exposed.id))}
    >
      ×
    </button>
  );
}

function FlockNumberControl({ ctx, exposed, descriptor }: ControlProps) {
  const setPropertyValue = useTimelineStore((state) => state.setPropertyValue);
  const property = createFlockProperty(exposed.nodeId, exposed.param);
  const fallback = typeof descriptor.default === 'number' ? descriptor.default : 0;
  const value = readAnimated(ctx, property) ?? fallback;
  const range = flockSliderRange(exposed, descriptor, value);
  // Reset returns to the preset's value (the look the page and the Preset row describe).
  const preset = presetFlockValue(ctx.clip.flock!, exposed);
  const resetValue = typeof preset === 'number' && Number.isFinite(preset) ? preset : fallback;

  return (
    <div data-flock-control={exposed.id}>
      <ResolveInspectorNumberRow
        label={exposed.label}
        ariaLabel={exposed.label}
        title={descriptor.description}
        value={value}
        defaultValue={resetValue}
        min={range.min}
        max={range.max}
        step={range.step}
        numberMin={range.hardMin}
        numberMax={range.hardMax}
        hardMin={range.hardMin}
        hardMax={range.hardMax}
        decimals={flockNumberDecimals(descriptor, range.step, value)}
        sensitivity={getFlockNumberSensitivity(descriptor, range.min, range.max)}
        suffix={descriptor.unit ? ` ${descriptor.unit}` : ''}
        persistenceKey={`flock.${ctx.clip.id}.${exposed.id}`}
        keyframeToggle={<KeyframeToggle clipId={ctx.clip.id} property={property} value={value} />}
        actions={<RemoveControlButton clipId={ctx.clip.id} exposed={exposed} />}
        onChange={(nextValue) => setPropertyValue(ctx.clip.id, property, nextValue)}
      />
    </div>
  );
}

function FlockVectorControl({ ctx, exposed, descriptor }: ControlProps) {
  const setPropertyValue = useTimelineStore((state) => state.setPropertyValue);
  const defaults = Array.isArray(descriptor.default) ? descriptor.default : [0, 0, 0];
  const components: Array<{ component: FlockParamComponent; index: number }> = [
    { component: 'x', index: 0 },
    { component: 'y', index: 1 },
    { component: 'z', index: 2 },
  ];

  return (
    <div className="flock-control-vector" data-flock-control={exposed.id}>
      <div className="flock-control-vector-header">
        <span className="flock-control-vector-label" title={descriptor.description}>{exposed.label}</span>
        <RemoveControlButton clipId={ctx.clip.id} exposed={exposed} />
      </div>
      {components.map(({ component, index }) => {
        const property = createFlockProperty(exposed.nodeId, exposed.param, component);
        const value = readAnimated(ctx, property) ?? defaults[index] ?? 0;
        return (
          <div key={component} className="labeled-value with-keyframe-toggle flock-control-row">
            <KeyframeToggle clipId={ctx.clip.id} property={property} value={value} />
            <span className="labeled-value-label">{component.toUpperCase()}</span>
            <DraggableNumber
              value={value}
              onChange={(nextValue) => setPropertyValue(ctx.clip.id, property, nextValue)}
              defaultValue={defaults[index] ?? 0}
              decimals={1}
              sensitivity={0.5}
              ariaLabel={`${exposed.label} ${component.toUpperCase()}`}
              onDragStart={() => startBatch(`Adjust ${exposed.label}`)}
              onDragEnd={() => endBatch()}
            />
          </div>
        );
      })}
    </div>
  );
}

function FlockColorControl({ ctx, exposed, descriptor }: ControlProps) {
  const setPropertyValue = useTimelineStore((state) => state.setPropertyValue);
  const setFlockGraphParam = useTimelineStore((state) => state.setFlockGraphParam);
  const isRecording = useTimelineStore((state) => state.isRecording);
  const hasKeyframes = useTimelineStore((state) => state.hasKeyframes);
  const fallback = typeof descriptor.default === 'string' ? descriptor.default : '#ffffff';
  const staticValue = normalizeHexColor(readFlockParamValue(ctx.clip.flock!, exposed.nodeId, exposed.param), fallback);
  const staticRgb = hexColorToRgb(staticValue, fallback);
  const entries = (['r', 'g', 'b'] as const).map((channel) => {
    const property = createFlockProperty(exposed.nodeId, exposed.param, channel);
    return { property, value: readAnimated(ctx, property) ?? staticRgb[channel] };
  });
  const colorValue = rgbColorToHex({ r: entries[0].value, g: entries[1].value, b: entries[2].value });
  const isKeyed = entries.some(({ property }) => isRecording(ctx.clip.id, property) || hasKeyframes(ctx.clip.id, property));

  // Reset returns to the preset's colour, like the number rows.
  const preset = presetFlockValue(ctx.clip.flock!, exposed);
  const resetColor = normalizeHexColor(typeof preset === 'string' ? preset : fallback, fallback);
  // The hex field shows the value, or what is being typed until Enter or blur commits it (Escape drops it).
  const [draft, setDraft] = useState<string | null>(null);
  const pointerChange = useRef(false);

  const updateColor = (nextColor: string) => {
    const normalized = normalizeHexColor(nextColor, colorValue);
    const rgb = hexColorToRgb(normalized, colorValue);
    withBatch(`Adjust ${exposed.label}`, () => {
      if (isKeyed) {
        setPropertyValue(ctx.clip.id, entries[0].property, rgb.r);
        setPropertyValue(ctx.clip.id, entries[1].property, rgb.g);
        setPropertyValue(ctx.clip.id, entries[2].property, rgb.b);
      } else {
        setFlockGraphParam(ctx.clip.id, exposed.nodeId, exposed.param, normalized);
      }
    });
  };
  const commitDraft = () => {
    const typed = draft?.trim();
    if (typed && /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(typed)) {
      const next = normalizeHexColor(typed.startsWith('#') ? typed : `#${typed}`, colorValue);
      if (next !== colorValue) updateColor(next);
    }
    setDraft(null);
  };

  return (
    <div data-flock-control={exposed.id}>
      <ResolveInspectorRow
        label={exposed.label}
        title={descriptor.description}
        className="resolve-inspector-row--extra-action"
        actions={<>
          <RemoveControlButton clipId={ctx.clip.id} exposed={exposed} />
          <MultiKeyframeToggle
            clipId={ctx.clip.id}
            entries={entries}
            dragId={`${ctx.clip.id}:flock:${exposed.nodeId}:${exposed.param}:color`}
            title="Add color keyframes"
          />
          <ResolveInspectorIconButton ariaLabel={`Reset ${exposed.label}`} className="resolve-inspector-reset-button"
            onClick={(event) => { if (event.detail > 0) event.currentTarget.blur(); updateColor(resetColor); }}>
            <ResolveResetIcon />
          </ResolveInspectorIconButton>
        </>}
      >
        <span className="resolve-inspector-color">
          <input
            type="color"
            aria-label={exposed.label}
            value={colorValue}
            onPointerDown={() => { pointerChange.current = true; }}
            onKeyDown={() => { pointerChange.current = false; }}
            onChange={(event) => {
              updateColor(event.target.value);
              if (pointerChange.current) event.currentTarget.blur();
              pointerChange.current = false;
            }}
          />
          <input
            type="text"
            aria-label={`${exposed.label} hex`}
            value={draft ?? colorValue}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); commitDraft(); }
              if (event.key === 'Escape') { event.preventDefault(); setDraft(null); }
            }}
          />
        </span>
      </ResolveInspectorRow>
    </div>
  );
}

function StructuralNumberInput({
  value,
  descriptor,
  label,
  min,
  max,
  onCommit,
}: {
  value: number;
  descriptor: FlockParamDescriptor;
  label: string;
  min?: number;
  max?: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const draftRef = useRef<number | null>(null);
  const dragging = useRef(false);
  const normalize = (next: number) => {
    const clamped = clampFlockNumber(next, min, max);
    return descriptor.type === 'integer' ? Math.round(clamped) : clamped;
  };
  return (
    <DraggableNumber
      value={draft ?? value}
      onChange={(next) => {
        const normalized = normalize(next);
        if (dragging.current) {
          // Structural values commit once on release so a drag does not reallocate every frame.
          draftRef.current = normalized;
          setDraft(normalized);
        } else {
          onCommit(normalized);
        }
      }}
      defaultValue={typeof descriptor.default === 'number' ? descriptor.default : 0}
      min={min}
      max={max}
      decimals={descriptor.type === 'integer' ? 0 : getFlockNumberDecimals(descriptor.step)}
      sensitivity={descriptor.type === 'integer' ? Math.max(1, ((max ?? 1000) - (min ?? 0)) / 400) : getFlockNumberSensitivity(descriptor, min, max)}
      ariaLabel={label}
      onDragStart={() => {
        dragging.current = true;
      }}
      onDragEnd={() => {
        dragging.current = false;
        const committed = draftRef.current;
        draftRef.current = null;
        setDraft(null);
        if (committed !== null && committed !== value) onCommit(committed);
      }}
    />
  );
}

function FlockStructuralControl({ ctx, exposed, descriptor }: ControlProps) {
  const setFlockGraphParam = useTimelineStore((state) => state.setFlockGraphParam);
  const rawValue = readFlockParamValue(ctx.clip.flock!, exposed.nodeId, exposed.param) ?? descriptor.default;
  const commit = (next: string | number | boolean) => {
    withBatch(`Set ${exposed.label}`, () => setFlockGraphParam(ctx.clip.id, exposed.nodeId, exposed.param, next));
  };
  const isPopulation = exposed.param === 'count' || exposed.param.endsWith('__count');
  if (isPopulation && typeof rawValue === 'number') {
    const preset = presetFlockValue(ctx.clip.flock!, exposed);
    const resetValue = typeof preset === 'number' && Number.isFinite(preset) ? preset : typeof descriptor.default === 'number' ? descriptor.default : 4000;
    return <div data-flock-control={exposed.id}>
      <FlockPopulationRow label={exposed.label} value={rawValue} defaultValue={resetValue}
        min={exposed.min ?? descriptor.min ?? 1} max={exposed.max ?? descriptor.max ?? 100_000} onCommit={commit}
        actions={<RemoveControlButton clipId={ctx.clip.id} exposed={exposed} />} />
    </div>;
  }
  // How a change takes effect (it restarts or rebuilds the swarm) is said on hover, not as a line under the row.
  const hint = getFlockInvalidationHint(descriptor);
  let control: React.ReactNode;
  switch (descriptor.type) {
    case 'enum':
      control = (
        <InspectorSelect
          ariaLabel={exposed.label}
          value={String(rawValue)}
          options={(descriptor.options ?? []).map((option) => ({ value: option.value, label: option.label }))}
          onChange={(next) => commit(next)}
        />
      );
      break;
    case 'boolean':
      control = (
        <input type="checkbox" aria-label={exposed.label} checked={rawValue === true} onChange={(event) => commit(event.target.checked)} />
      );
      break;
    case 'asset':
      control = <span className="flock-asset-value" title="Choose assets on the node in the Flock node view">{String(rawValue) || 'None'}</span>;
      break;
    default:
      control = (
        <StructuralNumberInput
          value={typeof rawValue === 'number' ? rawValue : 0}
          descriptor={descriptor}
          label={exposed.label}
          min={exposed.min ?? descriptor.min}
          max={exposed.max ?? descriptor.max}
          onCommit={commit}
        />
      );
  }
  return (
    <div data-flock-control={exposed.id} className="flock-control-structural">
      <ResolveInspectorRow
        label={exposed.label}
        title={`${descriptor.description ?? exposed.label} ${hint}.`}
        className="resolve-inspector-row--extra-action"
        actions={<RemoveControlButton clipId={ctx.clip.id} exposed={exposed} />}
      >
        {control}
      </ResolveInspectorRow>
    </div>
  );
}

function FlockExposedControl({ ctx, exposed }: { ctx: FlockControlContext; exposed: FlockExposedParam }) {
  const descriptor = resolveFlockParamDescriptor(ctx.clip.flock!, exposed.nodeId, exposed.param);
  if (!descriptor) {
    return (
      <div className="labeled-value flock-control-row flock-control-missing" aria-disabled="true" data-flock-control={exposed.id}>
        <span className="flock-control-static-marker" aria-hidden="true" />
        <span className="labeled-value-label">{exposed.label}</span>
        <span className="flock-control-missing-note">missing parameter</span>
        <RemoveControlButton clipId={ctx.clip.id} exposed={exposed} />
      </div>
    );
  }
  if (descriptor.type === 'vec3' && descriptor.animatable) return <FlockVectorControl ctx={ctx} exposed={exposed} descriptor={descriptor} />;
  if (descriptor.type === 'color') return <FlockColorControl ctx={ctx} exposed={exposed} descriptor={descriptor} />;
  if (isStructuralFlockParam(descriptor)) return <FlockStructuralControl ctx={ctx} exposed={exposed} descriptor={descriptor} />;
  return <FlockNumberControl ctx={ctx} exposed={exposed} descriptor={descriptor} />;
}

/** Clip-panel controls promoted from graph parameters, grouped and ordered as authored. */
export function FlockExposedControls({ ctx }: { ctx: FlockControlContext }) {
  const definition = ctx.clip.flock!;
  const groups = new Map<string, FlockExposedParam[]>();
  for (const exposed of definition.exposed.toSorted((a, b) => a.order - b.order)) {
    const list = groups.get(exposed.group) ?? [];
    list.push(exposed);
    groups.set(exposed.group, list);
  }

  if (groups.size === 0) {
    return (
      <div className="properties-section flock-controls-empty">
        <p className="properties-hint">No controls are exposed. Add one below or promote a parameter in the Flock node view.</p>
      </div>
    );
  }

  return (
    <>
      {[...groups.entries()].map(([group, controls]) => (
        <div key={group} className="flock-control-group" data-flock-group={group}>
          {/* A group holding one control of the same name (Population) is a plain row, not a section of one. */}
          {controls.length === 1 && controls[0].label === group
            ? <div className="inspector-section resolve-inspector-section flock-control-single">
              <div className="inspector-section-content"><FlockExposedControl ctx={ctx} exposed={controls[0]} /></div>
            </div>
            : <ResolveInspectorSection title={group}>
              {controls.map((exposed) => (
                <FlockExposedControl key={exposed.id} ctx={ctx} exposed={exposed} />
              ))}
            </ResolveInspectorSection>}
        </div>
      ))}
    </>
  );
}
