import type { TimelineClip } from '../../types/timeline';
import type { SurfaceSample } from '../../types/planarTracking';
import type { Keyframe } from '../../types/keyframes';
import { surfaceSourceTime } from './surfaceEffects';

/** Find an output frame displaying this source sample, including reverse/retimed clips. */
export function trackingTimelineTime(clip:TimelineClip,sample:SurfaceSample,keys:Keyframe[],fps:number,current:number):number {
  const count=Math.min(36000,Math.ceil(clip.duration*fps));
  let best=Math.max(0,Math.min(clip.duration,current-clip.startTime)),error=Infinity;
  for(let i=0;i<count;i++) {
    const local=i/fps,source=surfaceSourceTime(clip,local,keys);
    const end=sample.time+(sample.duration??1/fps);
    const distance=source>=sample.time-1e-6&&source<end-1e-6?0:Math.abs(source-sample.time);
    if(distance<error || distance===error&&Math.abs(local-(current-clip.startTime))<Math.abs(best-(current-clip.startTime))) {best=local;error=distance;}
  }
  return clip.startTime+best;
}
