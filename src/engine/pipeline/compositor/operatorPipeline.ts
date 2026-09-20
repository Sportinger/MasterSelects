import compositeShader from '../../../shaders/composite.wgsl?raw';
import { EXTERNAL_COMPOSITE_SHADER } from './externalCompositeShader';
import type { ImageOperatorProgram } from '../../../types/imageOperatorProgram';

/** Specializes the existing composite pass; graph edges never allocate textures. */
export function createOperatorCompositePipeline(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  external: boolean,
  program: ImageOperatorProgram,
): GPURenderPipeline {
  const source = external ? EXTERNAL_COMPOSITE_SHADER : compositeShader;
  const marker = '  var ec = layerColor.rgb;';
  if (!source.includes(marker)) throw new Error('Composite operator insertion point is missing.');
  const module = device.createShaderModule({
    label: 'operator-composite',
    code: `${program.wgsl}\n${source.replace(marker, `  layerColor = evaluateImageGraph(layerColor${program.values.length ? ', ImageOperatorParameters(layer.operatorValues)' : ''});\n${marker}`)}`,
  });
  return device.createRenderPipeline({
    label: 'operator-composite',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' },
  });
}
