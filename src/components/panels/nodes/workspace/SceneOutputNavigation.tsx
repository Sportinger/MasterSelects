import { useEffect, useRef } from 'react';
import { useTimelineStore } from '../../../../stores/timeline';
import type { TimelineClip } from '../../../../types/timeline';
import type { NodeGraph } from '../../../../types/nodeGraph';

export function SceneOutputNavigation({ clip, graph, onFocus }: {
  clip: TimelineClip; graph: NodeGraph; onFocus: (id: string) => void;
}) {
  const clips = useTimelineStore(state => state.clips);
  const document = useTimelineStore(state => clip.sceneGraphOutput && state.sharedSceneGraphs?.[clip.sceneGraphOutput.graphId]);
  const focused = useRef('');
  useEffect(() => {
    if (focused.current === clip.id) return;
    const localGroupId = clip.sceneGraphOutput?.groupId?.split('/').at(-1);
    const group = localGroupId && graph.groups?.find(g => g.id.split('/').at(-1) === localGroupId);
    if (group) { focused.current = clip.id; onFocus(group.proxyId); }
  }, [clip.id, clip.sceneGraphOutput, graph, onFocus]);
  if (!document) return null;
  const family = clips.filter(c => c.sceneGraphOutput?.graphId === document.id);
  return <nav className="node-workspace-view-bar" aria-label="Shared graph outputs">
    <span className="node-workspace-view-context" title="These clips edit the same nodes and use the same graph time.">{document.name} →</span>
    {family.map(output => <button key={output.id} type="button" className="node-workspace-breadcrumb-link"
      aria-current={output.id === clip.id ? 'page' : undefined}
      title={`${output.sceneGraphOutput?.label} · shared nodes`}
      onClick={event => { if (event.detail > 0) event.currentTarget.blur(); useTimelineStore.getState().selectClip(output.id); }}>
      {output.sceneGraphOutput?.nodeIds ? output.name : 'Original'}
    </button>)}
    <span className="node-workspace-view-context">Shared time · trim controls visibility</span>
  </nav>;
}
