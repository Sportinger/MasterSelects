import type { TimelineClip } from '../../../types/timeline';
import { createColorProperty, RUNTIME_COLOR_PARAM_DEFS, type ColorNode } from '../../../types/colorCorrection';
import { useTimelineStore } from '../../../stores/timeline';
import { interpolateKeyframes } from '../../../utils/keyframeInterpolation';
import { ResolveInspectorSection } from '../properties/resolveInspector/ResolveInspectorPrimitives';
import { ResolveInspectorNumberRow } from '../properties/resolveInspector/ResolveInspectorNumberRow';
import { KeyframeToggle } from '../properties/shared';
import './ColorNodeParameterControls.css';

// Both Corrector and Wheels nodes execute this same parameter set. Their type
// chooses the Color workspace tool, not which channels other inspectors expose.
const sections = new Map<string, typeof RUNTIME_COLOR_PARAM_DEFS>();
for (const definition of RUNTIME_COLOR_PARAM_DEFS) {
  const section = definition.section === 'Wheels'
    ? `Wheels / ${definition.label.split(' ')[0]}`
    : definition.section;
  sections.set(section, [...(sections.get(section) ?? []), definition]);
}

/** Shared numeric view of the grade; the dedicated Color tab owns the wheel UI. */
export function ColorNodeParameterControls({ clip, versionId, node, disabled = false }: {
  clip: TimelineClip;
  versionId: string;
  node: ColorNode;
  disabled?: boolean;
}) {
  const keyframes = useTimelineStore(state => state.clipKeyframes.get(clip.id));
  const time = useTimelineStore(state => Math.max(0, Math.min(clip.duration, state.playheadPosition - clip.startTime)));
  const setPropertyValue = useTimelineStore(state => state.setPropertyValue);
  const locked = useTimelineStore(state => state.isExporting || state.tracks.some(track => track.id === clip.trackId && track.locked));
  const readOnly = disabled || locked;

  return <div className="color-node-parameter-controls" onPointerUp={event => {
    const button = (event.target as HTMLElement).closest('button');
    if (button) requestAnimationFrame(() => { if (document.activeElement === button) button.blur(); });
  }}>
    {[...sections].map(([section, definitions]) => <ResolveInspectorSection key={section} title={section} indicator="none">
      {definitions.map(definition => {
        const property = createColorProperty(versionId, node.id, definition.key);
        const stored = node.params[definition.key];
        const value = interpolateKeyframes(keyframes ?? [], property, time,
          typeof stored === 'number' ? stored : definition.defaultValue);
        return <ResolveInspectorNumberRow key={definition.key} label={definition.label}
          ariaLabel={`${node.name} ${definition.label}`} value={value} defaultValue={definition.defaultValue}
          min={definition.min} max={definition.max} hardMin={definition.min} hardMax={definition.max}
          step={definition.step} disabled={readOnly}
          persistenceKey={`color.${definition.key}`}
          onChange={next => { if (!readOnly) setPropertyValue(clip.id, property, next); }}
          keyframeToggle={!readOnly && <KeyframeToggle clipId={clip.id} property={property} value={value} />} />;
      })}
    </ResolveInspectorSection>)}
  </div>;
}
