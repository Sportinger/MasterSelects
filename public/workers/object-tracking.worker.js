/* Deformable contour flow, restricted to foreground texture. Two CPU frames only. */
self.importScripts(new URL('../wasm/opencv/opencv.js', self.location.href).href);
const runtime=Promise.resolve(self.cv);
let previous=null, contour=null, detail=null, expectedArea=0;
const polygonArea=points=>Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-p.y*q.x;},0))/2;
const median=values=>values.toSorted((a,b)=>a-b)[Math.floor(values.length/2)];
function inside(x,y,points) {
  let hit=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++) {
    const a=points[i],b=points[j];
    if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)hit=!hit;
  }
  return hit;
}
async function step(message) {
  const cv=await runtime, {width,height,pixels}=message;
  const rgba=cv.matFromArray(height,width,cv.CV_8UC4,new Uint8Array(pixels)),gray=new cv.Mat();
  try{cv.cvtColor(rgba,gray,cv.COLOR_RGBA2GRAY);}finally{rgba.delete();}
  if(message.reset||!previous) {
    previous?.delete();previous=gray;contour=message.contour;detail=message.detail;expectedArea=polygonArea(detail);
    return {contour,detailContour:detail,confidence:1};
  }
  const owned=[],own=value=>{owned.push(value);return value;};
  try {
    if(previous.cols!==width||previous.rows!==height)throw new Error('Source dimensions changed.');
    const mask=own(cv.Mat.zeros(height,width,cv.CV_8UC1));
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(inside(x/width,y/height,detail))mask.data[y*width+x]=255;
    const features=own(new cv.KeyPointVector()),detector=own(new cv.ORB(300,1.2,4,8,0,2,cv.ORB_HARRIS_SCORE,15,5));
    detector.detect(previous,features,mask);
    const coordinates=[];
    for(let i=0;i<features.size();i++){const p=features.get(i).pt;coordinates.push(p.x,p.y);}
    const points=own(cv.matFromArray(coordinates.length/2,1,cv.CV_32FC2,coordinates));
    if(points.rows<6)return {lost:true,reason:'Too little object texture. Select a clearer frame or a larger outline.'};
    const next=own(new cv.Mat()),back=own(new cv.Mat()),status=own(new cv.Mat()),error=own(new cv.Mat()),backStatus=own(new cv.Mat()),backError=own(new cv.Mat());
    const win=new cv.Size(21,21),criteria=new cv.TermCriteria(cv.TermCriteria_EPS|cv.TermCriteria_COUNT,30,.01);
    cv.calcOpticalFlowPyrLK(previous,gray,points,next,status,error,win,3,criteria);
    cv.calcOpticalFlowPyrLK(gray,previous,next,back,backStatus,backError,win,3,criteria);
    const matches=[];
    for(let i=0;i<points.rows;i++) {
      const x=points.data32F[i*2],y=points.data32F[i*2+1],nx=next.data32F[i*2],ny=next.data32F[i*2+1];
      if(!status.data[i]||!backStatus.data[i]||error.data32F[i]>28||Math.hypot(back.data32F[i*2]-x,back.data32F[i*2+1]-y)>1.2||nx<0||ny<0||nx>=width||ny>=height)continue;
      matches.push({x,y,dx:nx-x,dy:ny-y});
    }
    if(matches.length<6||matches.length/points.rows<.45)return {lost:true,reason:'Object lost at blur or occlusion. Correct the outline and continue.'};
    // A whole-object median rejects moving limbs as outliers. Keep all
    // forward/backward-verified features and fit a separate local affine flow
    // at every vertex (translation, rotation, scale and local shear).
    const deform=vertices=>vertices.map(p=>{
      const px=p.x*width,py=p.y*height;
      const neighbors=matches.map(m=>({...m,d:Math.hypot(m.x-px,m.y-py)})).toSorted((a,b)=>a.d-b.d).slice(0,18);
      const radius=Math.max(8,neighbors[Math.min(7,neighbors.length-1)].d);
      let flowX=[median(neighbors.map(m=>m.dx)),0,0],flowY=[median(neighbors.map(m=>m.dy)),0,0];
      for(let iteration=0;iteration<3;iteration++) {
        const matrix=Array.from({length:3},()=>[0,0,0]),bx=[0,0,0],by=[0,0,0];
        for(const m of neighbors) {
          const basis=[1,(m.x-px)/radius,(m.y-py)/radius];
          const residual=Math.hypot(m.dx-basis.reduce((sum,v,i)=>sum+v*flowX[i],0),m.dy-basis.reduce((sum,v,i)=>sum+v*flowY[i],0));
          const weight=1/(1+(m.d/radius)**4)*(iteration?Math.min(1,2/Math.max(.01,residual)):1);
          for(let row=0;row<3;row++) {bx[row]+=weight*basis[row]*m.dx;by[row]+=weight*basis[row]*m.dy;for(let col=0;col<3;col++)matrix[row][col]+=weight*basis[row]*basis[col];}
        }
        // Small slope regularization limits extrapolation outside foreground.
        matrix[1][1]+=.02;matrix[2][2]+=.02;
        const solve=b=>{
          const rows=matrix.map((row,i)=>[...row,b[i]]);
          for(let k=0;k<3;k++) {
            let pivot=k;for(let i=k+1;i<3;i++)if(Math.abs(rows[i][k])>Math.abs(rows[pivot][k]))pivot=i;
            [rows[k],rows[pivot]]=[rows[pivot],rows[k]];
            if(Math.abs(rows[k][k])<1e-7)return null;
            const scale=rows[k][k];for(let j=k;j<4;j++)rows[k][j]/=scale;
            for(let i=0;i<3;i++)if(i!==k){const factor=rows[i][k];for(let j=k;j<4;j++)rows[i][j]-=factor*rows[k][j];}
          }
          return rows.map(row=>row[3]);
        };
        flowX=solve(bx)??flowX;flowY=solve(by)??flowY;
      }
      return {x:p.x+flowX[0]/width,y:p.y+flowY[0]/height};
    });
    const moved=deform(contour);let movedDetail=deform(detail);
    const spread=next=>{
      const center=matches.reduce((s,p)=>({x:s.x+p.x+(next?p.dx:0),y:s.y+p.y+(next?p.dy:0)}),{x:0,y:0});center.x/=matches.length;center.y/=matches.length;
      let xx=0,xy=0,yy=0;for(const p of matches){const x=p.x+(next?p.dx:0)-center.x,y=p.y+(next?p.dy:0)-center.y;xx+=x*x;xy+=x*y;yy+=y*y;}
      return Math.max(1e-6,xx*yy-xy*xy);
    };
    // Track observed foreground scale separately from the advected silhouette.
    // A collapsing contour must not progressively discard wheels or limbs.
    const areaRatio=Math.sqrt(spread(true)/spread(false));
    expectedArea*=Math.max(.8,Math.min(1.25,areaRatio));
    const area=polygonArea(movedDetail);
    if(area<expectedArea*.9) {
      if(area<expectedArea*.65)return {lost:true,reason:'Outline is collapsing. Add points on missing parts and continue.'};
      const factor=Math.sqrt(expectedArea*.9/area);
      const center=movedDetail.reduce((sum,p)=>({x:sum.x+p.x/movedDetail.length,y:sum.y+p.y/movedDetail.length}),{x:0,y:0});
      movedDetail=movedDetail.map(p=>({x:center.x+(p.x-center.x)*factor,y:center.y+(p.y-center.y)*factor}));
    }
    if(movedDetail.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>1||p.y>1))return {lost:true,reason:'Outline reached the image boundary. Correct the selection before continuing.'};
    previous.delete();previous=gray;contour=moved;detail=movedDetail;
    return {contour,detailContour:detail,confidence:matches.length/points.rows};
  }finally{owned.forEach(m=>m.delete());if(previous!==gray)gray.delete();}
}
self.onmessage=async({data})=>{
  try{self.postMessage({data:await step(data)});}catch(error){self.postMessage({error:error.message||'Object tracking failed'});}
};
