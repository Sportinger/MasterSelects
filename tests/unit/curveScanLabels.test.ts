import {parseCurveLabelIntro} from '../../src/services/operators/geometry/curveLabelIntro';
import {curveLabelIntroState} from '../../src/engine/native3d/labels/curveLabelIntro';
import {parseCurveLabelAnchors} from '../../src/services/operators/geometry/curveLabelAnchors';
import {curveLabelEpisode,curveLabelOpeningRank} from '../../src/engine/native3d/labels/curveLabelSchedule';
import {changingCurveReadouts} from '../../src/engine/native3d/labels/curveLabelReadout';
import {curveLabelDecoration} from '../../src/engine/native3d/labels/curveLabelDecoration';
import {describe,it,expect} from 'vitest';
import {createWaveStrandsGraph,geometryParameterReader} from '../../src/services/operators/geometry/weaveGraph';
import {compileGeometryGraph} from '../../src/services/operators/geometry/geometryProgram';
import {isGeometryProgram} from '../../src/services/operators/geometry/geometryProgramValidation';
import {CURVE_LABEL_OPERATOR,readCurveLabels,isCurveLabels} from '../../src/services/operators/geometry/curveLabels';
import {curveLabelAnchors,curveLabelGlyphs,curveLabelLife,curveLabelTiming} from '../../src/engine/native3d/labels/curveLabelLayout';
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
  it('uses held material anchors for a complete held appearance without changing opening or released anchors',()=>{
    const s={...spec(),count:4,holdCount:4,holdStart:22,holdEnd:27,
      holdAnchors:'0:2@0.94 | 1:4@0.86 | 2:6@0.80 | 3:8@0.74',anchorOverrides:'0:1@0.25'};
    const starts=Uint32Array.from({length:13},(_,i)=>i*101),counts=new Uint32Array(13).fill(101);
    expect(curveLabelAnchors(starts,counts,s,false,1)[3]).toBe(1);
    for(const t of [22,24,27,23]) {
      const a=curveLabelAnchors(starts,counts,s,false,t);
      expect(Array.from({length:4},(_,i)=>a[i*4+3])).toEqual([2,4,6,8]);
      for(let card=0;card<4;card++)expect(curveLabelLife(s,t,card).reveal).toBeCloseTo(1,12);
      expect(curveLabelAnchors(starts,counts,s,true,t)).toEqual(curveLabelAnchors(starts,counts,{...s,holdAnchors:''},true,t));
    }
    const episode=curveLabelEpisode(s,24,0);
    expect(curveLabelAnchors(starts,counts,s,false,episode.birth+.001)[3]).toBe(2);
    expect(curveLabelAnchors(starts,counts,s,false,episode.birth+episode.visible-.001)[3]).toBe(2);
    expect(curveLabelAnchors(starts,counts,s,false,episode.birth+episode.period+.001)[3]).toBe(1);
    expect(isCurveLabels(s)).toBe(true);
    expect(isCurveLabels({...s,holdCount:2})).toBe(false);
    expect(isCurveLabels({...s,holdStart:27,holdEnd:22})).toBe(false);
    const g=graph();g.nodes.find(n=>n.id==='labels')!.constants={holdCount:4,holdStart:22,holdEnd:27,holdAnchors:s.holdAnchors};
    const p=compileGeometryGraph(g,geometryParameterReader({}));expect(p.render!.labels!.holdAnchors).toBe(s.holdAnchors);
    expect(isGeometryProgram(JSON.parse(JSON.stringify(p)))).toBe(true);
  });
  it('shapes whole multilingual intro phrases on the actual first two cards, only in their first episodes',()=>{
    const introTitles='Kunst? > art > कला | Kann weg.';
    expect(parseCurveLabelIntro(introTitles)).toEqual([['KUNST?','ART','कला'],['KANN WEG.']]);
    const s={...spec(),count:12,height:.11,lifetimeVariation:1,scheduleSeed:17,introSpread:5,introTitles};
    const initial=curveLabelIntroState(s,0);expect(initial.map(v=>v.card)).toEqual([0,10]);expect(initial.map(v=>v.row)).toEqual([0,24]);
    const episode=curveLabelEpisode(s,0,0);
    const at=(seconds:number)=>curveLabelIntroState(s,episode.birth+seconds)[0];
    expect(at(.7)).toMatchObject({row:7,pulse:0});
    expect(at(1.23)).toMatchObject({row:8,pulse:expect.closeTo(.35,6)});
    expect(at(2.8).row).toBe(23);expect(at(3.7)).toMatchObject({card:0,pulse:-1});
    expect(at(episode.visible).card).toBe(-1);
    expect(at(.25).row).toBeLessThan(at(.5).row);
    const late=curveLabelIntroState(s,50);expect(late.every(v=>v.card===-1)).toBe(true);
    expect(curveLabelIntroState(s,0)).toEqual(initial);
    const g=graph();g.nodes.find(n=>n.id==='labels')!.constants={introTitles};
    const program=compileGeometryGraph(g,geometryParameterReader({}));expect(program.render!.labels!.introTitles).toBe(introTitles);
    expect(isGeometryProgram(JSON.parse(JSON.stringify(program)))).toBe(true);
    for(const invalid of ['one||two','one>','a|b|c','x'.repeat(33),'line\nnext'])expect(()=>parseCurveLabelIntro(invalid)).toThrow(/Intro Titles/);
  });

  it('pins chosen cards to exact material coordinates without changing released destinations',()=>{
    const s={...spec(),count:3,firstStrand:0,strandStep:1,start:.4,step:.1,anchorOverrides:'0:1@0.25 | 2:0@1'};
    const starts=Uint32Array.of(0,5),counts=Uint32Array.of(5,9);
    const a=curveLabelAnchors(starts,counts,s);
    expect([...a.slice(0,4)]).toEqual([7,8,0,1]);
    expect([...a.slice(8,12)]).toEqual([4,4,0,0]);
    expect(curveLabelAnchors(starts,counts,s,true)).toEqual(curveLabelAnchors(starts,counts,{...s,anchorOverrides:''},true));
    const g=graph();g.nodes.find(n=>n.id==='labels')!.constants={anchorOverrides:s.anchorOverrides,openingMarkers:2};
    const program=compileGeometryGraph(g,geometryParameterReader({}));
    expect(program.render!.labels).toMatchObject({anchorOverrides:s.anchorOverrides,openingMarkers:2});
    expect(isGeometryProgram(JSON.parse(JSON.stringify(program)))).toBe(true);
  });
  it('rejects ambiguous or invalid anchors and keeps older transported labels compatible',()=>{
    for(const value of ['0:2@.5|0:1@.4','12:0@.5','0:65536@0','0:2@1.1','0:-1@0','NaN:0@.2','0:1@Infinity','1:2@.3|'])
      expect(()=>parseCurveLabelAnchors(value)).toThrow(/Curve Scan Labels/);
    expect(parseCurveLabelAnchors('')).toEqual([]);
    const old={...spec()};delete (old as Partial<typeof old>).openingMarkers;delete old.anchorOverrides;
    expect(isCurveLabels(old)).toBe(true);
    expect(isCurveLabels({...spec(),anchorOverrides:'not an anchor'})).toBe(false);
  });
  it('uses actual randomized opening order for the first visible markers',()=>{
    const s={...spec(),count:12,height:.11,lifetimeVariation:1,scheduleSeed:17,introSpread:5};
    const order=Array.from({length:12},(_,i)=>i).toSorted((a,b)=>curveLabelOpeningRank(s,a)-curveLabelOpeningRank(s,b));
    expect(order.slice(0,2)).toEqual([0,10]);
    for(let i=1;i<order.length;i++)expect(curveLabelTiming(s,order[i]).birth).toBeGreaterThan(curveLabelTiming(s,order[i-1]).birth);
  });

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
    for(const invalid of [{lag:NaN},{lockCount:1.5},{lockCount:17},{lockDuration:4},{lockInterval:0},{count:1.2},{color:'blue'},{markerColor:'yellow'},{trackingGlow:2},{glitchStrength:2},{leaderWeight:0},{ringWeight:9},{titles:'ä'},{titles:'|EMPTY'},{width:50},{count:12,height:.4},{avoidance:2},{drift:-1},{style:'unknown'},{transition:.6},{dutyCycle:0},{depthSpread:.6,depthMotion:.6}])
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

  it('returns to the exact current camera orientation after a rapid turn settles',()=>{
    const cam=(t:number)=>{const a=t<10?0:1.1;return {viewMatrix:Float32Array.of(Math.cos(a),0,-Math.sin(a),0,0,1,0,0,Math.sin(a),0,Math.cos(a),0,0,0,-8,1),
      projectionMatrix:Float32Array.of(2,0,0,0,0,2,0,0,0,0,1,1,0,0,0,1),cameraPosition:{x:0,y:0,z:8}} as SceneCamera;};
    const layers=[{kind:'strands',strands:{program:{render:{labels:{...spec(),lag:1.8}}}}}] as SceneStrandLayer[];
    const pose=(t:number)=>withCurveLabelCameras(cam(t),layers,t,cam).curveLabelCameras!['1.8'];
    expect(pose(10.1).right[0]).toBeCloseTo(1);
    expect(pose(12).right[0]).toBeGreaterThan(Math.cos(1.1));
    expect(pose(15).right[0]).toBeCloseTo(Math.cos(1.1));
    expect(pose(15).right[2]).toBeCloseTo(Math.sin(1.1));
  });

  it('preserves mixed styles in transported programs and animates highlighted title words',()=>{
    const g=graph();g.nodes.find(n=>n.id==='labels')!.constants={style:'mixed',sizeVariation:.8,count:12,height:.11};
    const result=compileGeometryGraph(g,geometryParameterReader({}));
    expect(result.render?.labels?.style).toBe('mixed');expect(isGeometryProgram(result)).toBe(true);
    const labels={...spec(),style:'mixed' as const,titles:'FLOW VECTOR'};
    expect([...curveLabelGlyphs(labels,2).slice(0,4)].map(n=>n%2048)).toEqual([70,76,79,87].map(n=>n+1024));
    expect([...curveLabelGlyphs(labels,.05).slice(1,11)]).toEqual(Array(10).fill(32));
    expect([...curveLabelGlyphs(labels,5).slice(0,4)].map(n=>n%2048)).toEqual([70,76,79,87]);
  });

  it('draws in under half a second, rests offscreen, and retracts with the same timing',()=>{
    const s=spec(),end=s.cycle*s.dutyCycle;
    expect(curveLabelLife(s,0,0).reveal).toBe(0);
    expect(curveLabelLife(s,.5,0).reveal).toBe(1);
    expect(curveLabelLife(s,end+.1,0).reveal).toBe(0);
    for(const t of [.05,.15,.30,.44])expect(curveLabelLife(s,t,0).reveal).toBeCloseTo(curveLabelLife(s,end-t,0).reveal);
    expect(curveLabelLife(s,end+.1,1).reveal).not.toBe(curveLabelLife(s,end+.1,3).reveal);
    expect(curveLabelLife(s,2,0)).toEqual(curveLabelLife(s,2+s.cycle,0));
    expect(curveLabelLife({...s,cycle:1,dutyCycle:.25},.125,0).reveal).toBe(1);
  });

  it('introduces cards one by one at accelerating intervals and keeps unborn cards hidden',()=>{
    const s={...spec(),introSpread:5,count:12};
    const births=Array.from({length:12},(_,i)=>curveLabelTiming(s,i).birth);
    expect(births[0]).toBe(0);expect(births[11]).toBeCloseTo(5);
    for(let i=2;i<12;i++)expect(births[i]-births[i-1]).toBeLessThan(births[i-1]-births[i-2]);
    expect(births.filter(t=>t<=1)).toHaveLength(1);
    expect(curveLabelLife(s,1,5).reveal).toBe(0);
    expect(curveLabelLife(s,births[5]+.5,5).reveal).toBe(1);
  });
  it('keeps ten trackers within released curves and two on the remaining parent curves',()=>{
    const starts=Uint32Array.from({length:13},(_,i)=>i*10),counts=new Uint32Array(13).fill(10);
    const s={...spec(),count:12,releaseProgress:1/6,followShare:.85};
    const target=curveLabelAnchors(starts,counts,s,true);
    const strands=Array.from({length:12},(_,i)=>target[i*4+3]);
    expect(strands.slice(0,10).every(i=>i<=2)).toBe(true);
    expect(strands.slice(10)).toEqual([12,11]);
    const delayed=curveLabelAnchors(starts,counts,{...s,releaseProgress:2.5/6,releaseMargin:.25},true);
    expect(Array.from({length:10},(_,i)=>delayed[i*4+3]).every(i=>i<=2)).toBe(true);
    const finished=curveLabelAnchors(starts,counts,{...s,releaseProgress:1},true);
    expect(finished[9*4+3]).toBe(12);
    expect([...finished].every(Number.isFinite)).toBe(true);
  });

  it('limits occasional window echoes to 6–20 copies with a longer hold, deterministically',()=>{
    const s={...spec(),echoStrength:1};
    const samples=Array.from({length:800},(_,i)=>curveLabelDecoration(s,i/100,0));
    const active=samples.filter(d=>d.copies>0);
    expect(active.length).toBeGreaterThanOrEqual(239);expect(active.length).toBeLessThanOrEqual(480);
    expect(active.every(d=>d.copies>=6&&d.copies<=20&&d.fade>=0&&d.fade<=1)).toBe(true);
    expect(samples).toEqual(Array.from({length:800},(_,i)=>curveLabelDecoration(s,i/100,0)));
    expect(Array.from({length:800},(_,i)=>curveLabelDecoration(s,i/100,1).copies).every(n=>n===0)).toBe(true);
    expect(curveLabelDecoration({...s,cycle:1,dutyCycle:.25},.1,0).copies).toBe(0);
    expect(curveLabelDecoration({...s,introSpread:5},0,5).copies).toBe(0);
  });
  it('briefly bolds a heading without flashing hidden cards or changing its text',()=>{
    const s={...spec(),boldFlashes:1};
    const flashes=Array.from({length:800},(_,i)=>curveLabelDecoration(s,i/100,0).bold);
    expect(flashes.filter(v=>v>.5).length).toBeGreaterThan(5);
    expect(flashes.filter(v=>v>0).length).toBeLessThanOrEqual(18);
    expect(curveLabelDecoration(s,7.5,0).bold).toBe(0);
    expect(curveLabelDecoration({...s,boldFlashes:0},2,0).bold).toBe(0);
  });
  it('scrambles selected readouts briefly before resolving new words, preserving coordinates',()=>{
    const a=changingCurveReadouts('FLOW VECTOR',.02,0,1),b=changingCurveReadouts('FLOW VECTOR',.12,0,1);
    expect(a.status).not.toBe(b.status);expect(a).toEqual(changingCurveReadouts('FLOW VECTOR',.02,0,1));
    expect(changingCurveReadouts('FLOW VECTOR',.4,0,1)).toEqual(changingCurveReadouts('FLOW VECTOR',1,0,1));
    expect(changingCurveReadouts('FLOW VECTOR',2.5,0,1).title).not.toBe(changingCurveReadouts('FLOW VECTOR',1,0,1).title);
    expect(changingCurveReadouts('FLOW VECTOR',.12,2,1)).toEqual({title:'FLOW VECTOR',status:'SCANNING'});
    const before=curveLabelGlyphs(spec(),.12),after=curveLabelGlyphs({...spec(),textScramble:1},.12);
    expect([...after.slice(42,49)]).toEqual([...before.slice(42,49)]);
  });
});
