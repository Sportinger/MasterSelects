import {activeCurveLabelTextCue} from '../../../services/operators/geometry/curveLabelTextCues';
import {parseCurveLabelIntro} from '../../../services/operators/geometry/curveLabelIntro';
import type {CurveLabelSpec} from '../../../services/operators/geometry/curveLabels';
import {HEADLINE_DECODE_FRAMES,HEADLINE_DECODE_SECONDS} from './curveLabelDecode';
import {curveLabelIntroState,type CurveLabelIntroState} from './curveLabelIntro';
import {curveLabelEpisode} from './curveLabelSchedule';
import {curveLabelActiveLocks} from './curveLabelLock';

/** Keep each authored headline on one existing card for the whole cue, including seeks. */
export function curveLabelTextState(spec:CurveLabelSpec,time:number):{
  headlines:CurveLabelIntroState[]; phrases:string[]; rows:Map<number,string[]>;
  limitedHeadlines:number[]; cueStart?:number;
} {
  const opening=curveLabelIntroState(spec,time),cue=activeCurveLabelTextCue(spec.textCues??'',time);
  const rows=new Map<number,string[]>(),limitedHeadlines:number[]=[];
  if(cue)for(let card=0;card<spec.count;card++)rows.set(card,cue.panels[card%cue.panels.length]);
  // Initial multilingual titles retain their original timing and atlas rows.
  if(opening.some(item=>item.card>=0&&item.pulse>-1))
    return {headlines:opening,phrases:parseCurveLabelIntro(spec.introTitles??'').flat(),rows,limitedHeadlines};
  if(!cue?.headlines?.length)return {headlines:opening,phrases:parseCurveLabelIntro(spec.introTitles??'').flat(),rows,limitedHeadlines};
  const locks=curveLabelActiveLocks(spec,cue.start);
  const candidates=Array.from({length:spec.count},(_,card)=>{
    const episode=curveLabelEpisode(spec,cue.start,card);
    const begin=episode.birth+spec.transition,end=episode.birth+episode.visible-spec.transition;
    return {card,locked:locks.some(lock=>lock.card===card),available:begin<=cue.start&&end>cue.start,overlap:Math.max(0,Math.min(end,cue.end)-Math.max(begin,cue.start))};
  }).toSorted((a,b)=>Number(b.available)-Number(a.available)||Number(a.locked)-Number(b.locked)||b.overlap-a.overlap||a.card-b.card);
  const elapsed=time-cue.start;
  const frame=Math.min(HEADLINE_DECODE_FRAMES-1,Math.floor(elapsed/HEADLINE_DECODE_SECONDS*HEADLINE_DECODE_FRAMES));
  const headlines=cue.headlines.map((h,index)=>{
    const candidate=candidates[index],card=candidate?.card??-1;
    if(!candidate||candidate.overlap<cue.end-cue.start-.01)limitedHeadlines.push(index);
    if(card>=0)rows.set(card,[h.header,'','',h.footer]);
    return {card,row:index*HEADLINE_DECODE_FRAMES+frame,pulse:Math.max(0,1-elapsed/.22)*.35};
  });
  return {headlines,phrases:cue.headlines.map(h=>h.text),rows,limitedHeadlines,cueStart:cue.start};
}
