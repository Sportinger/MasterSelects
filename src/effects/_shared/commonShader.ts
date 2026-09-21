import common from './common.wgsl?raw';
import hash2d from './hash2d.wgsl?raw';
import gaussian from './gaussian.wgsl?raw';

export default `${hash2d}\n${gaussian}\n${common}`;
