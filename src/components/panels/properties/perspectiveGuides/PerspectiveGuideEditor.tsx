import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Effect } from '../../../../types/effects';
import type { ClipTransform } from '../../../../types/timelineCore';
import { solveGuidedPerspective, type Matrix3, type PerspectiveGuide } from '../../../../effects/distort/guided-perspective/guideGeometry';
import { createGuidedPhotoPreview } from '../../../../services/rawImage/guidedPhotoPreview';
import { guidePhotoProjection } from './guidePhotoProjection';
import { PerspectiveGuideCanvas } from './PerspectiveGuideCanvas';
import './PerspectiveGuides.css';

export interface PerspectiveGuideEditorProps {
  file: File; effects: Effect[]; effectId?: string; initialGuides: PerspectiveGuide[];
  composition?: {width:number;height:number}; transform?: ClipTransform;
  controlsTarget?: HTMLElement | null; viewZoom?: number;
  onCancel: () => void; onApply: (guides: PerspectiveGuide[], inverse: Matrix3) => void;
}
export function PerspectiveGuideEditor({file,effects,effectId,initialGuides,composition,transform,controlsTarget,viewZoom=1,onCancel,onApply}: PerspectiveGuideEditorProps) {
  const editor = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null);
  const [size,setSize] = useState({width:1,height:1});
  useEffect(()=>{
    const element=stage.current;
    if(!element)return;
    const measure=()=>setSize({width:element.clientWidth,height:element.clientHeight});
    measure(); const observer=new ResizeObserver(measure); observer.observe(element);
    return ()=>observer.disconnect();
  },[]);
  const [guides,setGuides] = useState(initialGuides), [axis,setAxis] = useState<PerspectiveGuide['axis']>('vertical');
  const [selected,setSelected] = useState(-1), [notice,setNotice] = useState(''), [loadError,setLoadError] = useState('');
  const [space,setSpace] = useState(false);
  const [photo,setPhoto] = useState<{url:string;aspect:number;sourceWidth:number;sourceHeight:number}>();
  const index = effects.findIndex(effect=>effect.id===effectId);
  const upstreamKey = JSON.stringify(effects.slice(0,index<0?0:index).filter(effect=>effect.enabled&&effect.type==='lens-correction'));
  useEffect(() => {
    let active = true, url: string | undefined;
    setPhoto(undefined); setLoadError('');
    void createGuidedPhotoPreview(file,JSON.parse(upstreamKey) as Effect[],4096).then(result => {
      if (!active) return;
      url=URL.createObjectURL(result.blob); setPhoto({...result,url});
    }).catch(error=>{if(active)setLoadError(error instanceof Error?error.message:String(error));});
    return ()=>{active=false;if(url)URL.revokeObjectURL(url);};
  },[file,upstreamKey]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    editor.current?.focus({preventScroll:true});
    return ()=>{if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[]);
  const projection = useMemo(() => {
    if (!photo) return {};
    try { return {value:guidePhotoProjection(photo.sourceWidth ?? photo.aspect*1000,photo.sourceHeight ?? 1000,composition,transform)}; }
    catch(error){return {error:error instanceof Error?error.message:String(error)};}
  },[photo,composition,transform]);
  const solution = useMemo(() => {
    try { return {matrix:solveGuidedPerspective(guides,photo?.aspect??1).inverse,error:''}; }
    catch(error){return {matrix:undefined,error:error instanceof Error?error.message:String(error)};}
  },[guides,photo?.aspect]);
  const canvas = projection.value?.size ?? {width:1,height:1};
  const fit = Math.min(size.width/canvas.width,size.height/canvas.height);
  const removeSelected = () => {setGuides(previous=>previous.filter((_,i)=>i!==selected));setSelected(-1);setNotice('');};
  const help = notice || solution.error || 'Wheel / pinch to zoom. Alt / middle-button / Space + drag to pan. Right-click a guide to delete.';
  const controls = <div className="perspective-guide-tools" role="toolbar" aria-label="Guided Perspective controls">
    {(['vertical','horizontal'] as const).map(direction=><button key={direction} type="button" className="perspective-action"
      aria-label={`${direction==='vertical'?'Vertical':'Horizontal'} (${guides.filter(g=>g.axis===direction).length}/8)`}
      title={`${direction==='vertical'?'Vertical':'Horizontal'} guides: ${guides.filter(g=>g.axis===direction).length}/8`}
      aria-pressed={axis===direction} onPointerUp={()=>editor.current?.focus({preventScroll:true})}
      onClick={()=>{setAxis(direction);setNotice('');}}>{direction==='vertical'?'Vertical':'Horizontal'}</button>)}
    <button className="perspective-action primary" type="button" aria-label="Apply correction" title={help}
      disabled={!photo||!projection.value||!solution.matrix} onPointerUp={()=>editor.current?.focus({preventScroll:true})}
      onClick={()=>{if(solution.matrix)onApply(guides,solution.matrix);}}>Apply</button>
    <button className="perspective-action" type="button" onPointerUp={()=>editor.current?.focus({preventScroll:true})} onClick={onCancel}>Cancel</button>
    <button className="perspective-action" type="button" onPointerUp={()=>editor.current?.focus({preventScroll:true})}
      onClick={()=>{setGuides([]);setSelected(-1);setNotice('');}}>Clear guides</button>
    <span role="status" className="perspective-guide-status">{help}</span>
  </div>;
  return <div ref={editor} className="perspective-guide-editor" role="region" aria-label="Guided Perspective guides" tabIndex={-1}
    onMouseDown={event=>event.stopPropagation()} onContextMenu={event=>{event.preventDefault();event.stopPropagation();}}
    onKeyDown={event=>{
      event.stopPropagation();
      if(event.key==='Escape'){event.preventDefault();onCancel();}
      if(event.code==='Space'&&!(event.target instanceof Element&&event.target.closest('button'))){event.preventDefault();setSpace(true);}
      if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();removeSelected();}
    }} onKeyUp={event=>{event.stopPropagation();if(event.code==='Space'){event.preventDefault();setSpace(false);}}}
    onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node | null))setSpace(false);}}>
    {controlsTarget ? createPortal(controls,controlsTarget) : controls}
    <div className="perspective-guide-stage" ref={stage} data-guide-pan={space?'true':undefined}
      onPointerDownCapture={()=>editor.current?.focus({preventScroll:true})}>
      {photo&&projection.value ? <div className="perspective-guide-image" style={{width:canvas.width*fit,height:canvas.height*fit,
        left:'50%',top:'50%',transform:'translate(-50%,-50%)'}}>
        <PerspectiveGuideCanvas photoUrl={photo.url} projection={projection.value} screenScale={fit*viewZoom}
          guides={guides} axis={axis} selected={selected} drawingEnabled={!space}
          setGuides={setGuides} setSelected={setSelected} setNotice={setNotice} />
      </div> : <p role="status">{loadError||projection.error||'Preparing lens-corrected photo…'}</p>}
    </div>
  </div>;
}
