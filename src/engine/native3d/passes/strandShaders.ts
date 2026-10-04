import strandShader from '../shaders/StrandScene.wgsl?raw';
import fiberGeometry from '../shaders/StrandFiberGeometry.wgsl?raw';
import shadowSample from '../shaders/StrandShadowSample.wgsl?raw';
import rasterShader from '../shaders/StrandRaster.wgsl?raw';

/** Yarn geometry shared by the raster passes and the path tracer's fiber emission. */
export const STRAND_FIBER_GEOMETRY_SHADER = fiberGeometry;
/** The strand shader with the deep opacity lookup it shares with lit meshes. */
export const STRAND_SCENE_SHADER = `${shadowSample}\n${fiberGeometry}\n${strandShader}`;
/** The analytic raster kernels, which reuse the strand shader's curves, splines and shading. */
export const STRAND_RASTER_SHADER = `${STRAND_SCENE_SHADER}\n${rasterShader}`;
