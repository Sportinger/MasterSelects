import type {CurveSet} from '../../../services/operators/geometry/geometryEvaluation';
import type {CurveLabelSpec} from '../../../services/operators/geometry/curveLabels';
import {curveLabelAnchors} from './curveLabelLayout';
import {curveLabelEpisode} from './curveLabelSchedule';
/** Identical source/destination topology and appearance metadata for rendering and on-demand diagnostics. */
export function curveLabelTrackingInputs(curves:Pick<CurveSet,'starts'|'counts'>,spec:CurveLabelSpec,time:number){
 const source=curveLabelAnchors(curves.starts,curves.counts,spec,false,time);
 const destination=curveLabelAnchors(curves.starts,curves.counts,spec,true,time);
 const anchors=new Float32Array(spec.count*16),ranges=new Uint32Array(curves.starts.length*2);
 for(let strand=0;strand<curves.starts.length;strand++)ranges.set([curves.starts[strand],curves.counts[strand]],strand*2);
 for(let card=0;card<spec.count;card++){
  anchors.set(source.subarray(card*4,card*4+4),card*16);anchors.set(destination.subarray(card*4,card*4+4),card*16+4);
  const timing=curveLabelEpisode(spec,time,card);anchors[card*16+3]=timing.birth;anchors[card*16+7]=timing.visible;
  const target=destination[card*4+3],reference=curves.starts.length-1;
  anchors.set([curves.starts[target],curves.counts[target],curves.starts[reference],curves.counts[reference]],card*16+8);
 }
 return {anchors,ranges,source,destination};
}
