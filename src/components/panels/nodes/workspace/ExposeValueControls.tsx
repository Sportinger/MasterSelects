import { useEffect, useState } from 'react';
import type { BoundOperatorNode, EffectOperatorGraph } from '../../../../types/operatorGraph';
import { ResolveInspectorRow } from '../../properties/resolveInspector/ResolveInspectorPrimitives';
import { canExposeGraphValue, renameExposedGraphValue, setGraphValueExposed } from '../../../../services/operators/exposedGraphValues';

/** Publishes a graph Value node as a keyframeable row in the clip's Effects tab. */
export function ExposeValueControls({ clipId, effectId, graph, node, safely }: {
  clipId: string; effectId: string; graph: EffectOperatorGraph; node: BoundOperatorNode; safely: (action: () => void) => void;
}) {
  const label = node.exposed?.label ?? '';
  const [draft, setDraft] = useState(label);
  useEffect(() => setDraft(label), [label]);
  if (!canExposeGraphValue(graph, node)) return null;
  const commitLabel = () => {
    const next = draft.trim();
    if (!next || next === label) { setDraft(label); return; }
    safely(() => renameExposedGraphValue(clipId, effectId, node.id, next));
  };
  return <>
    <ResolveInspectorRow label="Effects tab" title="Show this value as a keyframeable parameter in the clip's Effects tab">
      <input aria-label="Expose value to Effects tab" type="checkbox" checked={Boolean(node.exposed)}
        onChange={event => safely(() => setGraphValueExposed(clipId, effectId, node.id, event.target.checked))} />
    </ResolveInspectorRow>
    {node.exposed && <ResolveInspectorRow label="Exposed name">
      <input aria-label="Exposed value name" className="resolve-inspector-text-input" type="text" maxLength={80} value={draft}
        onChange={event => setDraft(event.target.value)} onBlur={commitLabel}
        onKeyDown={event => {
          if (event.key === 'Enter') event.currentTarget.blur();
          else if (event.key === 'Escape') { setDraft(label); event.currentTarget.blur(); }
        }} />
    </ResolveInspectorRow>}
  </>;
}
