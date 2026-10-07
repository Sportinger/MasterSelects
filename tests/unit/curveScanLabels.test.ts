import {describe,it,expect} from 'vitest';
import {createWaveStrandsGraph,geometryParameterReader} from '../../src/services/operators/geometry/weaveGraph';
import {compileGeometryGraph} from '../../src/services/operators/geometry/geometryProgram';
import {isGeometryProgram} from '../../src/services/operators/geometry/geometryProgramValidation';
import {CURVE_LABEL_OPERATOR,readCurveLabels,isCurveLabels} from '../../src/services/operators/geometry/curveLabels';
import {curveLabelAnchors,curveLabelGlyphs} from '../../src/engine/native3d/labels/curveLabelLayout';
import {withCurveLabelCameras} from '../../src/engine/scene/curveLabelCamera';
import type {SceneCamera,SceneStrandLayer} from '../../src/engine/scene/types';
const defaults=Object.fromEntries(CURVE_LABEL_OPERATOR.parameters.map(p=>[p.id,p.default]));
const spec=()=>readCurveLabels(id=>defaults[id]);
const graph=()=>{
  const g=createWaveStrandsGraph(),edge=g.edges.find(e=>e.to==='render'&&e.input==='curves')!;
  g.nodes.push({id:'labels',operator:'geometry.curve-labels',operatorVersion:1,bindings:{},constants:{}});
  g.edges.push({id:'labels-in',from:edge.from,output:'curves',to:'labels',input:'curves'});edge.from='labels';return g;
};
describe('Curve Scan Labels',()=>{
  it('preserves geometry stages and round-trips render metadata through the transported program',()=>{
    const base=compileGeometryGraph(createWaveStrandsGraph(),geometryParameterReader({}));
    const result=compileGeometryGraph(graph(),geometryParameterReader({}));
    expect(result.stages).toEqual(base.stages);expect(result.render?.labels?.count).toBe(6);
    expect(isGeometryProgram(JSON.parse(JSON.stringify(result)))).toBe(true);
    expect(isGeometryProgram({...result,render:{...result.render,labels:{...spec(),count:500}}})).toBe(false);
  });
  it('bypasses annotations without removing the strand output',()=>{
    const g=graph();g.nodes.find(n=>n.id==='labels')!.bypassed=true;
    expect(compileGeometryGraph(g,geometryParameterReader({})).render?.labels).toBeUndefined();
  });
  it('accepts uniform node-driven opacity and rejects per-point controls',()=>{
    const g=graph();g.nodes.push({id:'clock-scan',operator:'geometry.clip-time',operatorVersion:1,bindings:{}});
    g.edges.push({id:'scan-opacity',from:'clock-scan',output:'time',to:'labels',input:'opacity'});
    expect(compileGeometryGraph(g,geometryParameterReader({}),undefined,{simulationTime:.4}).render?.labels?.opacity).toBe(.4);
    g.nodes.push({id:'scan-info',operator:'geometry.curve-info',operatorVersion:1,bindings:{}});
    g.edges[g.edges.length-1].from='scan-info';g.edges[g.edges.length-1].output='u';
    expect(()=>compileGeometryGraph(g,geometryParameterReader({}))).toThrow('uniform');
  });
  it('reports malformed settings rather than silently dropping labels',()=>{
    for(const invalid of [{lag:NaN},{count:1.2},{color:'blue'},{titles:'ä'},{titles:'|EMPTY'},{width:50},{count:12,height:.4},{avoidance:2},{drift:-1},{style:'unknown'}])
      expect(isCurveLabels({...spec(),...invalid})).toBe(false);
  });
  it('keeps anchors on their selected variable-length strands, including wrapping',()=>{
    const s={...spec(),count:3,firstStrand:1,strandStep:1,start:.5,step:0};
    expect([...curveLabelAnchors(Uint32Array.of(0,5),Uint32Array.of(5,9),s)])
      .toEqual([9,10,0,1,2,3,0,0,9,10,0,1]);
  });
  it('changes scan titles over time while leaving world-coordinate slots for GPU formatting',()=>{
    const s=spec(),a=curveLabelGlyphs(s,1),b=curveLabelGlyphs(s,10);
    expect(a.slice(0,20)).not.toEqual(b.slice(0,20));
    expect([...a.slice(42,49)]).toEqual([256,257,258,259,260,261,262]);
    expect([...a.slice(53,60)]).toEqual([264,265,266,267,268,269,270]);
  });
  it('samples camera lag identically during forward playback, repeated frames and reverse seeks',()=>{
    const cam=(t:number)=>({viewMatrix:Float32Array.of(1,0,0,0,0,1,0,0,0,0,1,0,-t,0,-8,1),
      projectionMatrix:Float32Array.of(2,0,0,0,0,2,0,0,0,0,1,1,0,0,0,1),cameraPosition:{x:t,y:0,z:8},projection:'perspective'} as SceneCamera);
    const layers=[{kind:'strands',strands:{program:{render:{labels:spec()}}}}] as SceneStrandLayer[];
    const frame=(t:number)=>withCurveLabelCameras(cam(t),layers,t,cam).curveLabelCameras![spec().lag];
    const at10=frame(10);frame(20);expect(frame(10)).toEqual(at10);
    expect(at10.position[0]).toBeLessThan(10);expect(at10.position[0]).toBeGreaterThan(9.5);
    expect(frame(0).position[0]).toBe(0);expect(at10.forward).toEqual([-0,-0,-1]);
  });
  it('lags camera rotation with an orthonormal frame and supports endpoint anchors',()=>{
    const cam=(t:number)=>({viewMatrix:Float32Array.of(Math.cos(t),0,-Math.sin(t),0,0,1,0,0,Math.sin(t),0,Math.cos(t),0,0,0,-8,1),
      projectionMatrix:Float32Array.of(2,0,0,0,0,2,0,0,0,0,1,1,0,0,0,1),cameraPosition:{x:0,y:0,z:8}} as SceneCamera);
    const layers=[{kind:'strands',strands:{program:{render:{labels:spec()}}}}] as SceneStrandLayer[];
    const pose=withCurveLabelCameras(cam(1),layers,1,cam).curveLabelCameras![spec().lag];
    expect(Math.atan2(pose.right[2],pose.right[0])).toBeLessThan(1);
    expect(Math.hypot(...pose.right)).toBeCloseTo(1);expect(Math.hypot(...pose.up)).toBeCloseTo(1);
    expect(pose.right.reduce((sum,n,i)=>sum+n*pose.forward[i],0)).toBeCloseTo(0);
    expect([...curveLabelAnchors(Uint32Array.of(0),Uint32Array.of(5),{...spec(),count:1,start:1})]).toEqual([4,4,0,0]);
  });

  it('holds the former world pose briefly after a fast camera move, then catches up',()=>{
    const cam=(t:number)=>({viewMatrix:Float32Array.of(1,0,0,0,0,1,0,0,0,0,1,0,0,0,-8,1),
      projectionMatrix:Float32Array.of(2,0,0,0,0,2,0,0,0,0,1,1,0,0,0,1),cameraPosition:{x:t>=10?5:0,y:0,z:8}} as SceneCamera);
    const layers=[{kind:'strands',strands:{program:{render:{labels:{...spec(),lag:1}}}}}] as SceneStrandLayer[];
    const pose=(t:number)=>withCurveLabelCameras(cam(t),layers,t,cam).curveLabelCameras!['1'];
    expect(pose(10.1).position[0]).toBe(0);
    expect(pose(11).position[0]).toBeGreaterThan(0);expect(pose(11).position[0]).toBeLessThan(5);
    expect(pose(13).position[0]).toBe(5);
  });

  it('preserves mixed styles in transported programs and animates highlighted title words',()=>{
    const g=graph();g.nodes.find(n=>n.id==='labels')!.constants={style:'mixed',sizeVariation:.8,count:12,height:.11};
    const result=compileGeometryGraph(g,geometryParameterReader({}));
    expect(result.render?.labels?.style).toBe('mixed');expect(isGeometryProgram(result)).toBe(true);
    const labels={...spec(),style:'mixed' as const,titles:'FLOW VECTOR'};
    expect([...curveLabelGlyphs(labels,2).slice(0,4)]).toEqual([70,76,79,87].map(n=>n+1024));
    expect([...curveLabelGlyphs(labels,.05).slice(1,11)]).toEqual(Array(10).fill(32));
    expect([...curveLabelGlyphs(labels,5).slice(0,4)]).toEqual([70,76,79,87]);
  });

});
