import {describe,it,expect} from 'vitest';
import {CURVE_LABEL_OPERATOR,readCurveLabels} from '../../src/services/operators/geometry/curveLabels';
import {curveLabelCues,curveLabelEpisode,curveLabelReveal} from '../../src/engine/native3d/labels/curveLabelSchedule';
const defaults=Object.fromEntries(CURVE_LABEL_OPERATOR.parameters.map(p=>[p.id,p.default]));
const spec=()=>readCurveLabels(id=>({...defaults,count:12,height:.11,introSpread:5,lifetimeVariation:1,scheduleSeed:17,holdCount:2,holdStart:22,holdEnd:27})[id]);

describe('independent scan appearances and audio cue schedule',()=>{
 it('randomizes opening order while retaining the accelerating build-up',()=>{
  const s=spec(),births=Array.from({length:s.count},(_,i)=>curveLabelEpisode(s,0,i).birth);
  const sorted=births.toSorted((a,b)=>a-b);
  expect(births).not.toEqual(sorted);expect(sorted[0]).toBe(0);expect(sorted.at(-1)).toBeCloseTo(5);
  for(let i=2;i<sorted.length;i++)expect(sorted[i]-sorted[i-1]).toBeLessThan(sorted[i-1]-sorted[i-2]);
 });
 it('varies individual lifetimes, gaps and recurring order without collective pauses',()=>{
  const s=spec(),cues=curveLabelCues(s,0,59);
  for(let card=0;card<12;card++){
   const episodes=cues.filter(c=>c.card===card&&c.kind==='intro').map(c=>curveLabelEpisode(s,c.time+.0001,card));
   expect(new Set(episodes.map(e=>e.visible.toFixed(3))).size).toBeGreaterThan(3);
   expect(new Set(episodes.map(e=>(e.period-e.visible).toFixed(3))).size).toBeGreaterThan(3);
  }
  const orders=[0,1,2].map(cycle=>cues.filter(c=>c.kind==='intro'&&c.cycle===cycle).map(c=>c.card));
  expect(orders[0]).not.toEqual(orders[1]);expect(orders[1]).not.toEqual(orders[2]);
  for(let t=5;t<59;t+=.1){
   const active=Array.from({length:12},(_,card)=>curveLabelReveal(s,t,curveLabelEpisode(s,t,card)).reveal).filter(r=>r>.01);
   expect(active.length).toBeGreaterThanOrEqual(2);
  }
  for(let i=1;i<cues.length;i++)expect(cues[i].time-cues[i-1].time).toBeLessThan(3);
 });
 it('keeps two cards fully visible throughout the requested tracking hold',()=>{
  const s=spec();
  for(let t=22;t<=27;t+=1/60)for(const card of [0,1])expect(curveLabelReveal(s,t,curveLabelEpisode(s,t,card)).reveal).toBe(1);
  expect(curveLabelCues(s,22,27).filter(c=>c.card<2)).toEqual([]);
 });
 it('emits an intro/outro for every episode at the same boundaries used for GPU reveal',()=>{
  const s=spec(),cues=curveLabelCues(s,0,59);
  expect(cues.length).toBeGreaterThan(150);
  for(const cue of cues){
   const episode=curveLabelEpisode(s,cue.time+1e-7,cue.card);
   if(cue.kind==='intro')expect(cue.time).toBeCloseTo(episode.birth,8);
   else expect(cue.time).toBeCloseTo(episode.birth+episode.visible-s.transition,8);
  }
  for(const time of [42,1,58,22,12,42])for(let card=0;card<12;card++)curveLabelEpisode(s,time,card);
  expect(curveLabelCues(s,0,59)).toEqual(cues);
  expect(()=>curveLabelEpisode(s,Infinity,0)).toThrow(/finite/);
 });
});
