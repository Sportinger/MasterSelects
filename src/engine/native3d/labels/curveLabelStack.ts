import type {CurveLabelSpec} from '../../../services/operators/geometry/curveLabels';
import type {CurveLabelLockState} from './curveLabelLock';
export const LOCK_DOCK_SECONDS=.5, LOCK_RELEASE_SECONDS=.7;
export const dockingEase=(u:number)=>{const t=Math.max(0,Math.min(1,u));return t*t*t*(t*(t*6-15)+10);};
/** A reserved camera-space column on each lower side. Its hold also enters the shared appearance schedule. */
export function curveLabelStackWindow(spec:CurveLabelSpec,card:number):[number,number]|undefined {
  if(card>=(spec.stackCount??0)*2||spec.stackEnd<=spec.stackStart)return;
  const delay=card*(spec.stackStagger??0);
  return [spec.stackStart+delay,spec.stackEnd+delay];
}
export function curveLabelStackEnd(spec:CurveLabelSpec):number {
  return spec.stackEnd+Math.max(0,(spec.stackCount??0)*2-1)*(spec.stackStagger??0);
}
export function curveLabelStackLocks(spec:CurveLabelSpec,time:number):CurveLabelLockState[] {
  if(!Number.isFinite(time))throw new Error('Curve Scan Labels: camera-stack time must be finite.');
  return Array.from({length:Math.min(spec.count,(spec.stackCount??0)*2)},(_,card)=>{
    const [windowStart,end]=curveLabelStackWindow(spec,card)!;
    const start=windowStart+((spec.stackStagger??0)>0?0:Math.floor(card/2)*.08);
    return {card,event:-1,start,end,corner:2+card%2,age:time-start,
      amount:dockingEase((time-start)/LOCK_DOCK_SECONDS)*dockingEase((end-time)/LOCK_RELEASE_SECONDS)};
  }).filter(event=>time>=event.start&&time<event.end);
}
