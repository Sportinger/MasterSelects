/* Incremental planar tracking. Pixels arrive from a main-thread software canvas;
 * no worker/GPU canvas dependency (including on Mesa). Only two frames are held. */
self.importScripts(new URL('../wasm/opencv/opencv.js', self.location.href).href);
let previous = null;
let previousQuad = null;
const runtime = Promise.resolve(self.cv);

function inside(p, q) {
  let positive = false, negative = false;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const cross = (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
    positive ||= cross > 0; negative ||= cross < 0;
  }
  return !(positive && negative);
}
function area(q) {
  return Math.abs(q.reduce((s,p,i) => s+p.x*q[(i+1)%4].y-p.y*q[(i+1)%4].x,0)/2);
}
function transform(m,p) {
  const w = m[6]*p.x+m[7]*p.y+m[8];
  return {x:(m[0]*p.x+m[1]*p.y+m[2])/w,y:(m[3]*p.x+m[4]*p.y+m[5])/w};
}

async function step(message) {
  const cv = await runtime;
  if (!cv.calcOpticalFlowPyrLK || !cv.findHomography) throw new Error('OpenCV tracking functions unavailable');
  const { width, height, pixels, quad, exclusion, previousExclusion } = message;
  const rgba = cv.matFromArray(height, width, cv.CV_8UC4, new Uint8Array(pixels));
  const gray = new cv.Mat();
  try { cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY); } finally { rgba.delete(); }
  if (message.reset || !previous) {
    previous?.delete(); previous = gray; previousQuad = quad;
    return { quad, confidence: 1, points: 0 };
  }
  const owned = [];
  const own = m => { owned.push(m); return m; };
  try {
    const mask = own(cv.Mat.zeros(height, width, cv.CV_8UC1));
    const q = previousQuad.map(p=>({x:p.x*width,y:p.y*height}));
    const excluded = previousExclusion?.map(p=>({x:p.x*width,y:p.y*height}));
    const nextExcluded = exclusion?.map(p=>({x:p.x*width,y:p.y*height}));
    const minX=Math.max(0,Math.floor(Math.min(...q.map(p=>p.x)))), maxX=Math.min(width-1,Math.ceil(Math.max(...q.map(p=>p.x))));
    const minY=Math.max(0,Math.floor(Math.min(...q.map(p=>p.y)))), maxY=Math.min(height-1,Math.ceil(Math.max(...q.map(p=>p.y))));
    for(let y=minY;y<=maxY;y++) for(let x=minX;x<=maxX;x++) {
      if(inside({x,y},q)&&(!excluded||!inside({x,y},excluded))) mask.data[y*width+x]=255;
    }
    const features=own(new cv.KeyPointVector()), detector=own(new cv.ORB(500,1.2,4,12,0,2,cv.ORB_HARRIS_SCORE,21,8));
    detector.detect(previous,features,mask);
    const coordinates=[];
    for(let i=0;i<features.size();i++) {const p=features.get(i).pt; coordinates.push(p.x,p.y);}
    const points=own(cv.matFromArray(coordinates.length/2,1,cv.CV_32FC2,coordinates)), next=own(new cv.Mat()), back=own(new cv.Mat());
    const status=own(new cv.Mat()), error=own(new cv.Mat()), backStatus=own(new cv.Mat()), backError=own(new cv.Mat());
    if(points.rows<10) return {lost:true,reason:'Too little visible texture. Choose a larger area or correct this frame.'};
    const window=new cv.Size(21,21), criteria=new cv.TermCriteria(cv.TermCriteria_EPS|cv.TermCriteria_COUNT,30,0.01);
    cv.calcOpticalFlowPyrLK(previous,gray,points,next,status,error,window,3,criteria);
    cv.calcOpticalFlowPyrLK(gray,previous,next,back,backStatus,backError,window,3,criteria);
    const from=[],to=[];
    for(let i=0;i<points.rows;i++) {
      const x=points.data32F[i*2],y=points.data32F[i*2+1],nx=next.data32F[i*2],ny=next.data32F[i*2+1];
      if(!status.data[i]||!backStatus.data[i]||error.data32F[i]>35||Math.hypot(back.data32F[i*2]-x,back.data32F[i*2+1]-y)>1.5) continue;
      if(nx<0||ny<0||nx>=width||ny>=height||(nextExcluded&&inside({x:nx,y:ny},nextExcluded))) continue;
      from.push(x,y);to.push(nx,ny);
    }
    if(from.length<20) return {lost:true,reason:'Track lost at a blur or occlusion. Correct here and continue.'};
    const a=own(cv.matFromArray(from.length/2,1,cv.CV_32FC2,from)),b=own(cv.matFromArray(to.length/2,1,cv.CV_32FC2,to)),inliers=own(new cv.Mat());
    const H=own(cv.findHomography(a,b,cv.RANSAC,2.5,inliers,2000,0.995));
    if(H.empty()) return {lost:true,reason:'No consistent surface motion found.'};
    const m=Array.from(H.data64F), count=Array.from(inliers.data).reduce((s,v)=>s+(v?1:0),0);
    const projected=q.map(p=>transform(m,p));
    const ratio=area(projected)/area(q);
    const confidence=count/(from.length/2)*Math.min(1,count/30);
    const residuals=[];
    for(let i=0;i<from.length/2;i++) if(inliers.data[i]) { const p=transform(m,{x:from[2*i],y:from[2*i+1]});residuals.push(Math.hypot(p.x-to[2*i],p.y-to[2*i+1])); }
    const errorMean=residuals.reduce((s,v)=>s+v,0)/Math.max(1,count);
    // A partly visible plane can still be tracked. Reject runaway projections,
    // but do not stop solely because one corner has left the image.
    const runaway=projected.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<-.5*width||p.y<-.5*height||p.x>1.5*width||p.y>1.5*height);
    if(count<10||confidence<0.4||errorMean>2||ratio<0.65||ratio>1.5||runaway) {
      return {lost:true,reason:'Surface motion is uncertain. Correct this frame before continuing.',diagnostics:{count,confidence,errorMean,areaRatio:ratio,outOfFrame:projected.some(p=>p.x<0||p.y<0||p.x>width||p.y>height)}};
    }
    previous.delete(); previous=gray; previousQuad=projected.map(p=>({x:p.x/width,y:p.y/height}));
    return {quad:previousQuad,confidence,points:count};
  } finally {
    owned.forEach(m=>m.delete());
    if(previous!==gray) gray.delete();
  }
}
self.onmessage=async ({data})=>{
  try { self.postMessage({id:data.id,data:await step(data)}); }
  catch(error) { self.postMessage({id:data.id,error:error.message||'Surface tracking failed'}); }
};
