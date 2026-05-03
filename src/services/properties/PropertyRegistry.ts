import type {
  PropertyDescriptor,
  PropertyDescriptorProvider,
  PropertyDescriptorResolver,
  PropertySearchOptions,
  PropertyValue,
} from '../../types/propertyRegistry';
import type { TimelineClip } from '../../types';

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function descriptorMatchesQuery(descriptor: PropertyDescriptor, query: string): boolean {
  if (!query) return true;

  const haystack = [
    descriptor.path,
    descriptor.label,
    descriptor.group,
    ...(descriptor.ui?.aliases ?? []),
  ].map(normalizeSearchText);

  const tokens = normalizeSearchText(query)
    .split(/\s+/)
    .filter(Boolean);

  return tokens.every((token) => haystack.some((candidate) => candidate.includes(token)));
}

function sortDescriptors(a: PropertyDescriptor, b: PropertyDescriptor): number {
  const groupCompare = a.group.localeCompare(b.group);
  if (groupCompare !== 0) return groupCompare;
  return a.label.localeCompare(b.label);
}

export class PropertyRegistry {
  private descriptors = new Map<string, PropertyDescriptor>();
  private resolvers = new Map<string, PropertyDescriptorResolver>();
  private providers = new Map<string, PropertyDescriptorProvider>();

  register<T = PropertyValue>(descriptor: PropertyDescriptor<T>): void {
    this.descriptors.set(descriptor.path, descriptor as PropertyDescriptor);
  }

  registerMany(descriptors: PropertyDescriptor[]): void {
    descriptors.forEach((descriptor) => this.register(descriptor));
  }

  registerResolver(id: string, resolver: PropertyDescriptorResolver): void {
    if (!this.resolvers.has(id)) {
      this.resolvers.set(id, resolver);
    }
  }

  registerProvider(id: string, provider: PropertyDescriptorProvider): void {
    if (!this.providers.has(id)) {
      this.providers.set(id, provider);
    }
  }

  has(path: string): boolean {
    return this.descriptors.has(path);
  }

  clear(): void {
    this.descriptors.clear();
    this.resolvers.clear();
    this.providers.clear();
  }

  getDescriptor(path: string, clip?: TimelineClip): PropertyDescriptor | undefined {
    const exact = this.descriptors.get(path);
    if (exact) {
      return exact;
    }

    for (const resolver of this.resolvers.values()) {
      const resolved = resolver(path, clip);
      if (resolved) {
        return resolved;
      }
    }

    return undefined;
  }

  getAllDescriptors(clip?: TimelineClip): PropertyDescriptor[] {
    const descriptors = new Map(this.descriptors);

    if (clip) {
      for (const provider of this.providers.values()) {
        provider(clip).forEach((descriptor) => {
          descriptors.set(descriptor.path, descriptor);
        });
      }
    }

    return Array.from(descriptors.values()).sort(sortDescriptors);
  }

  search(options: PropertySearchOptions = {}): PropertyDescriptor[] {
    return this.getAllDescriptors(options.clip)
      .filter((descriptor) => {
        if (options.group && descriptor.group !== options.group) return false;
        if (options.animatable !== undefined && descriptor.animatable !== options.animatable) return false;
        return descriptorMatchesQuery(descriptor, options.query ?? '');
      });
  }

  readValue<T = PropertyValue>(
    clip: TimelineClip,
    path: string,
  ): T | undefined {
    const descriptor = this.getDescriptor(path, clip);
    return descriptor?.read?.(clip, path) as T | undefined;
  }

  writeValue<T = PropertyValue>(
    clip: TimelineClip,
    path: string,
    value: T,
  ): TimelineClip {
    const descriptor = this.getDescriptor(path, clip);
    if (!descriptor?.write) {
      throw new Error(`Property is not writable: ${path}`);
    }
    return descriptor.write(clip, value, path);
  }
}

export const propertyRegistry = new PropertyRegistry();
