import { useTimelineStore } from '../../../../stores/timeline';
import { hasValidWarpPoints, sampleWarp } from '../../../../services/timeline/retime/clipWarp';
import { ResolveInspectorNumberRow } from '../resolveInspector/ResolveInspectorNumberRow';
import { ResolveInspectorIconButton, ResolveInspectorRow } from '../resolveInspector/ResolveInspectorPrimitives';

/** Each numeric gesture uses the shared inspector history batch and atomic pair mutation. */
export function ResolveWarpPointsEditor({ clipId }: { clipId: string }) {
  const clip = useTimelineStore(state => state.clips.find(item => item.id === clipId));
  // A boolean selector keeps playback from re-rendering every point row per frame.
  const playheadInside = useTimelineStore(state => {
    const local = state.playheadPosition - (clip?.startTime ?? 0);
    return !!clip && local >= 0 && local <= clip.duration &&
      (clip.timeRemap?.kind !== 'warp' || !clip.timeRemap.points.some(point => Math.abs(point.time - local) < 1e-9));
  });
  const remap = clip?.timeRemap;
  if (!clip || remap?.kind !== 'warp' || !hasValidWarpPoints(remap.points)) return null;
  const points = remap.points;
  const domain = clip.source?.naturalDuration ?? clip.outPoint;
  const editPoint = (index: number, field: 'time' | 'source', value: number) => {
    const state = useTimelineStore.getState();
    const current = state.clips.find(item => item.id === clipId)?.timeRemap;
    if (current?.kind !== 'warp') return;
    state.setClipTimeRemap(clipId, { kind: 'warp', points: current.points.map((point, i) =>
      i === index ? { ...point, [field]: value } : point) });
  };
  const canAdd = points.length < 256 && playheadInside;
  return <div onClickCapture={event => {
    if (event.detail > 0 && event.target instanceof Element) event.target.closest<HTMLButtonElement>('button')?.blur();
  }}>
    {points.map((point, index) => <div key={index}>
      <ResolveInspectorNumberRow label={`${index + 1}. Time`} ariaLabel={`Warp point ${index + 1} time`}
        suffix="s" value={point.time} defaultValue={clip.duration * index / (points.length - 1)} step={0.001} sensitivity={0.01}
        min={index === 0 ? 0 : points[index - 1].time + 0.000001}
        max={points[index + 1]?.time ?? Math.max(clip.duration, point.time, 1)}
        hardMin={index === 0 ? 0 : points[index - 1].time + 0.000001}
        hardMax={points[index + 1] ? points[index + 1].time - 0.000001 : Infinity}
        onChange={value => editPoint(index, 'time', value)}
        actions={<ResolveInspectorIconButton ariaLabel={`Remove warp point ${index + 1}`}
          title="Remove point" disabled={points.length <= 2} onClick={event => {
            if (event.detail > 0) event.currentTarget.blur();
            const state = useTimelineStore.getState();
            const current = state.clips.find(item => item.id === clipId)?.timeRemap;
            if (current?.kind === 'warp' && current.points.length > 2)
              state.setClipTimeRemap(clipId, { kind: 'warp', points: current.points.filter((_, i) => i !== index) });
          }}><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 8h10" /></svg></ResolveInspectorIconButton>}
      />
      <ResolveInspectorNumberRow label="Source" ariaLabel={`Warp point ${index + 1} source`}
        suffix="s" value={point.source} defaultValue={clip.inPoint} min={0} max={Math.max(0, domain)}
        numberMin={-Infinity} numberMax={Infinity} step={0.001} sensitivity={0.01}
        onChange={value => editPoint(index, 'source', value)} />
    </div>)}
    <ResolveInspectorRow label="Add at playhead" title="Insert a point on the current curve without changing its shape.">
      <ResolveInspectorIconButton ariaLabel="Add warp point at playhead" disabled={!canAdd} onClick={event => {
        if (event.detail > 0) event.currentTarget.blur();
        const state = useTimelineStore.getState();
        const current = state.clips.find(item => item.id === clipId);
        if (current?.timeRemap?.kind !== 'warp') return;
        const time = state.playheadPosition - current.startTime;
        if (time < 0 || time > current.duration) return;
        // Retain the raw curve at clamp crossings; inserting a clamped value would alter nearby frames.
        const source = sampleWarp(current.timeRemap.points, time).sourceTime;
        state.setClipTimeRemap(clipId, { kind: 'warp', points: [...current.timeRemap.points, { time, source }]
          .toSorted((a, b) => a.time - b.time) });
      }}><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 8h10M8 3v10" /></svg></ResolveInspectorIconButton>
    </ResolveInspectorRow>
  </div>;
}
