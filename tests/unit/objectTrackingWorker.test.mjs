import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
const context={console,require:createRequire(import.meta.url),process,performance,__dirname:path.resolve('public/wasm/opencv'),module:{exports:{}},Buffer,setTimeout,clearTimeout};
vm.runInNewContext(readFileSync('public/wasm/opencv/opencv.js','utf8'),context);
const cv=await context.module.exports;
const width=320,height=240;
const contour=[{x:.3,y:.25},{x:.5,y:.2},{x:.65,y:.3},{x:.65,y:.7},{x:.5,y:.75},{x:.3,y:.7}];
function tracker(){
  let response;const self={cv,location:{href:'https://localhost/workers/object-tracking.worker.js'},importScripts(){},postMessage:r=>{response=r;}};
  vm.runInNewContext(readFileSync('public/workers/object-tracking.worker.js','utf8'),{self,URL,console,Uint8Array});
  return async data=>{await self.onmessage({data});assert.ok(!response.error,response.error);return response.data;};
}
function image(dx=0,dy=0,blank=false){
  const pixels=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=x-dx,sy=y-dy;
    const foreground=sx>=75&&sx<225&&sy>=35&&sy<195;
    const noise=((sx*73856093)^(sy*19349663))>>>0;
    const value=blank?90:foreground?noise%230:40;
    const i=(y*width+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=value;pixels[i+3]=255;
  }return pixels.buffer;
}
test('foreground flow follows an independently moving subject forward and backward',async()=>{
  for(const direction of [-1,1]){
    const step=tracker();
    for(let i=0;i<10;i++){
      const dx=i*direction*2,dy=i*direction;
      const result=await step({width,height,pixels:image(dx,dy),contour,detail:contour,reset:i===0});
      assert.ok(!result.lost,JSON.stringify(result));assert.equal(result.contour.length,6);
      result.contour.forEach((p,k)=>assert.ok(Math.hypot((p.x-contour[k].x)*width-dx,(p.y-contour[k].y)*height-dy)<2));
    }
  }
});
test('complete texture loss stops instead of inventing an object track',async()=>{
  const step=tracker();await step({width,height,pixels:image(),contour,detail:contour,reset:true});
  assert.equal((await step({width,height,pixels:image(0,0,true)})).lost,true);
});

test('individual vertices follow non-rigid shear instead of sharing the subject translation',async()=>{
  const step=tracker();
  const sheared=amount=>{
    const pixels=new Uint8Array(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const sx=x-Math.round(amount*(y-height/2)),sy=y;
      const value=sx>=75&&sx<225&&sy>=35&&sy<195?(((sx*73856093)^(sy*19349663))>>>0)%230:40;
      const i=(y*width+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=value;pixels[i+3]=255;
    }return pixels.buffer;
  };
  let result;
  for(let i=0;i<=5;i++){
    result=await step({width,height,pixels:sheared(i*.025),contour,detail:contour,reset:i===0});
    assert.ok(!result.lost,JSON.stringify(result));
  }
  const movements=result.contour.map((p,i)=>(p.x-contour[i].x)*width);
  assert.ok(movements[1]<-5,`upper vertex must move left: ${movements}`);
  assert.ok(movements[4]>5,`lower vertex must move right: ${movements}`);
  result.contour.forEach((p,i)=>assert.ok(Math.abs((p.x-contour[i].x)*width-.125*(contour[i].y*height-height/2))<3,JSON.stringify(movements)));
});
