import shader from '../shaders/StrandContacts.wgsl?raw';
import { FlockRadixSort } from '../../flock/gpu/FlockRadixSort';
import { CONTACT_POINT_LIMIT, type CurveContactSpec } from '../../../services/operators/geometry/curveContacts';

type Entry = 'initialize' | 'measure' | 'makeKeys' | 'cellRanges' | 'solve' | 'smoothCorrections' | 'finish';
interface Pipelines { layout: GPUBindGroupLayout; entries: Record<Entry, GPUComputePipeline> }
const byDevice = new WeakMap<GPUDevice, Pipelines>();
function pipelinesFor(device: GPUDevice): Pipelines {
  const cached = byDevice.get(device); if (cached) return cached;
  const layout = device.createBindGroupLayout({ entries: Array.from({ length: 9 }, (_, binding) => ({
    binding, visibility: GPUShaderStage.COMPUTE,
    buffer: { type: (binding === 0 ? 'uniform' : [2, 3, 4].includes(binding) ? 'read-only-storage' : 'storage') as GPUBufferBindingType },
  })) });
  const module = device.createShaderModule({ code: shader, label: 'strand-contact-projection' });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const entries = Object.fromEntries((['initialize', 'measure', 'makeKeys', 'cellRanges', 'solve', 'smoothCorrections', 'finish'] as Entry[])
    .map(entryPoint => [entryPoint, device.createComputePipeline({ label: `strand-contact-${entryPoint}`, layout: pipelineLayout, compute: { module, entryPoint } })])) as Record<Entry, GPUComputePipeline>;
  const result = { layout, entries }; byDevice.set(device, result); return result;
}

/** Per-layer scratch; no simulation history or CPU point readback. Reuses the stable GPU radix sort. */
export class StrandContactProjector {
  private readonly pipelines: Pipelines;
  private readonly sort: FlockRadixSort;
  private readonly scratch: GPUBuffer[];
  private readonly buckets: number;
  private readonly device: GPUDevice;
  private readonly points: number;
  constructor(device: GPUDevice, points: number) {
    this.device = device; this.points = points;
    if (!points || points > CONTACT_POINT_LIMIT) throw new Error(`Curve Contact supports up to ${CONTACT_POINT_LIMIT} points.`);
    this.buckets = 2 ** Math.ceil(Math.log2(points * 2));
    this.pipelines = pipelinesFor(device);
    this.sort = new FlockRadixSort(device, points, 0xffff);
    const buffer = (size: number, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST) => device.createBuffer({ label: 'strand-contact-scratch', size, usage });
    this.scratch = [buffer(32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST), buffer(points * 16), buffer(points * 16), buffer(this.buckets * 8), buffer(4)];
  }

  encode(encoder: GPUCommandEncoder, packed: GPUBuffer, contexts: GPUBuffer, ranges: GPUBuffer, spec: CurveContactSpec): void {
    const { device, points, pipelines } = this;
    const [params, a, b, cells, longest] = this.scratch;
    const data = new ArrayBuffer(32);
    new Uint32Array(data).set([points, this.buckets]);
    new Float32Array(data).set([spec.radius, spec.smoothing, spec.strength ?? 1], 2);
    device.queue.writeBuffer(params, 0, data);
    const groups = [0, 1].map(index => device.createBindGroup({ layout: pipelines.layout, entries:
      [params, packed, contexts, ranges, index ? b : a, index ? a : b, this.sort.input, cells, longest]
        .map((buffer, binding) => ({ binding, resource: { buffer } })),
    }));
    let current = 0;
    const run = (entry: Entry, group = current) => {
      const pass = encoder.beginComputePass({ label: `strand-contact-${entry}` });
      pass.setPipeline(pipelines.entries[entry]); pass.setBindGroup(0, groups[group]);
      pass.dispatchWorkgroups(Math.ceil(points / 256)); pass.end();
    };
    run('initialize', 1); // Writes A, the first input.
    // A Jacobi sweep uses previous positions for all contacts; four sweeps give one
    // user iteration enough propagation to approach the sequential CPU projection.
    const sweeps = spec.iterations * 4;
    for (let iteration = 0; iteration < sweeps; iteration++) {
      if (iteration > 0 && iteration < sweeps / 2 && spec.smoothing > 0) { run('smoothCorrections'); current = 1 - current; }
      encoder.clearBuffer(longest); encoder.clearBuffer(cells);
      run('measure'); run('makeKeys'); this.sort.encode(encoder, null); run('cellRanges');
      run('solve'); current = 1 - current;
    }
    run('finish');
  }
  dispose(): void { this.scratch.forEach(buffer => buffer.destroy()); this.sort.dispose(); }
}
