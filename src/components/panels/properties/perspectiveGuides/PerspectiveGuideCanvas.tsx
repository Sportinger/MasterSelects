import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { MAX_GUIDES_PER_AXIS, type PerspectiveGuide } from '../../../../effects/distort/guided-perspective/guideGeometry';
import type { guidePhotoProjection } from './guidePhotoProjection';

interface Props {
  photoUrl: string; projection: ReturnType<typeof guidePhotoProjection>; screenScale: number;
  guides: PerspectiveGuide[]; axis: PerspectiveGuide['axis']; selected: number;
  drawingEnabled: boolean;
  setGuides: React.Dispatch<React.SetStateAction<PerspectiveGuide[]>>;
  setSelected: (index: number) => void; setNotice: (notice: string) => void;
}
interface Drag {
  index: number; endpoint: 'start'|'end'|'line'; previous: PerspectiveGuide[];
  origin: [number,number]; drawing: boolean; pointerId: number;
}
const clamp = (v: number) => Math.max(0, Math.min(1,v));
export function PerspectiveGuideCanvas({photoUrl, projection, screenScale, guides, axis, selected, drawingEnabled, setGuides, setSelected, setNotice}: Props) {
  const drag = useRef<Drag | null>(null);
  const point = (event: ReactPointerEvent<SVGSVGElement>): [number,number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return projection.sourcePoint((event.clientX-rect.left)/rect.width, (event.clientY-rect.top)/rect.height);
  };
  const start = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drawingEnabled || event.altKey || event.button !== 0 || drag.current) return;
    event.preventDefault(); event.stopPropagation();
    const target = (event.target as Element).closest<SVGElement>('[data-guide-index]');
    const index = target ? Number(target.dataset.guideIndex) : -1;
    const origin = point(event);
    if (index >= 0) {
      setSelected(index);
      drag.current = { index, endpoint: target?.dataset.endpoint as Drag['endpoint'] || 'line', previous: guides, origin, drawing:false, pointerId:event.pointerId };
    } else {
      if (origin.some(v => v < 0 || v > 1)) return;
      if (guides.filter(g => g.axis === axis).length >= MAX_GUIDES_PER_AXIS) {
        setNotice(`${MAX_GUIDES_PER_AXIS} ${axis} guides already exist. Move or delete a guide.`); return;
      }
      const [x,y] = origin;
      setGuides([...guides,{axis,x1:x,y1:y,x2:x,y2:y}]); setSelected(guides.length); setNotice('');
      drag.current = {index:guides.length,endpoint:'end',previous:guides,origin,drawing:true,pointerId:event.pointerId};
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const [x,y] = point(event), {index,endpoint} = current;
    setGuides(previous => previous.map((g,i) => {
      if (i !== index) return g;
      if (endpoint !== 'line') return {...g,...(endpoint === 'start' ? {x1:clamp(x),y1:clamp(y)} : {x2:clamp(x),y2:clamp(y)})};
      const base = current.previous[index];
      const dx = Math.max(-Math.min(base.x1,base.x2),Math.min(1-Math.max(base.x1,base.x2),x-current.origin[0]));
      const dy = Math.max(-Math.min(base.y1,base.y2),Math.min(1-Math.max(base.y1,base.y2),y-current.origin[1]));
      return {...base,x1:base.x1+dx,x2:base.x2+dx,y1:base.y1+dy,y2:base.y2+dy};
    }));
  };
  const finish = (event: ReactPointerEvent<SVGSVGElement>, cancelled = false) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    drag.current = null;
    if (cancelled) setGuides(current.previous);
    else if (current.drawing) setGuides(previous => previous.filter((g,i) => i !== current.index || Math.hypot(g.x2-g.x1,g.y2-g.y1) >= .015));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const {size,forward:m} = projection;
  return <svg viewBox={`0 0 ${size.width} ${size.height}`} aria-label="Draw perspective guides" role="group"
    onPointerDown={start} onPointerMove={move} onPointerUp={e=>finish(e)} onPointerCancel={e=>finish(e,true)} onLostPointerCapture={e=>finish(e,true)}
    onContextMenu={event => {
      event.preventDefault(); event.stopPropagation();
      const target = (event.target as Element).closest<SVGElement>('[data-guide-index]');
      if (!target) return;
      const index = Number(target.dataset.guideIndex); drag.current = null;
      setGuides(previous => previous.filter((_,i)=>i!==index)); setSelected(-1); setNotice('');
    }}>
    <image href={photoUrl} width="1" height="1" preserveAspectRatio="none" aria-label="Photo for perspective guides"
      transform={`matrix(${m[0]*size.width} ${m[3]*size.height} ${m[1]*size.width} ${m[4]*size.height} ${m[2]*size.width} ${m[5]*size.height})`} />
    {guides.map((guide,index) => {
      const [x1,y1] = projection.canvasPoint(guide.x1,guide.y1), [x2,y2] = projection.canvasPoint(guide.x2,guide.y2);
      return <g key={index} className={`perspective-guide-line ${guide.axis}${index===selected ? ' selected' : ''}`}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} className="perspective-guide-hit" data-guide-index={index} />
        <line x1={x1} y1={y1} x2={x2} y2={y2} className="perspective-guide-visible" />
        {(['start','end'] as const).map(endpoint => <circle key={endpoint} cx={endpoint==='start'?x1:x2} cy={endpoint==='start'?y1:y2}
          r={6/Math.max(.0001,screenScale)} data-guide-index={index} data-endpoint={endpoint} role="button" tabIndex={0}
          aria-label={`${guide.axis} guide ${index+1} ${endpoint}`} onFocus={()=>setSelected(index)}
          onKeyDown={event => {
            if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            const step = event.shiftKey ? 0.01 : 0.001;
            const dx = event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0;
            const dy = event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;
            setGuides(previous=>previous.map((g,i)=>i!==index?g:{...g,...(endpoint==='start'
              ?{x1:clamp(g.x1+dx),y1:clamp(g.y1+dy)}:{x2:clamp(g.x2+dx),y2:clamp(g.y2+dy)})}));
          }} />)}
      </g>;
    })}
  </svg>;
}
