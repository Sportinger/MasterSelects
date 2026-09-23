import { useTimelineStore } from '../../../../stores/timeline';
import { InspectorSelect } from '../../../inspector/InspectorSelect';

export function NodeWorkspaceSourceSelect({ clipId, onChange }: { clipId?: string | null; onChange: (id: string | null) => void }) {
  const clips = useTimelineStore(state => state.clips);
  const tracks = useTimelineStore(state => state.tracks);
  const missing = clipId && !clips.some(clip => clip.id === clipId);
  return <div className="node-workspace-source-select">
    <InspectorSelect ariaLabel="Node graph source" value={clipId ?? ''} onChange={value => onChange(value || null)} options={[
      { value: '', label: 'Active', title: 'Follow the selected timeline clip' },
      ...(missing ? [{ value: clipId, label: 'Assigned clip unavailable', disabled: true }] : []),
      ...clips.map(clip => ({ value: clip.id, label: `${clip.name} · ${tracks.find(t => t.id === clip.trackId)?.name ?? 'Clip'}` })),
    ]} />
  </div>;
}
