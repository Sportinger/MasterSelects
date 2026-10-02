import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TimelineClip } from '../../types';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { startBatch, endBatch } from '../../stores/historyStore';
import { parsePerspectiveGuides, type Matrix3, type PerspectiveGuide } from '../../effects/distort/guided-perspective/guideGeometry';
import { PerspectiveGuideEditor } from '../panels/properties/perspectiveGuides/PerspectiveGuideEditor';
import { usePerspectiveGuideEditing } from '../panels/properties/perspectiveGuides/perspectiveGuideEditing';
import { getFirstEditablePreviewPanelId, getPreviewPanelIdFromElement } from './previewPanelDom';

interface Props {
  wrapper: React.RefObject<HTMLDivElement | null>; compositionId: string | null; selectedClip: TimelineClip | null;
  viewZoom?: number; enabled: boolean;
}
export function PerspectiveGuidePreviewHost(props: Props) {
  const target = usePerspectiveGuideEditing(state=>state.target);
  const panelId = getPreviewPanelIdFromElement(props.wrapper.current);
  if (!target || panelId !== (target.panelId ?? getFirstEditablePreviewPanelId())) return null;
  return <GuideSession key={target.id} {...props} target={target} />;
}
function GuideSession({target,wrapper,selectedClip:clip,compositionId,viewZoom,enabled}: Props & {
  target: NonNullable<ReturnType<typeof usePerspectiveGuideEditing.getState>['target']>;
}) {
  const activeCompositionId = useMediaStore(state=>state.activeCompositionId);
  const composition = useMediaStore(state=>state.compositions.find(item=>item.id===target.compositionId));
  const playing = useTimelineStore(state=>state.isPlaying);
  const [controlsTarget,setControlsTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(()=>{
    setControlsTarget(wrapper.current?.closest('.preview-container')?.querySelector<HTMLElement>('.perspective-guide-transport-slot') ?? null);
  },[wrapper]);
  const effect = clip?.effects.find(item=>item.id===target.effectId&&item.type==='guided-perspective');
  const initialFile = useRef(clip?.file);
  const signature = JSON.stringify([clip?.transform,clip?.effects.slice(0,clip.effects.findIndex(item=>item.id===target.effectId)+1)]);
  const initialSignature = useRef(signature);
  const valid = enabled && !playing && compositionId===target.compositionId && activeCompositionId===target.compositionId
    && clip?.id===target.clipId && clip.source?.type==='image' && !!effect && clip.file===initialFile.current && signature===initialSignature.current;
  const end = () => usePerspectiveGuideEditing.getState().end(target.id);
  useEffect(()=>{if(!valid)usePerspectiveGuideEditing.getState().end(target.id);},[valid,target.id]);
  if(!valid||!clip||!effect)return null;
  const apply = (guides: PerspectiveGuide[],inverse: Matrix3) => {
    const timeline=useTimelineStore.getState(), latest=timeline.clips.find(item=>item.id===target.clipId);
    if(usePerspectiveGuideEditing.getState().target?.id!==target.id||useMediaStore.getState().activeCompositionId!==target.compositionId||latest?.file!==initialFile.current)return;
    if(JSON.stringify([latest?.transform,latest?.effects.slice(0,latest.effects.findIndex(item=>item.id===target.effectId)+1)])!==initialSignature.current)return;
    startBatch('Guided Perspective');
    try {timeline.updateClipEffect(target.clipId,target.effectId,{guides:JSON.stringify(guides),
      ...Object.fromEntries(inverse.map((value,i)=>[`matrix${i}`,value]))});} finally {endBatch();}
    end();
  };
  return <div className="perspective-preview-editor">
    <PerspectiveGuideEditor file={clip.file} effects={clip.effects} effectId={target.effectId}
      composition={composition} transform={clip.transform} controlsTarget={controlsTarget} viewZoom={viewZoom}
      initialGuides={parsePerspectiveGuides(effect.params.guides)} onCancel={end} onApply={apply} />
  </div>;
}
