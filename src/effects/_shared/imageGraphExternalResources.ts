import type { ImageOperatorPlan } from '../../services/operators/imageOperatorGraph';
import type { ImageOperatorMemoryWindowResource } from '../../services/operators/imageOperatorExternalResources';
import { getGlyphAtlas, glyphAtlasCacheKey } from './glyphAtlas';

export interface ResolvedImageGraphExternalResource {
  readonly view: GPUTextureView;
  readonly identity: string;
  readonly width?: number;
  readonly height?: number;
  readonly available?: boolean;
}

export interface ImageGraphExternalResourceContext {
  resolveMemoryWindow?: (descriptor: ImageOperatorMemoryWindowResource) => ResolvedImageGraphExternalResource;
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
    if (descriptor.kind !== 'glyph-atlas' && descriptor.kind !== 'memory-window') {
      throw new Error(`Unsupported image graph external resource kind: ${String((descriptor as { kind?: unknown }).kind)}.`);
    }
    if (descriptor.kind === 'memory-window' && !context.resolveMemoryWindow) {
      throw new Error('Memory window resources require an explicit runtime resolver.');
    }
    const identity = descriptor.kind === 'glyph-atlas'
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
