import type {
  GuidedTargetKind,
  GuidedTargetRef,
  GuidedTargetResolution,
  GuidedTargetResolver,
  GuidedTargetResolverContext,
} from './types';

type ResolverEntry = {
  id: string;
  resolver: GuidedTargetResolver;
};

export class GuidedTargetRegistry {
  private resolvers = new Map<GuidedTargetKind, ResolverEntry[]>();

  registerResolver(
    kind: GuidedTargetKind,
    resolver: GuidedTargetResolver,
    id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  ): () => void {
    const current = this.resolvers.get(kind) ?? [];
    const entry = { id, resolver };
    this.resolvers.set(kind, [...current.filter((candidate) => candidate.id !== id), entry]);

    return () => {
      const next = (this.resolvers.get(kind) ?? []).filter((candidate) => candidate.id !== id);
      if (next.length > 0) {
        this.resolvers.set(kind, next);
      } else {
        this.resolvers.delete(kind);
      }
    };
  }

  clear(): void {
    this.resolvers.clear();
  }

  async resolve(
    target: GuidedTargetRef,
    context: GuidedTargetResolverContext = {},
  ): Promise<GuidedTargetResolution> {
    const resolvers = this.resolvers.get(target.kind) ?? [];
    if (resolvers.length === 0) {
      return {
        status: 'missing',
        target,
        reason: 'unsupported-target-kind',
        message: `No guided target resolver registered for "${target.kind}"`,
      };
    }

    let lastMissing: GuidedTargetResolution | null = null;
    for (const entry of resolvers) {
      try {
        const result = await entry.resolver(target, context);
        if (!result) {
          continue;
        }
        if (result.status === 'resolved') {
          return result;
        }
        lastMissing = result;
      } catch (error) {
        lastMissing = {
          status: 'missing',
          target,
          reason: 'resolver-error',
          message: error instanceof Error ? error.message : 'Target resolver failed',
        };
      }
    }

    return lastMissing ?? {
      status: 'missing',
      target,
      reason: 'entity-not-found',
      message: `No resolver could locate ${getGuidedTargetDebugLabel(target)}`,
    };
  }
}

export const guidedTargetRegistry = new GuidedTargetRegistry();

export function getGuidedTargetKey(target: GuidedTargetRef): string {
  switch (target.kind) {
    case 'dom':
    case 'button':
    case 'dropdown':
      return `${target.kind}:${target.id}`;
    case 'panel':
      return `panel:${target.panel}`;
    case 'panelEdge':
      return `panelEdge:${target.groupId}:${target.edge}`;
    case 'dropdownOption':
      return `dropdownOption:${target.dropdownId}:${target.value}`;
    case 'menuItem':
      return `menuItem:${target.menuId}:${target.itemId}`;
    case 'propertiesTab':
      return `propertiesTab:${target.tab}`;
    case 'propertyControl':
      return `propertyControl:${target.clipId ?? '*'}:${target.property}`;
    case 'timelineClip':
      return `timelineClip:${target.clipId}`;
    case 'timelineTime':
      return `timelineTime:${target.surface === 'ruler' ? 'ruler:' : ''}${target.trackId ?? '*'}:${target.time}`;
    case 'timelineTrimHandle':
      return `timelineTrimHandle:${target.clipId}:${target.edge}`;
    case 'timelineFadeHandle':
      return `timelineFadeHandle:${target.clipId}:${target.edge}`;
    case 'timelineMarker':
      return `timelineMarker:${target.markerId}`;
    case 'timelineKeyframe':
      return `timelineKeyframe:${target.clipId}:${target.keyframeId}`;
    case 'previewPoint':
      return `previewPoint:${target.x}:${target.y}`;
    case 'previewPathVertex':
      return `previewPathVertex:${target.index}:${target.x}:${target.y}`;
    case 'maskToolbarButton':
      return `maskToolbarButton:${target.button}`;
    case 'maskVertex':
      return `maskVertex:${target.maskId}:${target.vertexId ?? target.index ?? '*'}`;
    case 'maskHandle':
      return `maskHandle:${target.maskId}:${target.vertexId ?? target.index ?? '*'}:${target.handle}`;
    case 'maskEdge':
      return `maskEdge:${target.maskId}:${target.fromIndex}:${target.toIndex}`;
    case 'mediaItem':
      return `mediaItem:${target.itemId}`;
  }
}

export function getGuidedTargetDebugLabel(target: GuidedTargetRef): string {
  switch (target.kind) {
    case 'dom':
      return `DOM target ${target.id}`;
    case 'panel':
      return `panel ${target.panel}`;
    case 'button':
      return `button ${target.id}`;
    case 'dropdown':
      return `dropdown ${target.id}`;
    case 'dropdownOption':
      return `dropdown option ${target.dropdownId}:${target.value}`;
    case 'menuItem':
      return `menu item ${target.menuId}:${target.itemId}`;
    case 'propertiesTab':
      return `properties tab ${target.tab}`;
    case 'propertyControl':
      return `property control ${target.property}`;
    case 'timelineClip':
      return `timeline clip ${target.clipId}`;
    case 'timelineTime':
      return `timeline time ${target.time}`;
    case 'mediaItem':
      return `media item ${target.itemId}`;
    case 'panelEdge':
    case 'timelineTrimHandle':
    case 'timelineFadeHandle':
    case 'timelineMarker':
    case 'timelineKeyframe':
    case 'previewPoint':
    case 'previewPathVertex':
    case 'maskToolbarButton':
    case 'maskVertex':
    case 'maskHandle':
    case 'maskEdge':
      return getGuidedTargetKey(target);
  }
}
