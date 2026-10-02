import { useState } from 'react';
import type { EffectControlProps } from '../../../effects/types';
import { useTimelineStore } from '../../../stores/timeline';
import { startBatch, endBatch } from '../../../stores/historyStore';
import { IDENTITY, parsePerspectiveGuides } from '../../../effects/distort/guided-perspective/guideGeometry';
import { ResolveInspectorSection, ResolveInspectorRow } from './resolveInspector/ResolveInspectorPrimitives';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { EffectKeyframeToggle } from './shared';
import { PerspectiveGuideDialog } from './perspectiveGuides/PerspectiveGuideDialog';
import './perspectiveGuides/PerspectiveGuides.css';

export function GuidedPerspectiveControls({ params, onChange, clipId, effectInstanceId }: EffectControlProps) {
  const [editing, setEditing] = useState(false);
  const clip = useTimelineStore(state => state.clips.find(c => c.id === clipId));
  const guides = parsePerspectiveGuides(params.guides);
  const commit = (next: EffectControlProps['params']) => {
    startBatch('Guided Perspective');
    try { onChange(next); } finally { endBatch(); }
  };
  return <ResolveInspectorSection title="Perspective" indicator="none">
    <ResolveInspectorRow label="Guides"><button type="button" className="perspective-action"
      disabled={!clip || clip.source?.type !== 'image'} onClick={() => setEditing(true)}
      onPointerUp={event => event.currentTarget.blur()}>Edit guides</button></ResolveInspectorRow>
    <p className="effect-info">{guides.length ? `${guides.length} guides applied.` : 'Draw at least two vertical or horizontal guides, up to eight per direction.'}
      {' '}Apply Lens Correction before this effect. Guide editing currently supports still images.</p>
    {(['strength', 'scale'] as const).map(key => <ResolveInspectorNumberRow key={key}
      label={key === 'strength' ? 'Strength' : 'Scale'} value={typeof params[key] === 'number' ? params[key] as number : 100}
      defaultValue={100} min={key === 'scale' ? 50 : 0} max={key === 'scale' ? 300 : 100} step={0.1} suffix="%"
      hardMin={key === 'scale' ? 50 : 0} hardMax={key === 'scale' ? 300 : 100}
      onChange={value => onChange({ ...params, [key]: value })}
      keyframeToggle={clipId && effectInstanceId ? <EffectKeyframeToggle clipId={clipId} effectId={effectInstanceId} paramName={key} value={Number(params[key] ?? 100)} /> : undefined} />)}
    <ResolveInspectorRow label="Correction"><button type="button" className="perspective-action"
      onPointerUp={event => event.currentTarget.blur()} onClick={() => commit({ ...params, guides: '[]', strength: 100, scale: 100,
        ...Object.fromEntries(IDENTITY.map((value, i) => [`matrix${i}`, value])) })}>Reset guides</button></ResolveInspectorRow>
    {editing && clip && <PerspectiveGuideDialog file={clip.file} effects={clip.effects} effectId={effectInstanceId}
      initialGuides={guides} onCancel={() => setEditing(false)} onApply={(next, inverse) => {
        commit({ ...params, guides: JSON.stringify(next), ...Object.fromEntries(inverse.map((value, i) => [`matrix${i}`, value])) });
        setEditing(false);
      }} />}
  </ResolveInspectorSection>;
}
