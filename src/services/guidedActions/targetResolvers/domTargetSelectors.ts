// DOM selector lookup for element-backed guided targets: maps each
// GuidedTargetRef kind to its data-attribute selector candidates and finds
// the first mounted element. Geometry/resolution logic stays in domTargets.

import type { GuidedTargetRef } from '../types';

function timelineShellEdge(edge: 'start' | 'end'): 'left' | 'right' {
  return edge === 'start' ? 'left' : 'right';
}

export function findFirstElement(selectors: string[]): Element | null {
  for (const selector of selectors) {
    if (!selector) {
      continue;
    }
    const element = document.querySelector(selector);
    if (element) {
      return element;
    }
  }
  return null;
}

export function escapeAttr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeCssIdentifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

export function findElementForTarget(target: GuidedTargetRef): Element | null {
  switch (target.kind) {
    case 'dom':
      return findFirstElement([
        `[data-guided-target="${escapeAttr(target.id)}"]`,
        `#${escapeCssIdentifier(target.id)}`,
      ]);
    case 'button':
      return findFirstElement([
        `[data-guided-target="button:${escapeAttr(target.id)}"]`,
        `[data-guided-button="${escapeAttr(target.id)}"]`,
        `[data-guided-target="${escapeAttr(target.id)}"]`,
      ]);
    case 'dropdown':
      return findFirstElement([
        `[data-guided-target="dropdown:${escapeAttr(target.id)}"]`,
        `[data-guided-dropdown="${escapeAttr(target.id)}"]`,
        `[data-guided-target="${escapeAttr(target.id)}"]`,
      ]);
    case 'dropdownOption':
      return findFirstElement([
        `[data-guided-target="dropdown-option:${escapeAttr(target.dropdownId)}:${escapeAttr(target.value)}"]`,
        `[data-guided-dropdown-option="${escapeAttr(target.dropdownId)}:${escapeAttr(target.value)}"]`,
        `[data-guided-dropdown="${escapeAttr(target.dropdownId)}"] [data-guided-option="${escapeAttr(target.value)}"]`,
      ]);
    case 'menuItem':
      return findFirstElement([
        `[data-guided-target="menu-item:${escapeAttr(target.menuId)}:${escapeAttr(target.itemId)}"]`,
        `[data-guided-menu-item="${escapeAttr(target.menuId)}:${escapeAttr(target.itemId)}"]`,
        `[data-guided-menu="${escapeAttr(target.menuId)}"] [data-guided-item="${escapeAttr(target.itemId)}"]`,
      ]);
    case 'maskToolbarButton':
      return findFirstElement([
        `[data-guided-target="mask-toolbar:${escapeAttr(target.button)}"]`,
        `[data-guided-mask-tool="${escapeAttr(target.button)}"]`,
      ]);
    case 'maskVertex':
      return findFirstElement([
        target.vertexId
          ? `[data-guided-target="mask-vertex:${escapeAttr(target.maskId)}:${escapeAttr(target.vertexId)}"]`
          : '',
        target.vertexId
          ? `[data-guided-mask-vertex="${escapeAttr(target.maskId)}:${escapeAttr(target.vertexId)}"]`
          : '',
        typeof target.index === 'number'
          ? `[data-guided-target="mask-vertex:${escapeAttr(target.maskId)}:index:${escapeAttr(String(target.index))}"]`
          : '',
        typeof target.index === 'number'
          ? `[data-guided-mask-vertex-index="${escapeAttr(target.maskId)}:${escapeAttr(String(target.index))}"]`
          : '',
      ]);
    case 'maskHandle':
      return findFirstElement([
        target.vertexId
          ? `[data-guided-target="mask-handle:${escapeAttr(target.maskId)}:${escapeAttr(target.vertexId)}:${escapeAttr(target.handle)}"]`
          : '',
        target.vertexId
          ? `[data-guided-mask-handle="${escapeAttr(target.maskId)}:${escapeAttr(target.vertexId)}:${escapeAttr(target.handle)}"]`
          : '',
        typeof target.index === 'number'
          ? `[data-guided-target="mask-handle:${escapeAttr(target.maskId)}:index:${escapeAttr(String(target.index))}:${escapeAttr(target.handle)}"]`
          : '',
        typeof target.index === 'number'
          ? `[data-guided-mask-handle-index="${escapeAttr(target.maskId)}:${escapeAttr(String(target.index))}:${escapeAttr(target.handle)}"]`
          : '',
      ]);
    case 'maskEdge':
      return findFirstElement([
        `[data-guided-target="mask-edge:${escapeAttr(target.maskId)}:${escapeAttr(String(target.fromIndex))}:${escapeAttr(String(target.toIndex))}"]`,
        `[data-guided-mask-edge="${escapeAttr(target.maskId)}:${escapeAttr(String(target.fromIndex))}:${escapeAttr(String(target.toIndex))}"]`,
      ]);
    case 'mediaItem':
      return findFirstElement([
        `[data-guided-target="media-item:${escapeAttr(target.itemId)}"]`,
        `[data-media-item-id="${escapeAttr(target.itemId)}"]`,
        `[data-item-id="${escapeAttr(target.itemId)}"]`,
      ]);
    case 'panel':
      return findFirstElement([
        `[data-guided-panel="${escapeAttr(target.panel)}"]`,
        `[data-panel-type="${escapeAttr(target.panel)}"]`,
        `.dock-panel-content-inner--${escapeCssIdentifier(target.panel)}`,
      ]);
    case 'panelEdge':
      return findFirstElement([
        `[data-guided-panel-edge="${escapeAttr(target.groupId)}:${escapeAttr(target.edge)}"]`,
        `[data-guided-split-id="${escapeAttr(target.groupId)}"][data-guided-edge="${escapeAttr(target.edge)}"]`,
      ]);
    case 'propertiesTab':
      return findFirstElement([
        `[data-guided-target="properties-tab:${escapeAttr(target.tab)}"]`,
        `[data-guided-properties-tab="${escapeAttr(target.tab)}"]`,
      ]);
    case 'propertyControl':
      return findFirstElement([
        target.clipId
          ? `[data-guided-property="${escapeAttr(target.property)}"][data-guided-clip-id="${escapeAttr(target.clipId)}"]`
          : '',
        `[data-guided-target="property:${escapeAttr(target.property)}"]`,
        `[data-guided-property="${escapeAttr(target.property)}"]`,
      ]);
    case 'timelineClip':
      return findFirstElement([
        `[data-guided-target="timeline-clip:${escapeAttr(target.clipId)}"]`,
        `.clip-interaction-shell[data-clip-id="${escapeAttr(target.clipId)}"]`,
        `[data-clip-id="${escapeAttr(target.clipId)}"]`,
      ]);
    case 'timelineTrimHandle':
      return findFirstElement([
        `[data-guided-target="timeline-trim:${escapeAttr(target.clipId)}:${escapeAttr(target.edge)}"]`,
        `.clip-interaction-shell[data-clip-id="${escapeAttr(target.clipId)}"] [data-shell-trim-edge="${timelineShellEdge(target.edge)}"]`,
        `[data-clip-id="${escapeAttr(target.clipId)}"] [data-guided-trim-edge="${escapeAttr(target.edge)}"]`,
      ]);
    case 'timelineFadeHandle':
      return findFirstElement([
        `[data-guided-target="timeline-fade:${escapeAttr(target.clipId)}:${escapeAttr(target.edge)}"]`,
        `.clip-interaction-shell[data-clip-id="${escapeAttr(target.clipId)}"] [data-shell-fade-edge="${timelineShellEdge(target.edge)}"]`,
        `[data-clip-id="${escapeAttr(target.clipId)}"] [data-guided-fade-edge="${escapeAttr(target.edge)}"]`,
      ]);
    case 'timelineMarker':
      return findFirstElement([
        `[data-guided-target="timeline-marker:${escapeAttr(target.markerId)}"]`,
        `[data-marker-id="${escapeAttr(target.markerId)}"]`,
      ]);
    case 'timelineKeyframe':
      return findFirstElement([
        `[data-guided-target="timeline-keyframe:${escapeAttr(target.clipId)}:${escapeAttr(target.keyframeId)}"]`,
        `[data-clip-id="${escapeAttr(target.clipId)}"] [data-keyframe-id="${escapeAttr(target.keyframeId)}"]`,
      ]);
    case 'previewPoint':
    case 'previewPathVertex':
    case 'timelineTime':
      return null;
  }
}
