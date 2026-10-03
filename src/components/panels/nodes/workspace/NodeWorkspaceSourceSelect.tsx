import { useTimelineStore } from '../../../../stores/timeline';
import { InspectorSelect } from '../../../inspector/InspectorSelect';
export const TIMELINE_NODE_SOURCE = '@timeline';
/** Unlocked: follow the selection (clip graph for a selected clip, otherwise the timeline). */
export const ACTIVE_NODE_SOURCE = '@active';
/** Panel data value to view source; omitted means the locked timeline view (default). */
export const nodeViewSource = (value?: string | null) => value || TIMELINE_NODE_SOURCE;

export function NodeWorkspaceSourceSelect({ clipId, onChange }: { clipId?: string | null; onChange: (id: string | null) => void }) {
  const clips = useTimelineStore(state => state.clips);
  const tracks = useTimelineStore(state => state.tracks);
  const value = nodeViewSource(clipId);
  const missing = value !== TIMELINE_NODE_SOURCE && value !== ACTIVE_NODE_SOURCE && !clips.some(clip => clip.id === value);
  return <div className="node-workspace-source-select">
    <InspectorSelect ariaLabel="Node graph source" value={value} onChange={next => onChange(next || null)} options={[
      { value: TIMELINE_NODE_SOURCE, label: 'Timeline', title: 'Show the whole composition graph' },
      { value: ACTIVE_NODE_SOURCE, label: 'Active', title: 'Follow the selection: a selected clip shows its own graph' },
      ...(missing ? [{ value, label: 'Assigned clip unavailable', disabled: true }] : []),
      ...clips.map(clip => ({ value: clip.id, label: `${clip.name} · ${tracks.find(t => t.id === clip.trackId)?.name ?? 'Clip'}` })),
    ]} />
  </div>;
}
