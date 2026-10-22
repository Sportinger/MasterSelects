import type { PointerEvent } from 'react';
import type { EffectControlProps } from '../../../effects/types';
import { useTimelineStore } from '../../../stores/timeline';
import { startBatch, endBatch } from '../../../stores/historyStore';
import { IDENTITY, parsePerspectiveGuides } from '../../../effects/distort/guided-perspective/guideGeometry';
import { guidedPerspectiveWarnings } from '../../../effects/distort/guided-perspective';
import { ResolveInspectorSection, ResolveInspectorRow, ResolveInspectorIconButton, ResolveResetIcon } from './resolveInspector/ResolveInspectorPrimitives';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { EffectKeyframeToggle } from './shared';
import { usePerspectiveGuideEditing } from './perspectiveGuides/perspectiveGuideEditing';
import { getFirstEditablePreviewPanelId } from '../../preview/previewPanelDom';
import { useMediaStore } from '../../../stores/mediaStore';
import { useDockStore } from '../../../stores/dockStore';
import './perspectiveGuides/PerspectiveGuides.css';

const NUMBER_ROWS = [
  { key: 'strength', label: 'Strength', min: 0, max: 100 },
  { key: 'scale', label: 'Scale', min: 50, max: 300 },
] as const;

export function GuidedPerspectiveControls({ params, onChange, clipId, effectInstanceId }: EffectControlProps) {
  const target = usePerspectiveGuideEditing(state => state.target);
  const editing = target?.clipId === clipId && target?.effectId === effectInstanceId;
  const clip = useTimelineStore(state => state.clips.find(c => c.id === clipId));
  const guides = parsePerspectiveGuides(params.guides);
  const vertical = guides.filter(guide => guide.axis === 'vertical').length;
  const fillWarning = guidedPerspectiveWarnings(params).find(warning => warning.startsWith('Fill Frame'));
  const commit = (next: EffectControlProps['params']) => {
    startBatch('Guided Perspective');
    try { onChange(next); } finally { endBatch(); }
  };
  const beginEditing = () => {
    if (editing && target) { usePerspectiveGuideEditing.getState().end(target.id); return; }
    const compositionId = useMediaStore.getState().activeCompositionId;
    if (!clipId || !effectInstanceId || !compositionId) return;
    useTimelineStore.getState().pause();
    useMediaStore.getState().setSourceMonitorFile(null);
    useDockStore.getState().activatePanelType('preview');
    usePerspectiveGuideEditing.getState().begin({ clipId, effectId: effectInstanceId, compositionId,
      panelId: getFirstEditablePreviewPanelId() });
  };
  // Pointer activation must not leave a focus ring on selects or buttons (keyboard focus stays visible).
  const blurPointerFocus = (event: PointerEvent) => {
    if (event.target instanceof Element) event.target.closest<HTMLElement>('button, select')?.blur();
  };
  return <div className="effects-tab effect-sections" onPointerUp={blurPointerFocus}>
    <ResolveInspectorSection title="Perspective" indicator="none">
      <ResolveInspectorRow label="Guides" className="perspective-guides-row" actions={<ResolveInspectorIconButton ariaLabel="Reset guides" className="resolve-inspector-reset-button"
        disabled={!guides.length} onClick={() => commit({ ...params, guides: '[]',
          ...Object.fromEntries(IDENTITY.map((value, i) => [`matrix${i}`, value])) })}><ResolveResetIcon /></ResolveInspectorIconButton>}>
        <button type="button" className="perspective-action"
          disabled={!clip || clip.source?.type !== 'image' || !effectInstanceId} aria-pressed={editing}
          onClick={beginEditing}>Edit guides</button></ResolveInspectorRow>
      <p className="effect-info">{clip && clip.source?.type !== 'image' ? 'Guides can be drawn on still photos (image clips) only. ' : ''}
        {editing ? 'Draw along edges in the Preview. Wheel or pinch zooms, right-click removes a guide, Apply keeps them.'
          : guides.length ? `${[[vertical, 'vertical'], [guides.length - vertical, 'horizontal']].filter(([count]) => count)
            .map(([count, axis]) => `${count} ${axis}`).join(' and ')} guides applied. Put Lens Correction before this effect.`
            : 'No guides yet: choose Edit guides and draw at least two lines along edges that should be vertical (or horizontal).'}</p>
      <ResolveInspectorRow label="Framing"><InspectorSelect ariaLabel="Guided Perspective framing"
        value={params.fillFrame === true ? 'fill' : 'whole'}
        options={[{ value: 'whole', label: 'Whole photo' }, { value: 'fill', label: 'Fill frame' }]}
        onChange={value => onChange({ ...params, fillFrame: value === 'fill' })} /></ResolveInspectorRow>
      {fillWarning && <p className="effect-info" role="status">{fillWarning}</p>}
      {NUMBER_ROWS.map(({ key, label, min, max }) => <ResolveInspectorNumberRow key={key}
        label={label} value={typeof params[key] === 'number' ? params[key] as number : 100}
        defaultValue={100} min={min} max={max} step={0.1} decimals={1} suffix="%" hardMin={min} hardMax={max}
        sensitivity={(max - min) / 100}
        persistenceKey={`effect.${clipId ?? 'global'}.${effectInstanceId ?? 'guided-perspective'}.${key}`}
        onChange={value => onChange({ ...params, [key]: value })}
        keyframeToggle={clipId && effectInstanceId ? <EffectKeyframeToggle clipId={clipId} effectId={effectInstanceId} paramName={key} value={Number(params[key] ?? 100)} /> : undefined} />)}
    </ResolveInspectorSection>
  </div>;
}
