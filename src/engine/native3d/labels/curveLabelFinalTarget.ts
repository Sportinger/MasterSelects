import type {CurveLabelSpec} from '../../../services/operators/geometry/curveLabels';
/** Final material anchor shares the exact same topology for rendering and diagnostics. */
export function curveLabelFinalUniforms(starts:Uint32Array,counts:Uint32Array,spec:CurveLabelSpec):Float32Array {
  const result=new Float32Array(12);
  if(!(spec.finalEnd>spec.finalStart))return result;
  if(!starts.length)throw new Error('Curve Scan Labels: final material target requires curve topology.');
  const strand=spec.finalStrand%starts.length,count=counts[strand];
  if(!count)throw new Error('Curve Scan Labels: final target curve has no points.');
  const u=((spec.finalPosition%1)+1)%1,at=u*(count-1),low=Math.floor(at);
  result.set([starts[strand]+low,starts[strand]+Math.min(low+1,count-1),at-low,1]);
  result.set([spec.finalStart,spec.finalStagger,spec.finalTransition,0],4);
  const color=parseInt((spec.finalColor??'#aa55ff').slice(1),16);
  result.set([(color>>16&255)/255,(color>>8&255)/255,(color&255)/255,0],8);
  return result;
}
