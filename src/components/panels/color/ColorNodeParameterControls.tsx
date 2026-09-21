import type { TimelineClip } from '../../../types/timeline';
import { createColorProperty, RUNTIME_COLOR_PARAM_DEFS, type ColorNode } from '../../../types/colorCorrection';
import { ResolveInspectorSection } from '../properties/resolveInspector/ResolveInspectorPrimitives';
import { ParameterSourceNumberRow } from '../properties/ParameterSourceNumberRow';
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

  return <div className="color-node-parameter-controls" onPointerUp={event => {
    const button = (event.target as HTMLElement).closest('button');
    if (button) requestAnimationFrame(() => { if (document.activeElement === button) button.blur(); });
  }}>
    {[...sections].map(([section, definitions]) => <ResolveInspectorSection key={section} title={section} indicator="none">
      {definitions.map(definition => {
        const property = createColorProperty(versionId, node.id, definition.key);
        return <ParameterSourceNumberRow key={definition.key} clipId={clip.id} property={property} disabled={disabled} />;
      })}
    </ResolveInspectorSection>)}
  </div>;
}
