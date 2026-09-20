import { readTimelineRuntimeState } from '../../../../services/timeline/timelineRuntimeCoordinator';
import type { TimelineClip } from '../../../../types/timeline';
import { useTimelineStore } from '../../../../stores/timeline';
import { startBatch, endBatch } from '../../../../stores/historyStore';
import { ResolveInspectorIconButton, ResolveInspectorRow } from '../../properties/resolveInspector/ResolveInspectorPrimitives';

export function EffectOrderControls({ clip, effectId }: { clip: TimelineClip; effectId: string }) {
  const index = clip.effects.findIndex(e => e.id === effectId);
  const locked = useTimelineStore(s => s.isExporting || s.tracks.find(t => t.id === clip.trackId)?.locked);
  if (index < 0) return null;
  const move = (offset: number) => {
    startBatch('Reorder effect');
    try { readTimelineRuntimeState(useTimelineStore).reorderClipEffect(clip.id, effectId, index + offset); } finally { endBatch(); }
  };
  return <div className="operator-parameters" onPointerUp={e => { if (e.target instanceof Element) e.target.closest('button')?.blur(); }}>
    <ResolveInspectorRow label="Effect order"><span>{index + 1} / {clip.effects.length}</span>
      <ResolveInspectorIconButton ariaLabel="Move effect earlier" disabled={locked || index === 0} onClick={() => move(-1)}>↑</ResolveInspectorIconButton>
      <ResolveInspectorIconButton ariaLabel="Move effect later" disabled={locked || index === clip.effects.length - 1} onClick={() => move(1)}>↓</ResolveInspectorIconButton>
    </ResolveInspectorRow>
  </div>;
}
