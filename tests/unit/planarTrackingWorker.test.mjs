import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

const opencvContext = { console, require: createRequire(import.meta.url), process, performance,
  __dirname: path.resolve('public/wasm/opencv'), module: { exports: {} }, Buffer, setTimeout, clearTimeout };
vm.runInNewContext(readFileSync('public/wasm/opencv/opencv.js','utf8'),opencvContext);
const cv = await opencvContext.module.exports;

function tracker() {
  let response;
  const self = {cv, location:{href:'https://localhost/workers/planar-tracking.worker.js'},importScripts(){},postMessage(r){response=r;}};
  vm.runInNewContext(readFileSync('public/workers/planar-tracking.worker.js','utf8'),{self,URL,console,Uint8Array});
  return async data=>{await self.onmessage({data});if(response.error)throw new Error(response.error);return response.data;};
}
const width=320,height=240;
const quad=[{x:.25,y:.25},{x:.65,y:.25},{x:.65,y:.65},{x:.25,y:.65}];
function texture() {
  let seed=42;
  const pixels=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    seed=(1664525*seed+1013904223)>>>0;
    const v=seed>>>24;
    const i=(y*width+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=v;pixels[i+3]=255;
  }
  return pixels;
}
const original=texture();
function transformed(matrix) {
  const input=cv.matFromArray(height,width,cv.CV_8UC4,original),output=new cv.Mat(),m=cv.matFromArray(3,3,cv.CV_64F,matrix);
  try {cv.warpPerspective(input,output,m,new cv.Size(width,height));return Uint8Array.from(output.data);}finally{input.delete();output.delete();m.delete();}
}
test('real OpenCV worker tracks perspective motion in both directions, with bounded corner error',async()=>{
  for(const direction of [1,-1]) {
    const step=tracker();let last;
    for(let f=0;f<12;f++) {
      const n=direction*f;
      const m=[1+n*.001,-n*.001,n*.7,n*.001,1+n*.001,n*.4,n*.00001,n*.00002,1];
      const pixels=transformed(m);
      last=await step({width,height,pixels:pixels.buffer,quad,reset:f===0});
      assert.equal(last.lost,undefined,JSON.stringify(last));
      for(let i=0;i<4;i++) {
        const x=quad[i].x*width,y=quad[i].y*height,w=m[6]*x+m[7]*y+1;
        assert.ok(Math.hypot(last.quad[i].x*width-(m[0]*x+m[1]*y+m[2])/w,last.quad[i].y*height-(m[3]*x+m[4]*y+m[5])/w)<2.5,`frame ${f}, corner ${i}`);
      }
    }
    assert.ok(last.confidence>.5);
  }
});
test('texture loss and full occlusion stop tracking rather than return invented motion',async()=>{
  const step=tracker();await step({width,height,pixels:original.buffer.slice(0),quad,reset:true});
  const blank=new Uint8Array(width*height*4);
  assert.equal((await step({width,height,pixels:blank.buffer,quad})).lost,true);
  const covered=tracker();await covered({width,height,pixels:original.buffer.slice(0),quad,reset:true});
  assert.equal((await covered({width,height,pixels:original.buffer.slice(0),quad,previousExclusion:quad})).lost,true);
});
