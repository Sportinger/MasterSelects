import { useRef, useState } from 'react';
import { useTrackingEditorStore } from '../../../stores/trackingEditorStore';
import type { SurfacePoint } from '../../../types/planarTracking';
import { MAX_OBJECT_POINTS } from '../../../services/objectTracking/objectContour';

export function ObjectTrackingOverlay({points,width,height,disabled,toComposition,toSource,showOutline=true}:{
  showOutline?:boolean;points:SurfacePoint[];width:number;height:number;disabled:boolean;
  toComposition:(point:SurfacePoint)=>SurfacePoint;toSource:(point:SurfacePoint)=>SurfacePoint;
}) {
  const editor=useTrackingEditorStore(),drag=useRef<number|null>(null);
  const [cursor,setCursor]=useState({x:.5,y:.5});
  const picking=editor.tool==='pick-object'||editor.tool==='inspect',editing=editor.tool==='object',interactive=!disabled&&(!editor.actionBusy||editor.tool==='pick-object');
  const displayed=points.map(toComposition);
  const update=(next:SurfacePoint[])=>editor.setEditor({contourDraft:next});
  const clamp=(p:SurfacePoint)=>({x:Math.max(0,Math.min(1,p.x)),y:Math.max(0,Math.min(1,p.y))});
  const eventPoint=(e:{clientX:number;clientY:number},element:Element)=>{
    const rect=element.getBoundingClientRect();return toSource({x:(e.clientX-rect.left)/rect.width,y:(e.clientY-rect.top)/rect.height});
  };
  const move=(index:number,p:SurfacePoint)=>update(points.map((v,i)=>i===index?clamp(p):v));
  const insert=(index:number,p:SurfacePoint)=>{if(points.length<MAX_OBJECT_POINTS)update([...points.slice(0,index+1),clamp(p),...points.slice(index+1)]);};
  const remove=(index:number)=>{if(points.length>3)update(points.filter((_,i)=>i!==index));};
  const prompt=(p:SurfacePoint,subtract:boolean)=>{
    if(p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1)editor.setEditor({tool:'pick-object',objectPrompts:[...useTrackingEditorStore.getState().objectPrompts,{...p,label:subtract?0:1}]});
  };
  return <svg className="tracking-preview-layer tracking-preview-handles" width={width} height={height} viewBox={`0 0 ${width} ${height}`}
    role="group" aria-label="Object selection canvas" tabIndex={picking&&interactive?0:undefined}
    style={{pointerEvents:interactive&&(picking||editing)?'auto':'none',cursor:picking?'crosshair':undefined}}
    onKeyDown={e=>{
      if(!interactive||!picking)return;
      if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();prompt(cursor,e.ctrlKey||e.metaKey||editor.objectSubtract);return;}
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
      e.preventDefault();e.stopPropagation();const step=e.shiftKey?.05:.01;
      setCursor(p=>clamp({x:p.x+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0),y:p.y+(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0)}));
    }}
    onPointerDown={e=>{
      if(!interactive||!picking)return;e.preventDefault();e.stopPropagation();
      const p=eventPoint(e,e.currentTarget);
      prompt(p,e.ctrlKey||e.metaKey||editor.objectSubtract);
    }}
    onPointerMove={e=>{if(interactive&&editing&&drag.current!==null)move(drag.current,eventPoint(e,e.currentTarget));}}
    onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
    {showOutline&&<polygon points={displayed.map(p=>`${p.x*width},${p.y*height}`).join(' ')} stroke="#50c8ff" strokeWidth={1.5} fill={editing||picking?'#50c8ff18':'none'}/>}
    {picking&&editor.objectPrompts.map((prompt,i)=>{const p=toComposition(prompt);return <g key={i} transform={`translate(${p.x*width},${p.y*height})`} style={{pointerEvents:'none'}}>
      <circle r={5} style={{fill:prompt.label?'#36c987':'#ff625f',stroke:'#fff',strokeWidth:1}}/>
      <path d={prompt.label?'M -3 0 H 3 M 0 -3 V 3':'M -3 0 H 3'} stroke="#fff"/>
    </g>;})}
    {picking&&<circle className="object-selection-keyboard-cursor" cx={toComposition(cursor).x*width} cy={toComposition(cursor).y*height} r={8} style={{pointerEvents:'none',fill:'none',stroke:'#fff',strokeDasharray:'2 2'}}/>}
    {interactive&&editing&&displayed.map((p,i)=>{
      const next=displayed[(i+1)%points.length],a=points[i],b=points[(i+1)%points.length];
      return <line key={`edge:${i}`} x1={p.x*width} y1={p.y*height} x2={next.x*width} y2={next.y*height} stroke="transparent" strokeWidth={14}
        style={{cursor:'copy'}} aria-label={`Add point on object edge ${i+1}`} role="button" tabIndex={points.length<MAX_OBJECT_POINTS?0:-1}
        onPointerDown={e=>{e.preventDefault();e.stopPropagation();insert(i,eventPoint(e,e.currentTarget.ownerSVGElement!));}}
        onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();insert(i,{x:(a.x+b.x)/2,y:(a.y+b.y)/2});}}}/>;
    })}
    {interactive&&editing&&displayed.map((p,i)=><circle key={i} cx={p.x*width} cy={p.y*height} r={6} role="slider" tabIndex={0}
      aria-label={`Object point ${i+1}`} aria-valuetext={`${(points[i].x*100).toFixed(1)}%, ${(points[i].y*100).toFixed(1)}%`}
      onPointerDown={e=>{e.preventDefault();e.stopPropagation();if(e.altKey){remove(i);return;}drag.current=i;e.currentTarget.setPointerCapture(e.pointerId);}}
      onKeyDown={e=>{
        if(['Delete','Backspace'].includes(e.key)){e.preventDefault();e.stopPropagation();remove(i);return;}
        if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
        e.preventDefault();e.stopPropagation();const step=e.shiftKey?.01:.001;
        move(i,{x:points[i].x+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0),y:points[i].y+(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0)});
      }}/>) }
  </svg>;
}
