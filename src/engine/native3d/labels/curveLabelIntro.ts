import {HEADLINE_DECODE_FRAMES,HEADLINE_DECODE_SECONDS} from './curveLabelDecode';
import {parseCurveLabelIntro} from '../../../services/operators/geometry/curveLabelIntro';
import type {CurveLabelSpec} from '../../../services/operators/geometry/curveLabels';
import {curveLabelEpisode,curveLabelOpeningRank} from './curveLabelSchedule';

export interface CurveLabelIntroState { card:number; row:number; pulse:number }
/** Initial episodes only, selected by the same randomized schedule as rings and sound cues. */
export function curveLabelIntroState(spec:CurveLabelSpec,time:number):CurveLabelIntroState[] {
  const phrases=parseCurveLabelIntro(spec.introTitles??'');
  let offset=0;
  return phrases.map((words,rank)=>{
    const card=Array.from({length:spec.count},(_,i)=>i).find(i=>curveLabelOpeningRank(spec,i)===rank)??-1;
    const episode=card<0?null:curveLabelEpisode(spec,time,card);
    const active=episode&&episode.cycle===0&&time<episode.birth+episode.visible;
    // Keep the card episode (and its audio) intact; the large decoded words
    // finish early and give way to ordinary readouts within the same frame.
    const age=episode?Math.max(0,time-episode.birth):0;
    const start=Math.min(.18,(episode?.visible??1)*.05);
    const slot=Math.min(words.length>3?.65:1.05,Math.max(.01,((episode?.visible??1)-start-.22)/words.length));
    const local=Math.max(0,age-start),variant=Math.min(words.length-1,Math.floor(local/slot));
    const elapsed=local-variant*slot;
    const decode=Math.min(HEADLINE_DECODE_SECONDS,slot*.55);
    const frame=Math.min(HEADLINE_DECODE_FRAMES-1,Math.floor(elapsed/decode*HEADLINE_DECODE_FRAMES));
    const fade=Math.max(0,Math.min(1,(local-words.length*slot)/.22));
    // Negative pulse encodes the short final fade, without expanding GPU uniforms.
    const pulse=fade>0?-fade:Math.max(0,1-elapsed/.22)*.35;
    const row=(offset+variant)*HEADLINE_DECODE_FRAMES+frame;offset+=words.length;
    return {card:active?card:-1,row,pulse};
  });
}
