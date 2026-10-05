import { writeFileSync } from 'node:fs';
import { knitCurves } from '../src/services/operators/geometry/knitCurves';
import { extendCurves } from '../src/services/operators/geometry/extendCurves';
import { buildRodRest, rodCurvePositions } from '../src/services/operators/geometry/rodRest';
import { RodSimulation } from '../src/services/operators/geometry/rodSolver';
const spec={depth:.0697703617781501,height:.11841441831733948,lean:1.4954713398339015,resolution:64,rows:4,spacing:.13804612246770803,stitches:3,width:.20860499638571656};
const curves=extendCurves({length:.7,points:24},knitCurves(spec));
const count=curves.counts[0];
const rest=buildRodRest(curves,.022,2,{pinValue:i=>(i%count)/(count-1)<=.5?1:0,pullStartValue:i=>{const u=(i%count)/(count-1);return u<=.5?1000:1000+(u-.5)*2*(.5-1000)}});
const sim=new RodSimulation({nodeId:'draw-through-bake',radius:.026,segmentLength:.022,stretch:.9,bend:.25,friction:.05,damping:1.5,substeps:32,preroll:0,pin:2,pull:.95,pullTime:6,floor:false,floorHeight:-1,start:0,formEase:.3,gravity:0,drag:0,winds:[],turbulence:[]},rest);
const frames=[], spans=[];
for(let frame=0;frame<=48;frame++){
 const time=frame/48*6.5,p=rodCurvePositions(rest,sim.positionsAt(Math.round(time*60)),curves),data=[], span=[];
 for(let row=0;row<4;row++){
  const start=curves.starts[row]+24+128,end=start+64;
  span.push(Math.hypot(...[0,1,2].map(axis=>p[end*3+axis]-p[start*3+axis])));
  for(let k=0;k<=64;k++)for(let axis=0;axis<3;axis++)data.push(Number((p[(start+k)*3+axis]-p[start*3+axis]*(1-k/64)-p[end*3+axis]*(k/64)).toFixed(7)));
 }
 frames.push(data);spans.push(span);if(frame%12===0)console.log('profile',frame,'of 48');
}
writeFileSync('src/services/operators/geometry/knitDrawProfile.json',JSON.stringify({source:'MasterSelects XPBD rod study, four yarns, final stitch; residual from the moving end chord.',spec,points:65,duration:6.5,frames,spans}));
