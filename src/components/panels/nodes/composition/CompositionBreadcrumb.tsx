import { useMemo, useState } from 'react';
import type { NodeWorkspaceContext } from '../../../../types/compositionGraph';
import { useMediaStore } from '../../../../stores/mediaStore';
import { useTimelineStore } from '../../../../stores/timeline';
import { deriveCompositionTransitionParents } from '../../../../services/nodeGraph/composition/compositionTransitionParents';

export function CompositionBreadcrumb({ context, onTimeline }: { context: NodeWorkspaceContext; onTimeline: () => void }) {
  const compositions = useMediaStore(state => state.compositions);
  const activeId = useMediaStore(state => state.activeCompositionId);
  const clips = useTimelineStore(state => state.clips);
  const [warning, setWarning] = useState('');
  const clip = context.kind === 'clip' ? clips.find(candidate => candidate.id === context.clipId) : undefined;
  const current = compositions.find(comp => comp.id === activeId);
  const parents = useMemo(() => deriveCompositionTransitionParents(clips, current?.transitionComp), [clips, current?.transitionComp]);
  const sourceParent = clip ? parents.get(clip.id) : undefined;
  const path = current ? [current] : [];
  const visited = new Set(path.map(comp => comp.id));
  while (path[0]?.transitionComp) {
    const parent = compositions.find(comp => comp.id === path[0].transitionComp?.parentCompositionId);
    if (!parent || visited.has(parent.id)) break;
    visited.add(parent.id); path.unshift(parent);
  }
  const navigate = async (compositionId?: string) => {
    setWarning('');
    try {
      if (compositionId && compositionId !== activeId) await useMediaStore.getState().openCompositionTab(compositionId, { skipAnimation: true });
      onTimeline();
    } catch (error) { setWarning(error instanceof Error ? error.message : String(error)); }
  };
  return <nav className="node-composition-breadcrumb" aria-label="Node workspace path">
    {path.length ? path.map((comp, index) => {
      const link = comp.transitionComp;
      const parentClips = link ? compositions.find(parent => parent.id === link.parentCompositionId)?.timelineData?.clips : undefined;
      const outgoing = parentClips?.find(parent => parent.id === link?.parentOutgoingClipId);
      const incoming = parentClips?.find(parent => parent.id === link?.parentIncomingClipId);
      const label = outgoing && incoming ? `Transition ${outgoing.name} → ${incoming.name}` : comp.name;
      const last = index === path.length - 1 && context.kind === 'composition';
      return <span key={comp.id}>
        {index > 0 && <span aria-hidden="true">›</span>}
        {last ? <span aria-current="page" className="node-composition-crumb" title={label}>{label}</span> : <button type="button"
          className="node-workspace-toolbar-button node-composition-navigation-link node-composition-crumb" title={label} onClick={event => {
            if (event.detail > 0) event.currentTarget.blur();
            void navigate(comp.id);
          }}>{label}</button>}
      </span>;
    }) : context.kind === 'composition' ? <span aria-current="page">Comp</span> : <button type="button"
      className="node-workspace-toolbar-button node-composition-navigation-link" onClick={event => {
        if (event.detail > 0) event.currentTarget.blur();
        void navigate();
      }}>Comp</button>}
    {context.kind === 'clip' && <span><span aria-hidden="true">›</span><span aria-current="page" className="node-composition-crumb"
      title={clip?.name}>{clip?.name ?? 'Clip'}{sourceParent
      ? ` (${sourceParent.role}${sourceParent.panel ? `, panel ${sourceParent.panel}` : ''})` : ''}</span></span>}
    {warning && <span role="status">{warning}</span>}
  </nav>;
}
