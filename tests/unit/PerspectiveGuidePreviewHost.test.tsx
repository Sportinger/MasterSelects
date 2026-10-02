import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types';
import type { PerspectiveGuideEditorProps } from '../../src/components/panels/properties/perspectiveGuides/PerspectiveGuideEditor';
import { PerspectiveGuidePreviewHost } from '../../src/components/preview/PerspectiveGuidePreviewHost';
import { usePerspectiveGuideEditing } from '../../src/components/panels/properties/perspectiveGuides/perspectiveGuideEditing';

const state = vi.hoisted(()=>({
  timeline:{clips:[] as TimelineClip[],isPlaying:false,updateClipEffect:vi.fn()},
  media:{activeCompositionId:'comp',compositions:[{id:'comp',width:1000,height:1000}]},
  startBatch:vi.fn(),endBatch:vi.fn(),editorProps:undefined as PerspectiveGuideEditorProps | undefined,
}));
vi.mock('../../src/stores/timeline',()=>({useTimelineStore:Object.assign(
  (select:(s:typeof state.timeline)=>unknown)=>select(state.timeline),{getState:()=>state.timeline})}));
vi.mock('../../src/stores/mediaStore',()=>({useMediaStore:Object.assign(
  (select:(s:typeof state.media)=>unknown)=>select(state.media),{getState:()=>state.media})}));
vi.mock('../../src/stores/historyStore',()=>({startBatch:state.startBatch,endBatch:state.endBatch}));
vi.mock('../../src/components/panels/properties/perspectiveGuides/PerspectiveGuideEditor',()=>({
  PerspectiveGuideEditor:(props:PerspectiveGuideEditorProps)=>{
    state.editorProps=props;
    return <><button onClick={()=>props.onApply([{axis:'vertical',x1:.2,y1:0,x2:.2,y2:1}], [1,0,0,0,1,0,0,0,1])}>Apply draft</button>
      <button onClick={props.onCancel}>Cancel draft</button></>;
  },
}));
beforeEach(()=>{
  vi.clearAllMocks(); usePerspectiveGuideEditing.getState().end();
  state.timeline.isPlaying=false; state.media.activeCompositionId='comp';
});
function prepare() {
  const clip={id:'photo',file:new File(['photo'],'photo.jpg'),source:{type:'image'},
    transform:{position:{x:.2,y:0,z:0},scale:{x:1,y:1},rotation:{x:0,y:0,z:0},opacity:1},
    effects:[{id:'lens',type:'lens-correction',enabled:true,params:{distortion:1}},
      {id:'perspective',type:'guided-perspective',enabled:true,params:{guides:'[]',scale:150}}]} as TimelineClip;
  state.timeline.clips=[clip];
  const panel=document.createElement('div'); panel.className='preview-container'; panel.dataset.previewPanelId='preview';
  const wrapper=document.createElement('div'); panel.appendChild(wrapper);
  const props={wrapper:{current:wrapper},compositionId:'comp',selectedClip:clip,viewZoom:1,enabled:true};
  usePerspectiveGuideEditing.getState().begin({clipId:'photo',effectId:'perspective',compositionId:'comp',panelId:'preview'});
  const result=render(<PerspectiveGuidePreviewHost {...props}/>);
  return {...result,clip,props};
}
describe('Preview guide editing session',()=>{
  it('uses clip placement and saves guides and matrix together in one undoable change',()=>{
    const {clip}=prepare();
    expect(state.editorProps?.transform).toBe(clip.transform);
    expect(state.editorProps?.composition).toEqual({id:'comp',width:1000,height:1000});
    fireEvent.click(screen.getByText('Apply draft'));
    expect(state.startBatch).toHaveBeenCalledExactlyOnceWith('Guided Perspective');
    expect(state.timeline.updateClipEffect).toHaveBeenCalledExactlyOnceWith('photo','perspective',expect.objectContaining({matrix0:1,matrix8:1,guides:expect.any(String)}));
    expect(state.endBatch).toHaveBeenCalledOnce();
    expect(usePerspectiveGuideEditing.getState().target).toBeNull();
  });
  it('cancels without touching effects or history',()=>{
    prepare(); fireEvent.click(screen.getByText('Cancel draft'));
    expect(state.timeline.updateClipEffect).not.toHaveBeenCalled(); expect(state.startBatch).not.toHaveBeenCalled();
    expect(usePerspectiveGuideEditing.getState().target).toBeNull();
  });
  it('invalidates drafts on selection changes and rejects stale Apply callbacks',()=>{
    const {rerender,props}=prepare(), staleApply=state.editorProps!.onApply;
    rerender(<PerspectiveGuidePreviewHost {...props} selectedClip={null}/>);
    expect(screen.queryByText('Apply draft')).not.toBeInTheDocument();
    staleApply([], [1,0,0,0,1,0,0,0,1]);
    expect(state.timeline.updateClipEffect).not.toHaveBeenCalled();
    expect(usePerspectiveGuideEditing.getState().target).toBeNull();
  });
  it.each(['composition','upstream','placement','playing'] as const)('invalidates draft when %s changes',kind=>{
    const {rerender,props,clip}=prepare();
    if(kind==='composition')state.media.activeCompositionId='other';
    if(kind==='upstream')clip.effects[0].params={distortion:2};
    if(kind==='placement')clip.transform={...clip.transform,position:{x:.3,y:0,z:0}};
    if(kind==='playing')state.timeline.isPlaying=true;
    rerender(<PerspectiveGuidePreviewHost {...props}/>);
    expect(usePerspectiveGuideEditing.getState().target).toBeNull();
    expect(state.timeline.updateClipEffect).not.toHaveBeenCalled();
  });
});
