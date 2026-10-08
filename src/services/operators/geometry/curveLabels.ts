import type { OperatorDefinition, OperatorParameter, OperatorValue } from '../../../types/operatorGraph';
import { STRAND_CURVES_FORMAT } from './curveFormat';

export const CURVE_LABEL_NUMBERS = [
  ['count', 'Cards', 6, 1, 12, 1], ['opacity', 'Opacity', .72, 0, 1, .01],
  ['lag', 'Camera Follow (s)', .22, 0, 2, .01], ['depth', 'Camera Distance', 5, .1, 1000, .1],
  ['offset', 'Side Position', .74, 0, 1.5, .01], ['spacing', 'Preferred Row Spacing', .48, 0, 1, .01],
  ['width', 'Card Width', .43, .05, 1, .01], ['height', 'Card Height', .13, .03, .5, .01],
  ['lineWidth', 'Line Width (px)', 1.2, .25, 8, .1], ['ringWeight', 'Marker Line Weight', 1, .5, 8, .1], ['ringSize', 'Marker Radius (px)', 6, 1, 40, .5],
  ['leaderWeight', 'Leader Line Weight', 1, .5, 8, .1], ['trackingGlow', 'Tracking Glow', 0, 0, 1, .01],
  ['start', 'First Curve Position', .08, 0, 1, .01], ['step', 'Curve Position Step', .145, 0, 1, .01],
  ['firstStrand', 'First Strand', 0, 0, 65535, 1], ['strandStep', 'Strand Step', 2, 0, 65535, 1],
  ['cycle', 'Scan Cycle (s)', 8, 1, 60, .1],
  ['transition', 'Intro / Outro (s)', .45, .05, .5, .01],
  ['dutyCycle', 'Visible Cycle Fraction', .72, .25, 1, .01],
  ['retarget', 'Released Tracking Blend', 0, 0, 1, .01],
  ['detachedFocus', 'Detached Section Focus', 0, 0, 1, .01],
  ['releaseProgress', 'Released Curve Fraction', 0, 0, 1, .01],
  ['releaseMargin', 'Released Pool Margin', 0, 0, .9, .01],
  ['followShare', 'Released Tracker Share', .85, 0, 1, .01],
  ['depthSpread', 'Depth Spread', 0, 0, .6, .01],
  ['depthMotion', 'Depth Travel', 0, 0, .6, .01],
  ['introSpread', 'Opening Build-up (s)', 0, 0, 30, .1],
  ['motionSpeed', 'Floating Speed', 1, 0, 2, .01],
  ['fontVariation', 'Font Size Variation', 0, 0, 1, .01],
  ['boldFlashes', 'Brief Bold Flashes', 0, 0, 1, .01],
  ['textScramble', 'Changing Readouts', 0, 0, 1, .01],
  ['echoStrength', 'Window Echoes', 0, 0, 1, .01],
  ['sizeVariation', 'Size Variation', .4, 0, 1, .01],
  ['drift', 'Floating Motion', .65, 0, 2, .01], ['avoidance', 'Avoid Curves', 1, 0, 1, .01],
] as const;
export type CurveLabelNumber = typeof CURVE_LABEL_NUMBERS[number][0];
export type CurveLabelSpec = Record<CurveLabelNumber, number> & { color: string; markerColor: string; titles: string; style: 'uniform' | 'mixed' };
const params: OperatorParameter[] = CURVE_LABEL_NUMBERS.map(([id,label,value,min,max,step]) =>
  ({id,label,type:'number',default:value,min,max,step,animatable:true}));
export const CURVE_LABEL_OPERATOR: OperatorDefinition = {
  id:'geometry.curve-labels',version:1,label:'Curve Scan Labels',
  description:'Adds true 3D outline cards and rings linked to final GPU curve points. Cards float, tilt and seek free screen space around projected curves, including crossing to the clearer side; they follow the animated camera with a time-sampled delay; numeric readouts show world coordinates. Bypass removes only labels. Curve indices wrap around available strands. Place before Strand Render. Titles: up to six ASCII labels separated by |.',
  inputs:[{id:'curves',label:'Curves',type:'curves',required:true,contract:{formats:[STRAND_CURVES_FORMAT]}},
    ...params.map(p=>({id:p.id,label:p.label,type:'number' as const}))],
  outputs:[{id:'curves',label:'Curves',type:'curves',contract:{formats:[STRAND_CURVES_FORMAT]}}],
  parameters:[...params,{id:'style',label:'Card Style',type:'select',default:'uniform',options:[{value:'uniform',label:'Uniform'},{value:'mixed',label:'Mixed shapes and fonts'}],animatable:false},{id:'color',label:'Color',type:'color',default:'#b7d4d0'},
    {id:'markerColor',label:'Tracking Ring Color',type:'color',default:'#b7d4d0'},
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
  if(Number(out.depthSpread)+Number(out.depthMotion)>.8)throw new Error('Curve Scan Labels: combined depth spread and travel must be at most 0.8 to keep cards in front of the camera.');
  const style=read('style');
  if(style!=='uniform'&&style!=='mixed')throw new Error('Curve Scan Labels: choose uniform or mixed card style.');
  out.style=style;
  const rows=Math.ceil(Number(out.count)/2),heightScale=style==='mixed'?1+.3*Number(out.sizeVariation):1;
  if(Number(out.height)*heightScale*rows+.05*(rows-1)>1.85)throw new Error('Curve Scan Labels: reduce card height or count to fit the side rows.');
  const color=read('color'),markerColor=read('markerColor'),titles=read('titles');
  if(typeof markerColor!=='string'||!/^#[\da-f]{6}$/i.test(markerColor))throw new Error('Curve Scan Labels: use a six-digit tracking ring color.');
  if(typeof color!=='string'||!/^#[\da-f]{6}$/i.test(color))throw new Error('Curve Scan Labels: use a six-digit hex color.');
  if(typeof titles!=='string'||!titles.trim()||titles.length>160||!/^[\x20-\x7e]+$/.test(titles))throw new Error('Curve Scan Labels: titles need 1–160 ASCII characters, separated by |.');
  if(titles.split('|').some(title=>!title.trim()||title.length>20))throw new Error('Curve Scan Labels: each title needs 1–20 characters.');
  out.color=color;out.markerColor=markerColor;out.titles=titles;return out as CurveLabelSpec;
}
export function isCurveLabels(value:unknown):value is CurveLabelSpec {
  if(!value||typeof value!=='object')return false;
  const v=value as Record<string,OperatorValue>;
  if(Object.keys(v).some(key=>!['color','markerColor','titles','style',...CURVE_LABEL_NUMBERS.map(p=>p[0])].includes(key)))return false;
  try{readCurveLabels(id=>v[id]);return true;}catch{return false;}
}
