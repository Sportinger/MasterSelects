import { SCENE_COLOR_FORMAT, SCENE_DEPTH_FORMAT } from '../sceneRenderer/constants';

export interface SpaceTimeDraw {
  buffer: GPUBuffer; count: number; axis: number; angle: number; scale: number;
  slice: number; thickness: number; depth: number; pointSize: number;
}
export const SPACE_TIME_SHADER = /* wgsl */`
struct Params { mvp: mat4x4f, rotation: vec4f, shape: vec4f }
struct Point { positionTime: vec4f, color: vec4f }
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage,read> points: array<Point>;
struct Vertex { @builtin(position) position: vec4f, @location(0) color: vec4f,
  @location(1) corner: vec2f, @location(2) @interpolate(flat) valid: f32 }
@vertex fn vertexMain(@builtin(vertex_index) vertex: u32, @builtin(instance_index) index: u32) -> Vertex {
  let corners = array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
  let point = points[index]; var p = point.positionTime.xyz;
  p.z *= params.shape.x;
  let axis = u32(params.rotation.x); let coordinate = p[axis];
  let c = cos(params.rotation.y); let s = sin(params.rotation.y);
  let tau = point.positionTime.w * params.rotation.z;
  p[axis] = c * coordinate + s * tau;
  let transformedTime = -s * coordinate + c * tau;
  var output: Vertex;
  output.position = params.mvp * vec4f(p,1);
  output.position = vec4f(output.position.xy + corners[vertex] * params.shape.y, output.position.zw);
  output.color = vec4f(point.color.rgb * params.shape.z,params.shape.z);
  output.corner = corners[vertex];
  output.valid = select(0.0,1.0,abs(transformedTime-params.rotation.w)<=params.shape.w*.5);
  return output;
}
@fragment fn fragmentMain(input: Vertex) -> @location(0) vec4f {
  if (input.valid < .5 || dot(input.corner,input.corner)>1.0 || input.color.a<=0.0) { discard; }
  return input.color;
}`;

/** Rendering the selected transformed-time slab never rebuilds or restacks the observations. */
export class SpaceTimeSlicePass {
  private device?: GPUDevice;
  private pipeline?: GPURenderPipeline;
  draw(device: GPUDevice, pass: GPURenderPassEncoder, data: SpaceTimeDraw, mvp: Float32Array,
    opacity: number, temporary: GPUBuffer[]) {
    if (this.device !== device) {
      this.device = device;
      const module = device.createShaderModule({ code: SPACE_TIME_SHADER });
      this.pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: SCENE_COLOR_FORMAT,
          blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: SCENE_DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less-equal' } });
    }
    const values = new Float32Array(24); values.set(mvp);
    values.set([data.axis, data.angle * Math.PI / 180, data.scale, data.slice,
      data.depth, data.pointSize, opacity, data.thickness], 16);
    const buffer = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buffer, 0, values); temporary.push(buffer);
    pass.setPipeline(this.pipeline!);
    pass.setBindGroup(0, device.createBindGroup({ layout: this.pipeline!.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer } }, { binding: 1, resource: { buffer: data.buffer } },
    ] }));
    pass.draw(6, data.count);
  }
  dispose() { this.device = undefined; this.pipeline = undefined; }
}
