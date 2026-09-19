import { describe, expect, it } from 'vitest';
import { parseDenseTerrain } from '../../src/services/planarTracking/denseTerrainImport';
import { footprintPlacement, pickTerrainPoint } from '../../src/services/planarTracking/terrainPlacement';
import { sampleTerrainCamera } from '../../src/services/planarTracking/terrainProjection';
import { deepClone } from '../../src/stores/historyStore/snapshotCloning';
import type { TerrainReconstruction } from '../../src/types/terrainTracking';

const scene=():TerrainReconstruction=>({version:1,solver:'colmap-openmvs',referenceTime:1,sourceFrameCount:2,sparsePointCount:20,medianError:.2,vertices:[],triangles:[],
  intrinsics:{width:100,height:100,fx:100,fy:100,cx:50,cy:50},
  cameras:[{time:1,duration:.033,rotation:[1,0,0,0,1,0,0,0,1],translation:[0,0,0],error:.2,observations:20},{time:1.066,duration:.033,rotation:[1,0,0,0,1,0,0,0,1],translation:[0,0,0],error:.2,observations:20}],
  denseMesh:{positions:[-2,-2,4,2,-2,4,2,2,4,-2,2,4],indices:[0,1,2,0,2,3],origin:[0,0,4],axisX:[1,0,0],axisY:[0,1,0],normal:[0,0,-1],size:[4,4]}});
const bundle=(terrain=scene())=>JSON.stringify({format:'masterselects-terrain',version:1,sourceName:'test.mp4',terrain});
describe('dense camera and mesh import',()=>{
  it('accepts independently rounded microsecond PTS and durations',()=>{const t=scene();t.cameras[0].time=19.300267;t.cameras[0].duration=.033356;t.cameras[1].time=19.333622;expect(parseDenseTerrain(bundle(t)).cameras).toHaveLength(2);t.cameras[1].time-=.00001;expect(()=>parseDenseTerrain(bundle(t))).toThrow('timestamps');});
  it('retains per-frame foreground quads and rejects malformed masks',()=>{const t=scene();t.cameras[0].occluders=[[[.2,.7],[.4,.7],[.4,1],[.2,1]]];const parsed=parseDenseTerrain(bundle(t));expect(parsed.cameras[0].occluders).toEqual(t.cameras[0].occluders);t.cameras[0].occluders[0][0][0]=NaN;expect(()=>parseDenseTerrain(bundle(t))).toThrow('occlusion');});
  it('validates footstep contacts and retains immutable local ground patches',()=>{
    const t=scene();t.footsteps=[{id:'left-1',name:'Left 1',mesh:t.denseMesh,placement:{x:0,y:0,width:.5,height:1,rotation:0,contactTime:1.02,side:'left',profile:'hiking',contour:[[0,0],[1,0],[.8,1],[.2,1]]}}];
    const imported=parseDenseTerrain(bundle(t));expect(imported.footsteps?.[0].placement.profile).toBe('hiking');expect(Object.isFrozen(imported.footsteps?.[0].mesh)).toBe(true);
    const snapshot=deepClone(imported);expect(snapshot.footsteps?.[0].mesh).toBe(imported.footsteps?.[0].mesh);snapshot.footsteps![0].placement.width=2;expect(imported.footsteps?.[0].placement.width).toBe(.5);
    t.footsteps[0].placement.contour![0][0]=2;expect(()=>parseDenseTerrain(bundle(t))).toThrow('contour');
  });
  it('rejects duplicate steps and invalid contact dimensions',()=>{
    const t=scene(),step={id:'step',name:'Step',placement:{x:0,y:0,width:1,height:1,rotation:0,contactTime:1,contour:[[0,0],[1,0],[1,1]] as [number,number][]}};
    t.footsteps=[step,step];expect(()=>parseDenseTerrain(bundle(t))).toThrow('unique');t.footsteps=[{...step,placement:{...step.placement,width:0}}];expect(()=>parseDenseTerrain(bundle(t))).toThrow('placement');
  });
  it('matches rounded imported PTS to truncated export timestamps without bridging missing frames',()=>{const t=scene();t.cameras[0].time=4.766744;t.cameras[0].duration=.033333;t.cameras[1].time=4.800078;expect(sampleTerrainCamera(t,4.800077)).toBe(t.cameras[1]);expect(sampleTerrainCamera(t,4.80006)).toBe(t.cameras[0]);expect(sampleTerrainCamera(t,4.84)).toBeNull();});
  it('shares frozen geometry across undo snapshots while cloning editable placement',()=>{const t=parseDenseTerrain(bundle());const marker={terrain:t,placement:{x:1}};const snapshot=deepClone(marker);expect(snapshot.terrain.denseMesh).toBe(t.denseMesh);expect(Object.isFrozen(t.denseMesh?.positions)).toBe(true);snapshot.placement.x=2;expect(marker.placement.x).toBe(1);});
  it('retains gaps instead of inventing camera interpolation',()=>{const t=parseDenseTerrain(bundle(),'test.mp4');expect(sampleTerrainCamera(t,1.02)).toBe(t.cameras[0]);expect(sampleTerrainCamera(t,1.045)).toBeNull();});
  it('rejects another source and invalid triangle indices',()=>{expect(()=>parseDenseTerrain(bundle(),'other.mp4')).toThrow('belongs');const t=scene();t.denseMesh!.indices[1]=8;expect(()=>parseDenseTerrain(bundle(t))).toThrow('triangles');});
  it('rejects non-rigid camera matrices and overlapping exposure windows',()=>{const t=scene();t.cameras[0].rotation[0]=2;expect(()=>parseDenseTerrain(bundle(t))).toThrow('rotation');t.cameras[0].rotation[0]=1;t.cameras[0].duration=1;expect(()=>parseDenseTerrain(bundle(t))).toThrow('timestamps');});
  it('rejects non-orthogonal ground axes',()=>{const t=scene();t.denseMesh!.axisY=[1,0,0];expect(()=>parseDenseTerrain(bundle(t))).toThrow('orthonormal');});
});
describe('contact footprint ray projection',()=>{
  it('uses surface depth for physical size in reconstruction coordinates',()=>{const t=scene();const p=footprintPlacement(t,t.cameras[0],[{x:.4,y:.3},{x:.6,y:.3},{x:.6,y:.7},{x:.4,y:.7}]);expect(p.width).toBeCloseTo(.8);expect(p.height).toBeCloseTo(1.6);expect(p.x).toBeCloseTo(0);expect(p.contactTime).toBe(1);expect(p.contour).toEqual([[0,0],[1,0],[1,1],[0,1]]);});
  it('selects the nearest surface, independent of face order',()=>{const t=scene();t.denseMesh!.positions.push(-2,-2,2,2,-2,2,2,2,2);t.denseMesh!.indices.push(4,5,6);expect(pickTerrainPoint(t,t.cameras[0],{x:.55,y:.45})?.[2]).toBeCloseTo(2);});
  it('does not fill unsupported ground or trace too few points',()=>{const t=scene();expect(pickTerrainPoint(t,t.cameras[0],{x:2,y:2})).toBeNull();expect(()=>footprintPlacement(t,t.cameras[0],[{x:.5,y:.5}])).toThrow('3–32');});
  it('inverts radial distortion when placing a contact point',()=>{const t=scene();t.intrinsics.k1=.2;const x=.2*(1+.2*.04);const hit=pickTerrainPoint(t,t.cameras[0],{x:.5+x,y:.5});expect(hit?.[0]).toBeCloseTo(.8,5);});
});
