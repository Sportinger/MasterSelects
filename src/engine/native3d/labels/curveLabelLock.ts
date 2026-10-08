import type { CurveLabelSpec } from '../../../services/operators/geometry/curveLabels';
import { curveLabelEpisode, scanRandom } from './curveLabelSchedule';

export const LOCK_DOCK_SECONDS=.5, LOCK_RELEASE_SECONDS=.7;
export interface CurveLabelLockEvent { card:number; event:number; start:number; end:number; corner:number }
export interface CurveLabelLockState extends CurveLabelLockEvent { amount:number; age:number }
const schedules=new Map<string,CurveLabelLockEvent[]>();

/** Choose existing visible episodes: docking never resurrects a hidden card or changes audio cues. */
export function curveLabelLocks(spec:CurveLabelSpec):CurveLabelLockEvent[] {
  const key=[spec.count,spec.cycle,spec.dutyCycle,spec.transition,spec.introSpread,
    spec.lifetimeVariation,spec.scheduleSeed,spec.holdCount,spec.holdStart,spec.holdEnd,
    spec.lockCount,spec.lockStart,spec.lockInterval,spec.lockDuration].join(':');
  const cached=schedules.get(key);if(cached)return cached;
  const events:CurveLabelLockEvent[]=[],duration=LOCK_DOCK_SECONDS+spec.lockDuration+LOCK_RELEASE_SECONDS;
  for(let event=0;event<spec.lockCount;event++){
    const nominal=Math.max(spec.lockStart+event*spec.lockInterval,(events.at(-1)?.end??-1)+.3);
    const deadline=spec.lockStart+event*spec.lockInterval+spec.lockInterval*.4;
    const candidates:CurveLabelLockEvent[]=[];
    for(let card=0;card<spec.count;card++){
      let episode=curveLabelEpisode(spec,nominal,card);
      while(episode.birth<deadline){
        const start=Math.max(nominal,episode.birth+spec.transition),end=start+duration;
        if(start<=deadline&&end<=episode.birth+episode.visible-spec.transition){
          candidates.push({card,event,start,end,corner:(event+spec.scheduleSeed)%4});break;
        }
        episode=curveLabelEpisode(spec,episode.birth+episode.period+1e-7,card);
      }
    }
    const selected=candidates.toSorted((a,b)=>a.start-b.start||
      scanRandom(a.card+event*71+spec.scheduleSeed*97)-scanRandom(b.card+event*71+spec.scheduleSeed*97))[0];
    if(selected)events.push(selected);
  }
  schedules.set(key,events);if(schedules.size>32)schedules.delete(schedules.keys().next().value!);
  return events;
}
const smooth=(u:number)=>{const t=Math.max(0,Math.min(1,u));return t*t*t*(t*(t*6-15)+10);};
export function curveLabelLock(spec:CurveLabelSpec,time:number):CurveLabelLockState|undefined {
  if(!Number.isFinite(time))throw new Error('Curve Scan Labels: camera-lock time must be finite.');
  const event=curveLabelLocks(spec).find(e=>time>=e.start&&time<e.end);
  return event?{...event,age:time-event.start,amount:smooth((time-event.start)/LOCK_DOCK_SECONDS)*smooth((event.end-time)/LOCK_RELEASE_SECONDS)}:undefined;
}
/** Fast ticker stays confined to the locked window and restores normal readouts on release. */
export function curveLabelLockReadouts(lock:CurveLabelLockState):string[] {
  const streams=['PRIORITY SIGNAL // TRACK ACQUIRED // FIBER FLOW // ',
    'STRUCTURE SYNC // MOTION ACTIVE // LOOP ANALYSIS // ',
    'LIVE TELEMETRY // SIGNAL VERIFIED // STREAM LOCK // '];
  return ['    PRIORITY / LOCK',...streams.map((text,row)=>{
    const offset=Math.floor(lock.age*(38+row*9))%text.length;
    return (text+text).slice(offset,offset+20);
  })];
}
