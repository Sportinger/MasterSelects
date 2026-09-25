import type { BoundOperatorNode, EffectOperatorGraph } from '../../types/operatorGraph';
import { IMAGE_OPERATOR_PARAMETER_CAPACITY } from './imageOperatorParameters';
import type { ImageOperatorCompileContext } from './imageOperatorChoice';
import { resolveImageOperatorFieldResource, type ImageOperatorFieldResource } from './imageOperatorFieldResources';
import { resolveImageOperatorGlyphAtlas, resolveImageOperatorTextAtlas } from './imageOperatorGlyphResources';
import type { ImageOperatorExternalResource } from './imageOperatorExternalResources';
import { IMAGE_FRAME_HISTORY_RESOURCE_ID, resolveImageOperatorNamedImage, validateImageOperatorNamedImages,
  type ImageOperatorResourceSampling } from './imageOperatorResources';
import type { ImagePlanInstruction } from './imageOperatorPlanTypes';
import { resolveImageOperatorMemoryWindow } from './imageOperatorMemoryResources';

export function validateImageOperatorResourceContext(graph: EffectOperatorGraph, context: ImageOperatorCompileContext): ReadonlyMap<string, ImageOperatorResourceSampling> {
  const namedImages = validateImageOperatorNamedImages(context.namedImages);
  for (const item of graph.nodes.filter(item => item.operator === 'image.named-input')) resolveImageOperatorNamedImage(item.bindings.resource, namedImages);
  if (!context.allowFrameHistory && graph.nodes.some(item => item.operator === 'image.frame-history')) {
    throw new Error('Image frame history requires an explicit compile-context opt-in.');
  }
  if (!context.allowInputHistory && graph.nodes.some(item => item.operator === 'image.sample-history')) {
    throw new Error('Input history requires an explicit compile-context opt-in.');
  }
  return namedImages;
}

export interface ImageOperatorResourceLoweringState {
  readonly resourceInputs: string[];
  readonly resourceSampling: ImageOperatorResourceSampling[];
  readonly externalResources: ImageOperatorExternalResource[];
  readonly fieldResources: ImageOperatorFieldResource[];
}

export function createImageOperatorResourceLowering(options: {
  multipleHistories?: boolean;
  context: ImageOperatorCompileContext; params: Record<string, unknown>; namedImages: ReadonlyMap<string, ImageOperatorResourceSampling>;
  parameterSlots: Map<string, number>; parameterValues: number[]; state: ImageOperatorResourceLoweringState;
  emit: (instruction: ImagePlanInstruction) => number;
  source: (target: BoundOperatorNode, input: string) => { node: BoundOperatorNode; output: string };
  visitSource: (target: BoundOperatorNode, input: string) => number;
  connected: (target: BoundOperatorNode, input: string) => boolean;
  activePixelLoad: () => boolean;
}) {
  const resourceSlot = (resourceId: string, sampling: ImageOperatorResourceSampling, kind: 'Image' | 'Field') => {
    const { resourceInputs, resourceSampling } = options.state;
    let slot = resourceInputs.indexOf(resourceId);
    if (slot >= 0 && resourceSampling[slot] !== sampling) {
      throw new Error(kind === 'Field' ? `Field resource ${resourceId} conflicts with an image resource.`
        : `Image resource ${resourceId} has incompatible sampling contracts.`);
    }
    if (slot < 0) {
      if (resourceInputs.length >= 8) throw new Error('Image pass exceeds 8 materialized resource inputs.');
      slot = resourceInputs.push(resourceId) - 1; resourceSampling.push(sampling);
    }
    return slot;
  };
  return (current: BoundOperatorNode, output: string): number | undefined => {
    if (current.operator === 'image.source-motion') {
      const number = (key: string, fallback: number, min: number, max: number) => {
        const binding = current.bindings[key];
        const value = typeof binding === 'string' ? options.params[binding] : current.constants?.[key];
        return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
      };
      const flag = (key: string) => (typeof current.bindings[key] === 'string' ? options.params[current.bindings[key] as string] : current.constants?.[key]) === true;
      const slots = (['atlas', 'ages'] as const).map(part => {
        const id = `source-motion:${current.id}:${part}`;
        if (!options.state.externalResources.some(resource => resource.id === id)) options.state.externalResources.push({
          id, kind: 'source-motion', part, owner: current.id, stabilize: flag('stabilize'), required: flag('required'), denseInverseSearch: flag('denseInverseSearch'), lookback: number('lookback', 4, 0, 6000), timeFactor: number('timeFactor', 1, 1, 100),
        });
        return resourceSlot(id, part === 'atlas' ? 'hardware-linear-clamp' : 'exact-pixel-load', 'Image');
      });
      return options.emit({ nodeId: current.id, operation: 'source-motion', type: 'image', value: Number(flag('denseInverseSearch')),
        inputs: ['uv', 'delay', 'interval'].map(input => options.visitSource(current, input)), resourceSlots: slots });
    }
    if (current.operator === 'image.optical-flow' || current.operator === 'image.directional-smooth' || current.operator === 'image.motion-consistency') {
      const optical = current.operator === 'image.optical-flow';
      const consistency = current.operator === 'image.motion-consistency';
      const slots = (optical ? ['reference', 'target'] : ['image']).map(input => {
        const linked = options.source(current, input);
        if (linked.node.operator !== 'image.resource-input' || typeof linked.node.bindings.resource !== 'string') {
          throw new Error(`${current.operator} requires a compiler-materialized image.`);
        }
        return resourceSlot(linked.node.bindings.resource, 'hardware-linear-clamp', 'Image');
      });
      return options.emit({ nodeId: current.id, operation: optical ? 'optical-flow' : consistency ? 'motion-consistency' : 'directional-smooth', type: 'image',
        inputs: (optical ? ['delta'] : consistency ? ['radius'] : ['direction', 'radius', 'mask']).map(input => options.visitSource(current, input)), resourceSlots: slots });
    }
    if (current.operator === 'image.sample-history') {
      const prefix = options.multipleHistories ? `input-history:${current.id}` : 'input-history';
      const atlas = `${prefix}:atlas`, ages = `${prefix}:ages`;
      for (const [id, part] of [[atlas, 'atlas'], [ages, 'ages']] as const) {
        if (!options.state.externalResources.some(resource => resource.id === id)) options.state.externalResources.push({ id, kind: 'input-history', part, owner: current.id });
      }
      const atlasSlot = resourceSlot(atlas, 'hardware-linear-clamp', 'Image');
      const agesSlot = resourceSlot(ages, 'exact-pixel-load', 'Image');
      // Compile shortcuts remove the motion edge while compensation is off.
      const motion = options.connected(current, 'motion') ? [options.visitSource(current, 'motion')] : [];
      return options.emit({ nodeId: current.id, operation: 'sample-input-history', type: 'image',
        inputs: [options.visitSource(current, 'uv'), options.visitSource(current, 'delay'), options.visitSource(current, 'current'), ...motion],
        resourceSlots: [atlasSlot, agesSlot] });
    }
    const memorySlot = (producer: BoundOperatorNode) => {
      const descriptor = resolveImageOperatorMemoryWindow(producer, options.params, options.context.allowMemoryWindow);
      if (!options.state.externalResources.some(resource => resource.id === descriptor.id)) options.state.externalResources.push(descriptor);
      return resourceSlot(descriptor.id, 'exact-u32-pixel-load', 'Image');
    };
    if (current.operator === 'source.memory-window') {
      if (output === 'memory') throw new Error('Memory window texture outputs are only available through a connected byte-pixel decoder.');
      if (output !== 'metadata') throw new Error(`Memory window ${current.id} has no output ${output}.`);
      return options.emit({ nodeId: current.id, operation: 'resource-metadata', type: 'vec4', inputs: [], value: memorySlot(current) });
    }
    if (current.operator === 'data.decode-byte-pixel') {
      const linked = options.source(current, 'memory');
      if (linked.node.operator !== 'source.memory-window' || linked.output !== 'memory') {
        throw new Error(`Byte pixel decoder ${current.id} requires a memory-window source.`);
      }
      return options.emit({ nodeId: current.id, operation: 'byte-pixel-decode', type: 'vec4',
        inputs: [options.visitSource(current, 'pixel'), options.visitSource(current, 'depth'), options.visitSource(current, 'floatMode'), options.visitSource(current, 'floatGain')],
        value: memorySlot(linked.node) });
    }
    if (current.operator === 'image.resource-input' || current.operator === 'image.named-input' || current.operator === 'image.frame-history') {
      const resourceId = current.operator === 'image.frame-history' ? IMAGE_FRAME_HISTORY_RESOURCE_ID : current.bindings.resource;
      if (typeof resourceId !== 'string') throw new Error(`Image resource input ${current.id} has no resource id.`);
      const sampling = current.operator === 'image.named-input'
        ? resolveImageOperatorNamedImage(resourceId, options.namedImages).sampling : 'hardware-linear-clamp';
      return options.emit({ nodeId: current.id, operation: options.activePixelLoad() ? 'resource-load-input' : 'resource-input',
        type: 'image', inputs: [], value: resourceSlot(resourceId, sampling, 'Image') });
    }
    if (current.operator === 'field.read-nearest-seed') {
      const linked = options.source(current, 'field');
      const descriptor = resolveImageOperatorFieldResource(options.context.fieldResources, linked.node.id, linked.output);
      const existing = options.state.resourceInputs.includes(descriptor.resourceId);
      const slot = resourceSlot(descriptor.resourceId, 'exact-pixel-load', 'Field');
      if (!existing) options.state.fieldResources.push(descriptor);
      return options.emit({ nodeId: current.id, operation: 'field-load-nearest-seed', type: 'vec4',
        inputs: [options.visitSource(current, 'pixel')], value: slot });
    }
    if (current.operator !== 'glyph.atlas' && current.operator !== 'glyph.text-atlas') return undefined;
    const resolved = current.operator === 'glyph.text-atlas' ? resolveImageOperatorTextAtlas(current)
      : resolveImageOperatorGlyphAtlas(current, options.params, options.context.resolveGlyphAtlas);
    if (output === 'image') {
      if (!options.state.externalResources.some(resource => resource.id === resolved.descriptor.id)) options.state.externalResources.push(resolved.descriptor);
      return options.emit({ nodeId: current.id, operation: options.activePixelLoad() ? 'resource-load-input' : 'resource-input',
        type: 'image', inputs: [], value: resourceSlot(resolved.descriptor.id, 'hardware-linear-clamp', 'Image') });
    }
    const values = { glyphCount: resolved.plan.glyphs.length, columns: resolved.plan.columns, rows: resolved.plan.rows };
    const value = values[output as keyof typeof values];
    if (value === undefined) throw new Error(`Glyph atlas ${current.id} has no output ${output}.`);
    const slotKey = `glyph-atlas:${current.id}:${output}`;
    let slot = options.parameterSlots.get(slotKey);
    if (slot === undefined) {
      slot = options.parameterValues.length;
      if (slot >= IMAGE_OPERATOR_PARAMETER_CAPACITY) throw new Error(`Image operator program exceeds ${IMAGE_OPERATOR_PARAMETER_CAPACITY} parameter slots.`);
      options.parameterSlots.set(slotKey, slot); options.parameterValues.push(value);
    }
    return options.emit({ nodeId: current.id, operation: 'parameter', type: 'scalar', inputs: [], value: slot });
  };
}
