import {parseCurveLabelTextCues} from './curveLabelTextCues';
import {parseCurveLabelIntro} from './curveLabelIntro';
import { parseCurveLabelAnchors } from './curveLabelAnchors';
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
  ['lifetimeVariation', 'Lifetime Variation', 0, 0, 1, .01],
  ['scheduleSeed', 'Appearance Seed', 0, 0, 9999, 1],
  ['holdStart', 'Tracking Hold Start (s)', 0, 0, 36000, .01],
  ['holdEnd', 'Tracking Hold End (s)', 0, 0, 36000, .01],
  ['holdCount', 'Held Tracking Cards', 0, 0, 12, 1],
  ['rotationRange', 'Window Rotation (deg)', 0, 0, 45, 1],
  ['lockCount', 'Camera Locks', 0, 0, 16, 1],
  ['lockStart', 'First Camera Lock (s)', 10, 0, 36000, .1],
  ['lockInterval', 'Camera Lock Interval (s)', 18, 6, 120, .1],
  ['lockDuration', 'Camera Lock Hold (s)', 2.5, 2, 3, .1],
  ['earlyLockCount', 'Early Camera Locks', 0, 0, 3, 1],
  ['earlyLockStart', 'Early Locks Start (s)', 5, 0, 36000, .1],
  ['earlyLockEnd', 'Early Locks End (s)', 13, 0, 36000, .1],
  ['stackCount', 'Locked Cards per Side', 0, 0, 3, 1],
  ['stackStart', 'Stack Lock Start (s)', 13, 0, 36000, .1],
  ['stackEnd', 'Stack Lock End (s)', 21, 0, 36000, .1],
  ['stackStagger', 'Stack Card Delay (s)', 0, 0, 3, .1],
  ['transition', 'Intro / Outro (s)', .45, .05, .5, .01],
  ['dutyCycle', 'Visible Cycle Fraction', .72, .25, 1, .01],
  ['anchorFocus', 'Directional Tracking Focus', 0, 0, 1, .01],
  ['anchorFocusCount', 'Focused Tracking Cards', 6, 0, 12, 1],
  ['anchorFocusAxis', 'Focus Axis (X Y Z -X -Y -Z)', 2, 0, 5, 1],
  ['rollOffset', 'Added Roll (deg)', 0, -180, 180, .1],
  ['outroStart', 'Final Exit Start (s)', -1, -1, 36000, .01],
  ['outroSpread', 'Final Exit Spread (s)', .25, 0, 5, .01],
  ['outroRetract', 'Leader Retraction (s)', .22, .05, 2, .01],
  ['outroDuration', 'Final Card Exit (s)', .3, .05, 2, .01],
  ['finalStart', 'Final Target Start (s)', 0, 0, 36000, .01],
  ['finalEnd', 'Final Target Hold End (s)', 0, 0, 36000, .01],
  ['finalStagger', 'Final Target Card Delay (s)', .35, 0, 5, .01],
  ['finalTransition', 'Final Target Travel (s)', .6, .05, 5, .01],
  ['finalStrand', 'Final Target Strand', 0, 0, 65535, 1],
  ['finalPosition', 'Final Material Position', 0, -100000, 100000, .001],
  ['retarget', 'Released Tracking Blend', 0, 0, 1, .01],
  ['detachedFocus', 'Detached Section Focus', 0, 0, 1, .01],
  ['releaseProgress', 'Released Curve Fraction', 0, 0, 1, .01],
  ['releaseMargin', 'Released Pool Margin', 0, 0, .9, .01],
  ['followShare', 'Released Tracker Share', .85, 0, 1, .01],
  ['alertGroups', 'Warning Text Groups', 0, 0, 6, 1],
  ['depthSpread', 'Depth Spread', 0, 0, .6, .01],
  ['depthMotion', 'Depth Travel', 0, 0, .6, .01],
  ['introSpread', 'Opening Build-up (s)', 0, 0, 30, .1],
  ['openingMarkers', 'Amber Opening Rings', 0, 0, 12, 1],
  ['introScale', 'Intro Card Scale', 1.4, 1, 2, .01],
  ['introDistance', 'Intro Camera Distance', .78, .5, 1, .01],
  ['introTextDepth', 'Intro Text Depth', .02, 0, .1, .001],
  ['introTextMotion', 'Intro Text Motion', .4, 0, 1, .01],
  ['introTextOpacity', 'Intro Text Opacity', 1, 0, 1, .01],
  ['motionSpeed', 'Floating Speed', 1, 0, 2, .01],
  ['fontVariation', 'Font Size Variation', 0, 0, 1, .01],
  ['boldFlashes', 'Brief Bold Flashes', 0, 0, 1, .01],
  ['glitchStrength', 'Window Glitch Wave', 0, 0, 1, .01],
  ['textScramble', 'Changing Readouts', 0, 0, 1, .01],
  ['echoStrength', 'Window Echoes', 0, 0, 1, .01],
  ['sizeVariation', 'Size Variation', .4, 0, 1, .01],
  ['drift', 'Floating Motion', .65, 0, 2, .01], ['avoidance', 'Avoid Curves', 1, 0, 1, .01],
] as const;
export type CurveLabelNumber = typeof CURVE_LABEL_NUMBERS[number][0];
export type CurveLabelSpec = Record<CurveLabelNumber, number> & { color: string; markerColor: string; finalColor?: string; titles: string; anchorOverrides?: string; holdAnchors?: string; introTitles?: string; textCues?: string; style: 'uniform' | 'mixed' };
const params: OperatorParameter[] = CURVE_LABEL_NUMBERS.map(([id,label,value,min,max,step]) =>
  ({id,label,type:'number',default:value,min,max,step,animatable:true}));
export const CURVE_LABEL_OPERATOR: OperatorDefinition = {
  id:'geometry.curve-labels',version:1,label:'Curve Scan Labels',
  description:'Adds true 3D outline cards and rings linked to final GPU curve points. Cards float, tilt and seek free screen space around projected curves, including crossing to the clearer side; they follow the animated camera with a time-sampled delay; numeric readouts show world coordinates. Bypass removes only labels. Curve indices wrap around available strands. Place before Strand Render. Titles: up to six ASCII labels separated by |. Anchor Overrides: zero-based card:strand@material-position entries separated by |; explicit positions follow the moving material and do not replace released tracking. Held Material Anchors uses the same syntax for the complete appearance covering Tracking Hold Start/End; these cards remain within the frame during the hold. Amber Opening Rings colors the first scheduled markers amber during their initial episode. Rings, leaders and cards share the same intro and outro timing. Intro Titles replaces the first two initial readouts with bold cream Unicode phrases with a brief grapheme decode: | separates cards, > separates quick language variants. Locked Cards per Side reserves lower left/right stacks during Stack Lock Start/End, extending their appearances and superseding overlapping individual locks. Stack Card Delay shifts each card’s docking and release; Start/End refer to the first card. Early Camera Locks chooses separate visible episodes within Early Locks Start/End. Warning Text Groups adds growing bold red exclamation groups only after released-target acquisition. Intro scale and camera distance enlarge those cards; text has independent depth and gentle 3D motion. Text Cues accepts ordered JSON start/end seconds, panels of four ASCII rows (20 columns), and up to two Unicode headlines with text/header/footer. Content replaces readouts, including locked cards, without changing their existing lifetimes or tracking. Initial Intro Titles retain priority. Final Target Hold End greater than Final Target Start enables sequential material-target acquisition; cards extend their current appearance through the hold and change to Final Target Color only on arrival. Final Material Position wraps and accepts a node-driven moving material coordinate. Directional Tracking Focus smoothly moves the first Focused Tracking Cards along their current source curves toward a chosen local axis (0/1/2 = +X/+Y/+Z, 3/4/5 = negative axes). It uses a circular material-coordinate average of the curve extremity, remains on the curve, and leaves released/final targets intact. Added Roll rotates the floating planes without changing their anchors or camera locks. Final Exit Start >= 0 enables a seeded staggered terminal exit: retract each leader from the subject toward its card, then remove that card; no new appearance starts afterward.',
  inputs:[{id:'curves',label:'Curves',type:'curves',required:true,contract:{formats:[STRAND_CURVES_FORMAT]}},
    ...params.map(p=>({id:p.id,label:p.label,type:'number' as const}))],
  outputs:[{id:'curves',label:'Curves',type:'curves',contract:{formats:[STRAND_CURVES_FORMAT]}}],
  parameters:[...params,{id:'style',label:'Card Style',type:'select',default:'uniform',options:[{value:'uniform',label:'Uniform'},{value:'mixed',label:'Mixed shapes and fonts'}],animatable:false},{id:'color',label:'Color',type:'color',default:'#b7d4d0'},
    {id:'finalColor',label:'Final Target Color',type:'color',default:'#aa55ff'},
    {id:'markerColor',label:'Tracking Ring Color',type:'color',default:'#b7d4d0'},
    {id:'textCues',label:'Text Cues (JSON)',type:'text',default:'',maxLength:32768,animatable:false},
    {id:'introTitles',label:'Intro Titles',type:'text',default:'',maxLength:512,animatable:false},
    {id:'anchorOverrides',label:'Anchor Overrides',type:'text',default:'',maxLength:512,animatable:false},
    {id:'holdAnchors',label:'Held Material Anchors',type:'text',default:'',maxLength:512,animatable:false},
    {id:'titles',label:'Scan Labels',type:'text',default:'FIBER TRACK|FLOW SCAN|LOOP ANALYSIS|MOTION FIELD|YARN SIGNAL|STRUCTURE',maxLength:160,animatable:false}],
  runtime:'builtin',invalidates:'appearance',state:'stateless',addable:true,implementation:'shared',consumers:['Weave'],bypass:'passthrough',
};

/** Reject invalid transported/node values rather than silently changing their meaning. */
export function readCurveLabels(read:(id:string)=>OperatorValue):CurveLabelSpec {
  const out:Record<string,unknown>={};
  for(const [id,label,initial,min,max] of CURVE_LABEL_NUMBERS){
    const value=read(id)??(['anchorFocus','anchorFocusCount','anchorFocusAxis','rollOffset','outroStart','outroSpread','outroRetract','outroDuration','finalStart','finalEnd','finalStagger','finalTransition','finalStrand','finalPosition','openingMarkers','introScale','introDistance','introTextDepth','introTextMotion','introTextOpacity','stackCount','stackStart','stackEnd','stackStagger','earlyLockCount','earlyLockStart','earlyLockEnd','alertGroups'].includes(id)?initial:undefined);
    if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error(`Curve Scan Labels: ${label} must be ${min}–${max}.`);
    if(['anchorFocusCount','anchorFocusAxis','finalStrand','count','firstStrand','strandStep','scheduleSeed','holdCount','lockCount','openingMarkers','stackCount','earlyLockCount','alertGroups'].includes(id)&&!Number.isInteger(value))throw new Error(`Curve Scan Labels: ${label} must be an integer.`);
    out[id]=value;
  }
  if(Number(out.finalEnd)>Number(out.finalStart)&&Number(out.finalEnd)-Number(out.finalStart)<(Number(out.count)-1)*Number(out.finalStagger)+Number(out.finalTransition))
    throw new Error('Curve Scan Labels: final hold must include every card delay and target travel.');
  const finalColor=read('finalColor')??'#aa55ff';
  if(typeof finalColor!=='string'||!/^#[\da-f]{6}$/i.test(finalColor))throw new Error('Curve Scan Labels: use a six-digit final target color.');
  out.finalColor=finalColor;
  if(Number(out.stackCount)>0&&(Number(out.stackCount)*2>Number(out.count)||Number(out.stackEnd)-Number(out.stackStart)<1.5))
    throw new Error('Curve Scan Labels: camera stacks need enough cards for both sides and an interval of at least 1.5 seconds.');
  if(Number(out.earlyLockCount)>0&&Number(out.earlyLockEnd)-Number(out.earlyLockStart)<Number(out.earlyLockCount)*(Number(out.lockDuration)+1.2)+(Number(out.earlyLockCount)-1)*.3)
    throw new Error('Curve Scan Labels: widen the early-lock interval to fit the holds, docking, release and gaps.');
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
  const textCues=read('textCues')??'';
  if(typeof textCues!=='string')throw new Error('Curve Scan Labels: Text Cues must be JSON text.');
  const cues=parseCurveLabelTextCues(textCues);
  if(cues.some(cue=>(cue.headlines?.length??0)>Number(out.count)))
    throw new Error('Curve Scan Labels: Text Cues cannot show more headlines than Cards.');
  out.textCues=textCues;
  const introTitles=read('introTitles')??'';
  if(typeof introTitles!=='string')throw new Error('Curve Scan Labels: Intro Titles must be text.');
  parseCurveLabelIntro(introTitles);out.introTitles=introTitles;
  const anchorOverrides=read('anchorOverrides')??'';
  if(typeof anchorOverrides!=='string')throw new Error('Curve Scan Labels: Anchor Overrides must be text.');
  parseCurveLabelAnchors(anchorOverrides);out.anchorOverrides=anchorOverrides;
  const holdAnchors=read('holdAnchors')??'';
  if(typeof holdAnchors!=='string')throw new Error('Curve Scan Labels: Held Material Anchors must be text.');
  const held=parseCurveLabelAnchors(holdAnchors);
  if(held.length&&(Number(out.holdEnd)<=Number(out.holdStart)||held.some(a=>a.card>=Number(out.holdCount)||a.card>=Number(out.count))))
    throw new Error('Curve Scan Labels: Held Material Anchors need an ordered tracking hold interval and card indices below Held Tracking Cards and Cards.');
  out.holdAnchors=holdAnchors;
  out.color=color;out.markerColor=markerColor;out.titles=titles;return out as CurveLabelSpec;
}
export function isCurveLabels(value:unknown):value is CurveLabelSpec {
  if(!value||typeof value!=='object')return false;
  const v=value as Record<string,OperatorValue>;
  if(Object.keys(v).some(key=>!['finalColor','color','markerColor','titles','style','anchorOverrides','holdAnchors','introTitles','textCues',...CURVE_LABEL_NUMBERS.map(p=>p[0])].includes(key)))return false;
  try{readCurveLabels(id=>v[id]);return true;}catch{return false;}
}
