import {curveLabelStackWindow} from './curveLabelStack';
import type { CurveLabelSpec } from '../../../services/operators/geometry/curveLabels';

export interface CurveLabelEpisode { birth:number; period:number; visible:number; cycle:number }
/** Integer hashing keeps the authored schedule identical across machines and seek order. */
export function scanRandom(seed:number):number {
  let n=seed|0;n=Math.imul(n^(n>>>16),0x21f0aaad);n=Math.imul(n^(n>>>15),0x735a2d97);
  return ((n^(n>>>15))>>>0)/4294967296;
}
export function curveLabelOpeningRank(spec:CurveLabelSpec,card:number):number {
  let rank=card;
  if(spec.lifetimeVariation>0){
    const order=Array.from({length:spec.count},(_,i)=>i).toSorted((a,b)=>scanRandom(a+spec.scheduleSeed*97)-scanRandom(b+spec.scheduleSeed*97));
    rank=order.indexOf(card);
  }
  return rank;
}
function opening(spec:CurveLabelSpec,card:number):number {
  const rank=curveLabelOpeningRank(spec,card);
  return spec.introSpread>0?spec.introSpread*Math.log2(rank+1)/Math.log2(Math.max(2,spec.count)):-rank*.173*spec.cycle;
}
const schedules=new Map<string,CurveLabelEpisode[]>();
function next(spec:CurveLabelSpec,card:number,birth:number,cycle:number):CurveLabelEpisode {
  const seed=spec.scheduleSeed*7919+card*104729+cycle*15485863,amount=spec.lifetimeVariation;
  const baseline=spec.cycle*spec.dutyCycle;
  let visible=baseline*(1+amount*(scanRandom(seed+1)*.9-.45));
  let pause=spec.cycle*(1-spec.dutyCycle)*(1+amount*(scanRandom(seed+2)*1.2-.6));
  // Preserve a complete intro/outro even for a short randomized appearance.
  visible=Math.max(Math.min(2*spec.transition,baseline),visible);
  pause=Math.max(0,pause);
  const windows:Array<[number,number]>=[];
  if(card<spec.holdCount&&spec.holdEnd>spec.holdStart)windows.push([spec.holdStart,spec.holdEnd]);
  if(spec.finalEnd>spec.finalStart)windows.push([spec.finalStart+card*spec.finalStagger,spec.finalEnd]);
  const stack=curveLabelStackWindow(spec,card);if(stack)windows.push(stack);
  for(const [start,end] of windows.toSorted((a,b)=>a[0]-b[0]))
    if(birth<=start-spec.transition&&birth+visible+pause>=start-spec.transition)
      visible=Math.max(visible,end+spec.transition-birth);
  return {birth,visible,period:visible+pause,cycle};
}
/** One schedule is shared by CPU text, GPU reveal and offline audio cue generation. */
export function curveLabelEpisode(spec:CurveLabelSpec,time:number,card:number):CurveLabelEpisode {
  if(!Number.isFinite(time)&&time!==-Infinity)throw new Error('Curve Scan Labels: schedule time must be finite.');
  const birth=opening(spec,card);
  if(!(spec.finalEnd>spec.finalStart)&&spec.lifetimeVariation===0&&!(card<spec.holdCount&&spec.holdEnd>spec.holdStart)&&!curveLabelStackWindow(spec,card)){
    const cycle=Math.max(0,Math.floor((time-birth)/spec.cycle));
    return {birth:birth+cycle*spec.cycle,period:spec.cycle,visible:spec.cycle*spec.dutyCycle,cycle};
  }
  const key=[card,spec.count,spec.cycle,spec.dutyCycle,spec.transition,spec.introSpread,spec.lifetimeVariation,spec.scheduleSeed,spec.holdCount,spec.holdStart,spec.holdEnd,spec.stackCount,spec.stackStart,spec.stackEnd,spec.stackStagger,spec.finalStart,spec.finalEnd,spec.finalStagger].join(':');
  let episodes=schedules.get(key);
  if(!episodes){episodes=[next(spec,card,birth,0)];schedules.set(key,episodes);if(schedules.size>48)schedules.delete(schedules.keys().next().value!);}
  while(episodes.at(-1)!.birth+episodes.at(-1)!.period<=time){
    const last=episodes.at(-1)!;episodes.push(next(spec,card,last.birth+last.period,last.cycle+1));
  }
  let lo=0,hi=episodes.length-1;
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(episodes[mid].birth<=time)lo=mid;else hi=mid-1;}
  return episodes[lo];
}
export function curveLabelReveal(spec:CurveLabelSpec,time:number,episode:CurveLabelEpisode):{phase:number;reveal:number} {
  const phase=Math.max(0,time-episode.birth),duration=Math.min(spec.transition,episode.visible/2);
  return {phase,reveal:time<episode.birth?0:Math.max(0,Math.min(1,phase/duration,(episode.visible-phase)/duration))};
}
export interface CurveLabelCue { card:number; cycle:number; kind:'intro'|'outro'; time:number }
export function curveLabelCues(spec:CurveLabelSpec,start:number,end:number):CurveLabelCue[] {
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)throw new Error('Curve Scan Labels: cue range must be finite and ordered.');
  const events:CurveLabelCue[]=[];
  for(let card=0;card<spec.count;card++){
    let episode=curveLabelEpisode(spec,start,card);
    while(episode.birth<end){
      for(const [kind,time] of [['intro',episode.birth],['outro',episode.birth+episode.visible-Math.min(spec.transition,episode.visible/2)]] as const)
        if(time>=start&&time<end)events.push({card,cycle:episode.cycle,kind,time});
      episode=curveLabelEpisode(spec,episode.birth+episode.period+1e-8,card);
    }
  }
  return events.toSorted((a,b)=>a.time-b.time||a.card-b.card);
}
