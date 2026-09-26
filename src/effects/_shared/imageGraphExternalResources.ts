import type { ImageOperatorPlan } from '../../services/operators/imageOperatorGraph';
import type { ImageOperatorInputHistoryResource, ImageOperatorMemoryWindowResource, ImageOperatorSourceMotionResource } from '../../services/operators/imageOperatorExternalResources';

const emptyHistories = new WeakMap<GPUDevice, GPUTextureView>();
/** Transparent history: Temporal Smooth then passes the current frame through. */
function emptyHistory(device: GPUDevice): GPUTextureView {
  let view = emptyHistories.get(device);
  if (!view) {
    view = device.createTexture({ label: 'temporal-history-empty', size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING }).createView();
    emptyHistories.set(device, view);
  }
  return view;
}
import { getGlyphAtlas, glyphAtlasCacheKey } from './glyphAtlas';

export interface ResolvedImageGraphExternalResource {
  readonly view: GPUTextureView;
  readonly identity: string;
  readonly width?: number;
  readonly height?: number;
  readonly available?: boolean;
  readonly disTrajectory?: import('../time/DisTrajectory').DisTrajectory;
  readonly temporalSamples?: import('../time/TemporalSampleMetadata').TemporalSampleMetadata;
}

export interface ImageGraphExternalResourceContext {
  resolveInputHistory?: (descriptor: ImageOperatorInputHistoryResource) => ResolvedImageGraphExternalResource;
  resolveMemoryWindow?: (descriptor: ImageOperatorMemoryWindowResource) => ResolvedImageGraphExternalResource;
  resolveSourceMotion?: (descriptor: ImageOperatorSourceMotionResource) => ResolvedImageGraphExternalResource;
}

/** Resolves serializable graph descriptors to borrowed, device-local resources. */
export function resolveImageGraphExternalResources(
  device: GPUDevice,
  plan: Pick<ImageOperatorPlan, 'externalResources'>,
  context: ImageGraphExternalResourceContext = {},
): ReadonlyMap<string, ResolvedImageGraphExternalResource> {
  const resolved = new Map<string, ResolvedImageGraphExternalResource>();
  const identities = new Map<string, string>();

  for (const descriptor of plan.externalResources ?? []) {
    if (!descriptor.id) throw new Error('Image graph external resource requires a non-empty id.');
    if (descriptor.kind !== 'glyph-atlas' && descriptor.kind !== 'memory-window' && descriptor.kind !== 'input-history' && descriptor.kind !== 'source-motion' && descriptor.kind !== 'temporal-history') {
      throw new Error(`Unsupported image graph external resource kind: ${String((descriptor as { kind?: unknown }).kind)}.`);
    }
    if (descriptor.kind === 'memory-window' && !context.resolveMemoryWindow) {
      throw new Error('Memory window resources require an explicit runtime resolver.');
    }
    const identity = descriptor.kind === 'source-motion' ? JSON.stringify(descriptor) : descriptor.kind === 'input-history' ? `input-history:${descriptor.part}`
      : descriptor.kind === 'temporal-history' ? `temporal-history:${descriptor.owner}` : descriptor.kind === 'glyph-atlas'
      ? `glyph-atlas:${glyphAtlasCacheKey(descriptor.options)}`
      : `memory-window:${JSON.stringify(Object.entries(descriptor.options).toSorted(([a], [b]) => a.localeCompare(b)))}`;
    const previous = identities.get(descriptor.id);
    if (previous !== undefined) {
      if (previous !== identity) throw new Error(`Image graph external resource ${descriptor.id} has conflicting descriptors.`);
      continue;
    }
    identities.set(descriptor.id, identity);
  }

  for (const descriptor of plan.externalResources ?? []) {
    if (resolved.has(descriptor.id)) continue;
    if (descriptor.kind === 'source-motion') {
      if (!context.resolveSourceMotion) throw new Error('Source Motion needs a source-resource owner.');
      resolved.set(descriptor.id, context.resolveSourceMotion(descriptor)); continue;
    }
    if (descriptor.kind === 'input-history') {
      if (!context.resolveInputHistory) throw new Error('Input history requires a runtime resolver.');
      resolved.set(descriptor.id, context.resolveInputHistory(descriptor));
      continue;
    }
    if (descriptor.kind === 'temporal-history') {
      // Runtime owners replace this with the node's committed history.
      resolved.set(descriptor.id, { view: emptyHistory(device), identity: 'temporal-history:empty' });
      continue;
    }
    if (descriptor.kind === 'memory-window') {
      const resource = context.resolveMemoryWindow!(descriptor);
      if (!resource.identity || !Number.isInteger(resource.width) || !Number.isInteger(resource.height)
        || resource.width! < 1 || resource.height! < 1 || typeof resource.available !== 'boolean') {
        throw new Error(`Memory window resource ${descriptor.id} has invalid runtime metadata.`);
      }
      resolved.set(descriptor.id, resource);
      continue;
    }
    const identity = identities.get(descriptor.id)!;
    const atlas = getGlyphAtlas(device, descriptor.options);
    resolved.set(descriptor.id, { view: atlas.view, identity });
  }

  return resolved;
}
