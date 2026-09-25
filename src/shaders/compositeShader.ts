import source from './composite.wgsl?raw';
import blendModes from './blendModes.wgsl?raw';
export default source.replace('// BLEND_MODE_FUNCTIONS', blendModes);
