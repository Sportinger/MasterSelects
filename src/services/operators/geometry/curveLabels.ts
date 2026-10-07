import type { OperatorDefinition, OperatorParameter, OperatorValue } from '../../../types/operatorGraph';
import { STRAND_CURVES_FORMAT } from './curveFormat';

export const CURVE_LABEL_NUMBERS = [
  ['count', 'Cards', 6, 1, 12, 1], ['opacity', 'Opacity', .72, 0, 1, .01],
  ['lag', 'Camera Follow (s)', .22, 0, 2, .01], ['depth', 'Camera Distance', 5, .1, 1000, .1],
  ['offset', 'Side Position', .74, 0, 1.5, .01], ['spacing', 'Preferred Row Spacing', .48, 0, 1, .01],
  ['width', 'Card Width', .43, .05, 1, .01], ['height', 'Card Height', .13, .03, .5, .01],
  ['lineWidth', 'Line Width (px)', 1.2, .25, 8, .1], ['ringSize', 'Marker Radius (px)', 6, 1, 40, .5],
  ['start', 'First Curve Position', .08, 0, 1, .01], ['step', 'Curve Position Step', .145, 0, 1, .01],
  ['firstStrand', 'First Strand', 0, 0, 65535, 1], ['strandStep', 'Strand Step', 2, 0, 65535, 1],
  ['cycle', 'Scan Cycle (s)', 8, 1, 60, .1],
  ['sizeVariation', 'Size Variation', .4, 0, 1, .01],
  ['drift', 'Floating Motion', .65, 0, 2, .01], ['avoidance', 'Avoid Curves', 1, 0, 1, .01],
] as const;
export type CurveLabelNumber = typeof CURVE_LABEL_NUMBERS[number][0];
export type CurveLabelSpec = Record<CurveLabelNumber, number> & { color: string; titles: string; style: 'uniform' | 'mixed' };
const params: OperatorParameter[] = CURVE_LABEL_NUMBERS.map(([id,label,value,min,max,step]) =>
  ({id,label,type:'number',default:value,min,max,step,animatable:true}));
export const CURVE_LABEL_OPERATOR: OperatorDefinition = {
  id:'geometry.curve-labels',version:1,label:'Curve Scan Labels',
  description:'Adds true 3D outline cards and rings linked to final GPU curve points. Cards float, tilt and seek free screen space around projected curves, including crossing to the clearer side; they follow the animated camera with a time-sampled delay; numeric readouts show world coordinates. Bypass removes only labels. Curve indices wrap around available strands. Place before Strand Render. Titles: up to six ASCII labels separated by |.',
  inputs:[{id:'curves',label:'Curves',type:'curves',required:true,contract:{formats:[STRAND_CURVES_FORMAT]}},
    ...params.map(p=>({id:p.id,label:p.label,type:'number' as const}))],
  outputs:[{id:'curves',label:'Curves',type:'curves',contract:{formats:[STRAND_CURVES_FORMAT]}}],
  parameters:[...params,{id:'style',label:'Card Style',type:'select',default:'uniform',options:[{value:'uniform',label:'Uniform'},{value:'mixed',label:'Mixed shapes and fonts'}],animatable:false},{id:'color',label:'Color',type:'color',default:'#b7d4d0'},
    {id:'titles',label:'Scan Labels',type:'text',default:'FIBER TRACK|FLOW SCAN|LOOP ANALYSIS|MOTION FIELD|YARN SIGNAL|STRUCTURE',maxLength:160,animatable:false}],
  runtime:'builtin',invalidates:'appearance',state:'stateless',addable:true,implementation:'shared',consumers:['Weave'],bypass:'passthrough',
};

/** Reject invalid transported/node values rather than silently changing their meaning. */
export function readCurveLabels(read:(id:string)=>OperatorValue):CurveLabelSpec {
  const out:Record<string,unknown>={};
  for(const [id,label,,min,max] of CURVE_LABEL_NUMBERS){
    const value=read(id);
    if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error(`Curve Scan Labels: ${label} must be ${min}–${max}.`);
    if(['count','firstStrand','strandStep'].includes(id)&&!Number.isInteger(value))throw new Error(`Curve Scan Labels: ${label} must be an integer.`);
    out[id]=value;
  }
  const style=read('style');
  if(style!=='uniform'&&style!=='mixed')throw new Error('Curve Scan Labels: choose uniform or mixed card style.');
  out.style=style;
  const rows=Math.ceil(Number(out.count)/2),heightScale=style==='mixed'?1+.3*Number(out.sizeVariation):1;
  if(Number(out.height)*heightScale*rows+.05*(rows-1)>1.85)throw new Error('Curve Scan Labels: reduce card height or count to fit the side rows.');
  const color=read('color'),titles=read('titles');
  if(typeof color!=='string'||!/^#[\da-f]{6}$/i.test(color))throw new Error('Curve Scan Labels: use a six-digit hex color.');
  if(typeof titles!=='string'||!titles.trim()||titles.length>160||!/^[\x20-\x7e]+$/.test(titles))throw new Error('Curve Scan Labels: titles need 1–160 ASCII characters, separated by |.');
  if(titles.split('|').some(title=>!title.trim()||title.length>20))throw new Error('Curve Scan Labels: each title needs 1–20 characters.');
  out.color=color;out.titles=titles;return out as CurveLabelSpec;
}
export function isCurveLabels(value:unknown):value is CurveLabelSpec {
  if(!value||typeof value!=='object')return false;
  const v=value as Record<string,OperatorValue>;
  if(Object.keys(v).some(key=>!['color','titles','style',...CURVE_LABEL_NUMBERS.map(p=>p[0])].includes(key)))return false;
  try{readCurveLabels(id=>v[id]);return true;}catch{return false;}
}
