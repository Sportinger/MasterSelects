import { useState } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import type { MotionPathVertex } from '../../../types/motionDesign';
import { startBatch, endBatch } from '../../../stores/historyStore';
import { DraggableNumber } from './shared';
import { splitPathSegment } from '../../../services/motionDesign/path/splitPathSegment';

/** General path authoring controls, also usable for imported/custom outlines. */
export function MotionPathPointsEditor({ clipId }: { clipId: string }) {
  const [selected, setSelected] = useState(0);
  const path = useTimelineStore(state => state.clips.find(clip => clip.id === clipId)?.motion?.shape?.path);
  const update = useTimelineStore(state => state.updateMotionLayer);
  if (!path?.vertices.length) return null;
  const index = Math.min(selected, path.vertices.length - 1);
  const vertex = path.vertices[index];
  const edit = (fn: (vertices: MotionPathVertex[]) => MotionPathVertex[]) => update(clipId, current => {
    if (!current.shape?.path) return current;
    return { ...current, shape: { ...current.shape, path: { ...current.shape.path, vertices: fn(current.shape.path.vertices) } } };
  });
  const setCoordinate = (group: 'point' | 'handleIn' | 'handleOut', axis: 'x' | 'y', value: number) => {
    if (!Number.isFinite(value)) return;
    edit(vertices => vertices.map((point, i) => i !== index ? point : group === 'point'
      ? { ...point, [axis]: value } : { ...point, [group]: { ...point[group], [axis]: value } }));
  };
  return <details className="property-section">
    <summary>Path points and handles</summary>
    <div className="control-row">
      <button type="button" disabled={path.vertices.length >= 128 || (!path.closed && index === path.vertices.length - 1)}
        onPointerDown={event => event.preventDefault()} onClick={() => { edit(vertices => splitPathSegment({ ...path, vertices },index)); setSelected(index+1); }}>Insert point after</button>
      <label htmlFor={`motion-point-${clipId}`}>Point</label>
      <select id={`motion-point-${clipId}`} value={index} onChange={event => setSelected(Number(event.target.value))}>
        {path.vertices.map((_, i) => <option key={i} value={i}>{i + 1}</option>)}
      </select>
    </div>
    {(['point', 'handleIn', 'handleOut'] as const).map(group => <div key={group}>
      <span>{group === 'point' ? 'Position' : group === 'handleIn' ? 'Incoming handle' : 'Outgoing handle'}</span>
      {(['x','y'] as const).map(axis => <div className="labeled-value" key={axis}>
        <span className="labeled-value-label">{axis.toUpperCase()}</span>
        <DraggableNumber value={group === 'point' ? vertex[axis] : vertex[group][axis]} suffix="px"
          onChange={value => setCoordinate(group, axis, value)}
          onDragStart={() => startBatch('Edit motion path point')} onDragEnd={() => endBatch()} />
      </div>)}
    </div>)}
    <div className="control-row">
      <button type="button" onPointerDown={event => event.preventDefault()} onClick={() => edit(vertices => vertices.map((point,i) => i === index
        ? { ...point, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } } : point))}>Corner point</button>
      <button type="button" disabled={path.vertices.length <= (path.closed ? 3 : 2)} onPointerDown={event => event.preventDefault()}
        onClick={() => { edit(vertices => vertices.filter((_,i) => i !== index)); setSelected(Math.max(0,index-1)); }}>Remove point</button>
    </div>
  </details>;
}
