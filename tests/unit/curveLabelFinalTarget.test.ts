import {describe,it,expect} from 'vitest';
import {CURVE_LABEL_OPERATOR,readCurveLabels,isCurveLabels} from '../../src/services/operators/geometry/curveLabels';
import {curveLabelEpisode,curveLabelReveal} from '../../src/engine/native3d/labels/curveLabelSchedule';
import {curveLabelFinalUniforms} from '../../src/engine/native3d/labels/curveLabelFinalTarget';
const defaults=Object.fromEntries(CURVE_LABEL_OPERATOR.parameters.map(p=>[p.id,p.default]));
const base=()=>readCurveLabels(id=>defaults[id]);
describe('final material target',()=>{
 it('preserves legacy labels and defaults to no final takeover',()=>{
  const legacy={...defaults};for(const key of Object.keys(legacy))if(key.startsWith('final'))delete legacy[key];
  const s=readCurveLabels(id=>legacy[id]);
  expect(isCurveLabels(s)).toBe(true);
  expect([...curveLabelFinalUniforms(Uint32Array.of(0),Uint32Array.of(2),s)]).toEqual(new Array(12).fill(0));
 });
 it('holds every staggered acquisition through a common outro and stays seek-independent',()=>{
  const s={...base(),count:12,height:.1,lifetimeVariation:1,scheduleSeed:17,introSpread:5,
   finalStart:52.6,finalEnd:58.5,finalStagger:.35,finalTransition:.6};
  for(let card=0;card<s.count;card++){
   const acquisition=s.finalStart+card*s.finalStagger;
   for(const time of [58.5,acquisition,57.8,acquisition+.6])
    expect(curveLabelReveal(s,time,curveLabelEpisode(s,time,card)).reveal).toBeCloseTo(1,8);
   expect(curveLabelReveal(s,58.95,curveLabelEpisode(s,58.95,card)).reveal).toBeCloseTo(0,8);
  }
  expect(isCurveLabels({...s,finalEnd:53})).toBe(false);
 });
 it('wraps a moving signed material coordinate on the specified strand without touching geometry',()=>{
  const starts=Uint32Array.of(0,9),counts=Uint32Array.of(9,5);
  const s={...base(),count:2,finalStart:4,finalEnd:8,finalStrand:1,finalPosition:-.25,finalColor:'#a65bff'};
  const a=curveLabelFinalUniforms(starts,counts,s),b=curveLabelFinalUniforms(starts,counts,{...s,finalPosition:1.75});
  expect([...a.slice(0,4)]).toEqual([12,13,0,1]);expect(b).toEqual(a);
  expect([...starts]).toEqual([0,9]);expect(a[10]).toBe(1);
 });
});
