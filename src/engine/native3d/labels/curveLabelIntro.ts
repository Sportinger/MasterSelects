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
    const progress=episode?Math.max(0,(time-episode.birth)/episode.visible):0;
    let variant=0,pulse=0;
    for(let i=1;i<words.length;i++){
      const change=.55+(i-1)*.35/Math.max(1,words.length-1);
      if(progress>=change){variant=i;const elapsed=(progress-change)*episode!.visible;pulse=Math.max(0,1-elapsed/.22);}
    }
    const row=offset+variant;offset+=words.length;
    return {card:active?card:-1,row,pulse};
  });
}
