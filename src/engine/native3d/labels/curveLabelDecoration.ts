import {curveLabelEpisode} from './curveLabelSchedule';
import type {CurveLabelSpec} from '../../../services/operators/geometry/curveLabels';
import {curveLabelLife} from './curveLabelLayout';
const random=(seed:number)=>{const n=Math.sin(seed*12.9898+78.233)*43758.5453;return n-Math.floor(n);};
const smooth=(x:number)=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);};
/** Stateless episodes remain identical on seeks and export; short cycles simply omit echoes. */
export function curveLabelDecoration(spec:CurveLabelSpec,time:number,card:number) {
  const {birth,visible,cycle}=curveLabelEpisode(spec,time,card),age=time-birth;
  const {phase,reveal}=curveLabelLife(spec,time,card);
  const seed=card*31+cycle*127;
  let copies=0,fade=0,bold=0;
  const room=visible-2*spec.transition-.4;
  if(age>=0&&room>=2.4&&(card+cycle*3)%5===0&&spec.echoStrength>0){
    const duration=Math.min(room,2.4+2.4*random(seed+4));
    const start=spec.transition+.2+random(seed+9)*(room-duration);
    const local=phase-start;
    if(local>0&&local<duration){
      copies=6+Math.floor(random(seed+19)*15);
      fade=smooth(local/.18)*smooth((duration-local)/.8)*spec.echoStrength;
    }
  }
  if(age>=0&&reveal===1&&spec.boldFlashes>0){
    const start=spec.transition+.1+random(seed+37)*Math.max(0,visible-2*spec.transition-.5);
    const local=phase-start;
    bold=smooth(local/.035)*smooth((.18-local)/.06)*spec.boldFlashes;
  }
  return {copies,fade,bold};
}
