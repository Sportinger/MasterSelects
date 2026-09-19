import { describe, expect, it } from 'vitest';
import { buildTerrainModel } from '../../src/services/planarTracking/terrainModel';
import { terrainCameraPoint, terrainProject, triangulateTerrain } from '../../src/services/planarTracking/terrainGeometry';
import { projectTerrainTriangles, sampleTerrainCamera } from '../../src/services/planarTracking/terrainProjection';
import { createColmapTextModel } from '../../src/services/photogrammetry/sfm/colmapText';
import type { SparseReconstruction } from '../../src/services/photogrammetry/sfm/types';
import type { SurfaceQuad } from '../../src/types/planarTracking';
import { terrainOverlay } from '../../src/effects/tracking/terrainOverlay';

const quad:SurfaceQuad=[{x:.2,y:.2},{x:.8,y:.2},{x:.8,y:.8},{x:.2,y:.8}];
function fixture(){
  const reconstruction:SparseReconstruction={frames:[],poses:new Map(),points:[],focalLength:800,principalPoint:{x:640,y:480}};
  for(let y=0;y<9;y++)for(let x=0;x<9;x++)reconstruction.points.push({id:y*9+x+1,position:{x:(x-4)*.22,y:(y-4)*.19,z:3+Math.sin(x*.7)*.35+Math.cos(y*.8)*.25},color:[100,110,120],error:.1,observations:[]});
  const stamps=Array.from({length:10},(_,i)=>({time:i/30,duration:1/30}));
  for(let frame=0;frame<10;frame++){
    const pose={rotation:[1,0,0,0,1,0,0,0,1] as [number,number,number,number,number,number,number,number,number],translation:{x:frame*.015,y:0,z:0}};
    reconstruction.poses.set(frame,pose);
    const pixels:number[]=[];
    reconstruction.points.forEach((point,index)=>{pixels.push(640+800*(point.position.x+pose.translation.x)/point.position.z,480+800*point.position.y/point.position.z);point.observations.push({frameIndex:frame,featureIndex:index});});
    reconstruction.frames.push({sourceIndex:frame,name:`frame-${frame}.jpg`,width:1280,height:960,solveWidth:1280,solveHeight:960,points:new Float32Array(pixels),colors:new Uint8Array(pixels.length/2*3)});
  }
  const model={datasetName:'test',...createColmapTextModel(reconstruction)};
  return {model,stamps,terrain:buildTerrainModel(model,stamps,4/30,quad)};
}

describe('3D ground reconstruction and projective decal',()=>{
  it('builds a connected nonplanar mesh with camera poses from COLMAP observations',()=>{
    const {terrain}=fixture();
    expect(terrain.cameras).toHaveLength(10);
    expect(terrain.vertices.length).toBeGreaterThan(12);
    expect(terrain.triangles.length/3).toBeGreaterThan(8);
    expect(terrain.triangles.length/3).toBeLessThanOrEqual(128);
    expect(new Set(terrain.vertices.map(v=>v.position[2])).size).toBeGreaterThan(4);
    expect(terrain.medianError).toBeLessThan(.001);
    expect(JSON.parse(JSON.stringify(terrain))).toEqual(terrain);
  });
  it('preserves reference-projector UV across depth changes and produces depth-dependent parallax',()=>{
    const {terrain}=fixture();const ref=terrain.cameras[4];
    for(const vertex of terrain.vertices){
      const xy=terrainProject(terrain.intrinsics,terrainCameraPoint(ref,vertex.position));
      expect(vertex.uvq[0]/vertex.uvq[2]).toBeCloseTo((xy[0]-.2)/.6,5);
      expect(vertex.uvq[1]/vertex.uvq[2]).toBeCloseTo((xy[1]-.2)/.6,5);
    }
    const a=projectTerrainTriangles(terrain,ref), b=projectTerrainTriangles(terrain,terrain.cameras[8]);
    expect(a).not.toEqual(b);expect(a.every(Number.isFinite)).toBe(true);
    const screenX=(a[0]+a[8]+a[16])/3, screenY=(a[1]+a[9]+a[17])/3;
    const qu=a[4]+a[12]+a[20], qv=a[5]+a[13]+a[21], qw=a[6]+a[14]+a[22];
    expect(qu/qw).toBeCloseTo((screenX-.2)/.6,5);
    expect(qv/qw).toBeCloseTo((screenY-.2)/.6,5);
    const delta=new Set(Array.from({length:a.length/8},(_,i)=>(b[i*8]-a[i*8]).toFixed(6)));
    expect(delta.size).toBeGreaterThan(3);
    if('packUniforms' in terrainOverlay){
      const packed=terrainOverlay.packUniforms({mesh:JSON.stringify(a)},1280,960)!;
      expect(packed.byteLength).toBe(terrainOverlay.uniformSize);
      expect([...packed].every(Number.isFinite)).toBe(true);
    }
  });
  it('holds one solved pose per source frame and hides missing poses rather than interpolating',()=>{
    const {terrain}=fixture();const missing={...terrain,cameras:terrain.cameras.filter((_,i)=>i!==5)};
    expect(sampleTerrainCamera(missing,4/30+.01)?.time).toBe(4/30);
    expect(sampleTerrainCamera(missing,5/30+.01)).toBeNull();
    expect(sampleTerrainCamera(missing,6/30)?.time).toBe(6/30);
    expect(sampleTerrainCamera(missing,-1)).toBeNull();
  });
  it('rejects missing reference registration and unobserved geometry',()=>{
    const {model,stamps}=fixture();
    expect(()=>buildTerrainModel(model,stamps,20,quad)).toThrow('reference frame');
    expect(()=>buildTerrainModel({...model,pointsText:''},stamps,4/30,quad)).toThrow();
  });
  it('triangulates a square without overlapping faces or invented vertices',()=>{
    const mesh=triangulateTerrain([[0,0],[1,0],[1,1],[0,1]]);
    expect(mesh).toHaveLength(6);expect(mesh.every(i=>i>=0&&i<4)).toBe(true);
    expect(triangulateTerrain([[0,0],[1,0]])).toEqual([]);
  });
});
