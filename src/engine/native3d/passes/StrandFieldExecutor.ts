import { StrandCurveFlowPass, type StrandCurveFlow } from './StrandCurveFlowPass';
import shader from '../shaders/StrandPointFields.wgsl?raw';
import { FIELD_FUNCTIONS_WGSL } from '../../../services/operators/fields/fieldFunctionsWgsl';
import type { StrandFieldCode } from './strandFieldShader';
import { StrandFramesPass } from './StrandFramesPass';

import type { StrandContactProjector } from './StrandContactProjector';
import type { CurveContactSpec } from '../../../services/operators/geometry/curveContacts';

interface Pipelines { deform: GPUComputePipeline; measure: GPUComputePipeline }

/** Shared field compiler/pipelines; constants, topology and animated input positions are data. */
export class StrandFieldExecutor {
  private device?: GPUDevice;
  private layout?: GPUBindGroupLayout;
  private pipelines = new Map<string, Pipelines>();
  private frames = new StrandFramesPass();
  private flow = new StrandCurveFlowPass();

  private initialize(device: GPUDevice): void {
    if (this.device === device) return;
    this.dispose(); this.device = device;
    this.layout = device.createBindGroupLayout({ label: 'strand-point-fields', entries: Array.from({ length: 7 }, (_, binding) => ({
      binding, visibility: GPUShaderStage.COMPUTE,
      buffer: { type: binding === 0 ? 'uniform' : binding < 5 ? 'read-only-storage' : 'storage' },
    })) });
  }

  private pipelineFor(device: GPUDevice, fields: StrandFieldCode): Pipelines {
    let pipelines = this.pipelines.get(fields.code);
    if (pipelines) this.pipelines.delete(fields.code);
    else {
      const module = device.createShaderModule({ label: 'strand-point-fields', code: shader.replace('//@strand-fields', `${FIELD_FUNCTIONS_WGSL}\n${fields.code}`) });
      const layout = device.createPipelineLayout({ bindGroupLayouts: [this.layout!] });
      const pipeline = (entryPoint: string) => device.createComputePipeline({ label: `strand-fields-${entryPoint}`, layout, compute: { module, entryPoint } });
      pipelines = { deform: pipeline('deform'), measure: pipeline('measure') };
    }
    this.pipelines.set(fields.code, pipelines);
    while (this.pipelines.size > 8) this.pipelines.delete(this.pipelines.keys().next().value!);
    return pipelines;
  }

  /** Buffers in shader binding order. Submission precedes all draws of the resulting snapshot. */
  submit(device: GPUDevice, fields: StrandFieldCode, buffers: GPUBuffer[], points: number, strands: number,
    readback: GPUBuffer, temporaries: GPUBuffer[], contact?: { projector: StrandContactProjector; spec: CurveContactSpec }, flow?: { spec: StrandCurveFlow; scratch: GPUBuffer }): void {
    this.initialize(device);
    const pipelines = this.pipelineFor(device, fields);
    const groups = Math.ceil(points / 256), width = Math.min(groups, device.limits.maxComputeWorkgroupsPerDimension);
    const statsGroups = Math.ceil(strands / 64), statsWidth = Math.min(statsGroups, device.limits.maxComputeWorkgroupsPerDimension);
    device.queue.writeBuffer(buffers[0], 0, Uint32Array.of(points, strands, width, statsWidth));
    const group = device.createBindGroup({ layout: this.layout!, entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })) });
    const encoder = device.createCommandEncoder({ label: 'strand-point-fields' });
    let pass = encoder.beginComputePass();
    pass.setPipeline(pipelines.deform); pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(width, Math.ceil(groups / width));
    this.frames.encode(device, pass, buffers[3], strands, buffers[5], temporaries);
    let validateFlow: ((pass: GPUComputePassEncoder) => void) | undefined;
    if (flow) {
      pass.end();
      validateFlow = this.flow.encode(device, encoder, buffers[5], flow.scratch, buffers[3], buffers[2], buffers[6],
        points, strands, flow.spec, temporaries);
      pass = encoder.beginComputePass();
      this.frames.encode(device, pass, buffers[3], strands, buffers[5], temporaries);
    }
    if (contact) {
      pass.end();
      contact.projector.encode(encoder, buffers[5], buffers[2], buffers[3], contact.spec);
      pass = encoder.beginComputePass();
      this.frames.encode(device, pass, buffers[3], strands, buffers[5], temporaries);
    }
    pass.setPipeline(pipelines.measure); pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(statsWidth, Math.ceil(statsGroups / statsWidth));
    validateFlow?.(pass);
    pass.end();
    encoder.copyBufferToBuffer(buffers[6], 0, readback, 0, strands * 8);
    device.queue.submit([encoder.finish()]);
  }

  dispose(): void { this.pipelines.clear(); this.frames.dispose(); this.flow.dispose(); this.layout = undefined; this.device = undefined; }
}
