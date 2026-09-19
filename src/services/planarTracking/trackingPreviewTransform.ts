import type { ClipTransform } from '../../types/timelineCore';
import type { SurfacePoint, SurfaceQuad } from '../../types/planarTracking';
import { inverseMatrix, projectPoint, quadMatrix } from './surfaceGeometry';
import { calculateSourcePixelScale } from '../../utils/sourcePixelScale';
import { getEffectiveScale } from '../../utils/transformScale';

/** Same inverse projective mapping as the standard 2D compositor. */
export function trackingPreviewTransform(transform: ClipTransform, source: {width:number;height:number}, output: {width:number;height:number}) {
  const scale = getEffectiveScale(transform.scale);
  const pixelScale = calculateSourcePixelScale(source.width,source.height,output.width,output.height);
  const aspect = output.width/output.height, ratio = source.width/source.height/aspect;
  const [rx,ry,rz] = [transform.rotation.x,transform.rotation.y,transform.rotation.z].map(v => v*Math.PI/180);
  const toSource = (uv:SurfacePoint):SurfacePoint => {
    let x=uv.x-.5-transform.position.x*.5, y=(uv.y-.5-transform.position.y*.5)/aspect, z=transform.position.z;
    [y,z]=[y*Math.cos(-rx)-z*Math.sin(-rx),y*Math.sin(-rx)+z*Math.cos(-rx)];
    [x,z]=[x*Math.cos(-ry)+z*Math.sin(-ry),-x*Math.sin(-ry)+z*Math.cos(-ry)];
    [x,y]=[x*Math.cos(rz)-y*Math.sin(rz),x*Math.sin(rz)+y*Math.cos(rz)];
    const w=1-z/2;
    x=x/w/(scale.x*pixelScale);y=y/w*aspect/(scale.y*pixelScale);
    if(ratio>1)y*=ratio;else x/=ratio;
    return {x:x+(transform.anchor?.x??0)+.5,y:y+(transform.anchor?.y??0)+.5};
  };
  const quad=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}].map(toSource) as SurfaceQuad;
  const matrix=inverseMatrix(quadMatrix(quad));
  return {toSource, toComposition:(point:SurfacePoint)=>matrix?projectPoint(matrix,point):point};
}
