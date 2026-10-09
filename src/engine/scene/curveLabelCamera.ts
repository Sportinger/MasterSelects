import type { SceneCamera, SceneLayer3DData, SceneVector3 } from './types';

/** Data-only camera pose for renderer/worker transport, sampled from the timeline rather than playback history. */
export interface CurveLabelCameraFrame {
  position: number[]; right: number[]; up: number[]; forward: number[];
  projectionX: number; projectionY: number; orthographic: boolean;
}
const norm=(v:number[])=>{const n=Math.hypot(...v)||1;return v.map(x=>x/n);};
const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const xyz=(v:SceneVector3)=>[v.x,v.y,v.z];
export function curveLabelCameraFrame(camera:SceneCamera):CurveLabelCameraFrame {
  const v=camera.viewMatrix;
  return {position:xyz(camera.cameraPosition),right:[v[0],v[4],v[8]],up:[v[1],v[5],v[9]],forward:[-v[2],-v[6],-v[10]],
    projectionX:camera.projectionMatrix[0],projectionY:camera.projectionMatrix[5],orthographic:camera.projection==='orthographic'};
}
export function withCurveLabelCameras(camera:SceneCamera,layers:SceneLayer3DData[],time:number,resolveAt:(time:number)=>SceneCamera):SceneCamera {
  const delays=[...new Set(layers.flatMap(layer=>layer.kind==='strands'&&layer.strands.program.render?.labels
    ?[layer.strands.program.render.labels.lag]:[]))];
  if(!delays.length)return camera;
  const frames:Record<string,CurveLabelCameraFrame>={};
  for(const delay of delays){
    if(delay===0){frames[delay]=curveLabelCameraFrame(camera);continue;}
    const samples=[.3,.8,1.4,2.2].map((offset,i)=>({frame:curveLabelCameraFrame(resolveAt(Math.max(0,time-delay*offset))),weight:(4-i)/10}));
    const sum=(key:'position'|'right'|'up')=>[0,1,2].map(axis=>samples.reduce((n,s)=>n+s.frame[key][axis]*s.weight,0));
    const right=norm(sum('right')),backward=norm(cross(right,norm(sum('up')))),up=norm(cross(backward,right));
    frames[delay]=Math.hypot(...right)<.9||Math.hypot(...up)<.9
      ?curveLabelCameraFrame(camera)
      :{...curveLabelCameraFrame(camera),position:sum('position'),right,up,forward:backward.map(v=>-v)};
  }
  return {...camera,curveLabelCameras:frames};
}
