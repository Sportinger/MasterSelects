import blendFunctions from '../../shaders/blendModes.wgsl?raw';
import { SEQUENCE_BLEND_MODES } from './sequenceBlendModes';

// Namespace shared timeline functions so an operator can also run inside a compositor.
const functionNames = [...blendFunctions.matchAll(/fn (\w+)\(/g)].map(match => match[1]);
const namespaced = blendFunctions.replace(new RegExp(`\\b(${[...functionNames, 'hash'].join('|')})\\b`, 'g'), 'sequence_$1');
const cases = SEQUENCE_BLEND_MODES.map((mode, index) => {
  if (mode.includes('dissolve') || mode.startsWith('stencil-') || mode.startsWith('silhouette-') || mode === 'alpha-add') return '';
  const name = 'blend' + mode.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join('');
  return `case ${index}u: { blended = sequence_${name}(back.rgb, front.rgb); }`;
}).join('\n');
const id = (mode: typeof SEQUENCE_BLEND_MODES[number]) => SEQUENCE_BLEND_MODES.indexOf(mode);
export const SEQUENCE_BLEND_WGSL = `
fn sequence_hash(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
${namespaced}
fn blendSequencePixel(back: vec4f, front: vec4f, mode: f32, opacity: f32, uv: vec2f, time: f32) -> vec4f {
  let code = u32(max(0.0, floor(mode + 0.5)));
  var sa = clamp(front.a * opacity, 0.0, 1.0); let ba = clamp(back.a, 0.0, 1.0);
  if (code == ${id('dissolve')}u || code == ${id('dancing-dissolve')}u) {
    let seed = select(0.0, time * 60.0, code == ${id('dancing-dissolve')}u);
    sa = select(0.0, 1.0, sequence_hash(uv * 1000.0 + vec2f(seed)) < sa);
  }
  if (code >= ${id('stencil-alpha')}u && code <= ${id('silhouette-luma')}u) {
    var mask = select(front.a, sequence_getLuminosity(front.rgb), code == ${id('stencil-luma')}u || code == ${id('silhouette-luma')}u);
    if (code >= ${id('silhouette-alpha')}u) { mask = 1.0 - mask; }
    let alpha = ba * clamp(mask * opacity, 0.0, 1.0);
    if (alpha <= 0.0) { return vec4f(0.0); }
    return vec4f(back.rgb, alpha);
  }
  if (code == ${id('alpha-add')}u) { return vec4f(mix(back.rgb, front.rgb, sa), min(1.0, ba + sa)); }
  let alpha = sa + ba * (1.0 - sa);
  if (alpha <= 0.0) { return vec4f(0.0); }
  var blended = front.rgb;
  switch code { ${cases} default: {} }
  return vec4f(clamp((sa * ((1.0 - ba) * front.rgb + ba * blended) + (1.0 - sa) * ba * back.rgb) / alpha, vec3f(0.0), vec3f(1.0)), alpha);
}`;
