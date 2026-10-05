/** Asset authoring, not a runtime solver. Reuses the raw finite simulation cache so
 * presentation windows can be adjusted without recomputing the physical trajectory. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { knitCurves } from '../src/services/operators/geometry/knitCurves';
import { extendCurves } from '../src/services/operators/geometry/extendCurves';
import { buildRodRest, rodCurvePositions } from '../src/services/operators/geometry/rodRest';
import { RodSimulation } from '../src/services/operators/geometry/rodSolver';
import { KNIT_PASSAGE_SHAPE as knit, KNIT_PASSAGE_DURATION as duration,
  KNIT_PASSAGE_SOURCE_RATE as rate, KNIT_PASSAGE_SOURCE_POINTS as sourcePoints,
  interpolateKnitPassageSource, sampleKnitPassage } from '../src/services/operators/geometry/knitPassageWindow';

const base = 'F:/MasterSelects-knit-cache/';
const rawPath = base+'knit-passage-source-v1.f32';
const sourceFrames = Math.ceil(35.3*rate)+1, sourceSize = sourcePoints*4*3;
let raw: Float32Array;
if (existsSync(rawPath)) {
  const buffer = readFileSync(rawPath);
  if (buffer.byteLength !== sourceFrames*sourceSize*4) throw new Error('Unexpected finite passage cache size.');
  raw = new Float32Array(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength));
  console.log('Reusing full finite trajectory:',rawPath);
} else {
  const curves = extendCurves({length:.7,points:24},knitCurves(knit)), count = curves.counts[0];
  const cutoff = (24+2*64)/(count-1);
  const rest = buildRodRest(curves,.022,2,{pinValue:i=>(i%count)/(count-1)<=cutoff?1:0,
    pullStartValue:i=>(i%count)===count-1?.5:1000});
  const simulation = new RodSimulation({nodeId:'finite-knit-passage',radius:.026,segmentLength:.022,
    stretch:.9,bend:.25,friction:.05,damping:1.5,substeps:32,preroll:0,pin:2,pull:11.4,
    pullTime:34.8,pullLinear:true,floor:false,floorHeight:-1,start:0,formEase:.3,
    gravity:0,drag:0,winds:[],turbulence:[]},rest);
  raw = new Float32Array(sourceFrames*sourceSize);
  for (let frame = 0; frame < sourceFrames; frame++) {
    const nodes = simulation.positionsAt(Math.round(frame/rate*60));
    raw.set(rodCurvePositions(rest,nodes,curves),frame*sourceSize);
    if (frame % 60 === 0) console.log('Physical source',frame,'/',sourceFrames-1);
  }
  writeFileSync(rawPath,Buffer.from(raw.buffer));
  writeFileSync(base+'knit-passage-source-v1.json',JSON.stringify({frames:sourceFrames,points:sourcePoints,rows:4,rate,knit}));
}
const points = 641, frames = Math.round(duration*rate)+1, size = points*4*3;
const authored = new Float32Array(frames*size), bounds = [Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
const diagnostics = {maxHalfX:0,minReturnSpan:Infinity,maxReturnSpan:-Infinity}, windowDiagnostics = [];
for (let frame = 0; frame < frames; frame++) {
  const t = frame/(frames-1)*duration;
  const outgoing = interpolateKnitPassageSource(raw,sourceFrames,t+1.5);
  const incoming = interpolateKnitPassageSource(raw,sourceFrames,35.3-t);
  const local = {maxHalfX:0,minReturnSpan:Infinity,maxReturnSpan:-Infinity};
  const positions = sampleKnitPassage(outgoing,incoming,t/duration,points,local);
  diagnostics.maxHalfX = Math.max(diagnostics.maxHalfX,local.maxHalfX);
  diagnostics.minReturnSpan = Math.min(diagnostics.minReturnSpan,local.minReturnSpan);
  diagnostics.maxReturnSpan = Math.max(diagnostics.maxReturnSpan,local.maxReturnSpan);
  windowDiagnostics.push({time:t,...local});
  authored.set(positions,frame*size);
  for (let i = 0; i < positions.length; i++) {
    const axis = i%3;
    bounds[axis] = Math.min(bounds[axis],positions[i]);
    bounds[axis+3] = Math.max(bounds[axis+3],positions[i]);
  }
}
const packed = new Uint16Array(authored.length);
for (let i = 0; i < packed.length; i++) {
  const axis = i%3;
  packed[i] = Math.round((authored[i]-bounds[axis])/(bounds[axis+3]-bounds[axis])*65535);
}
const asset = {version:1,frames,points,rows:4,duration,bounds,data:Buffer.from(packed.buffer).toString('base64')};
writeFileSync(base+'knitPassageFrames.json',JSON.stringify(asset));
try { writeFileSync('src/services/operators/geometry/knitPassageFrames.json',JSON.stringify(asset)); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOSPC') throw error; console.log('C: full; authored asset saved on F:'); }
writeFileSync(base+'knit-passage-authored-v1.f32',Buffer.from(authored.buffer));
writeFileSync(base+'knit-passage-window-diagnostics.json',JSON.stringify(windowDiagnostics));
console.log(JSON.stringify({frames,points,rows:4,duration,bounds,diagnostics,bytes:packed.byteLength,rawCache:rawPath}));
