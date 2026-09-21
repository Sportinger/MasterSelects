import type { getCategoriesWithEffects } from '../../../../effects';
import type { ReactNode } from 'react';
import type { NodeGraphNode } from '../../../../services/nodeGraph';
import { handleSubmenuHover, handleSubmenuLeave } from '../../media/submenuPosition';

export function NodeContextMenu({
  x,
  y,
  targetNode,
  canDeleteTarget,
  canAddVisualBuiltIns,
  effectCategories,
  onClose,
  onDeleteNode,
  onAddAI,
  onAddKeyframes,
  canAddKeyframes,
  onAddBuiltIn,
  onAddEffect,
  reusableNodes,
}: {
  x: number;
  y: number;
  targetNode: NodeGraphNode | null;
  canDeleteTarget: boolean;
  canAddVisualBuiltIns: boolean;
  effectCategories: ReturnType<typeof getCategoriesWithEffects>;
  onClose: () => void;
  onDeleteNode: () => void;
  onAddAI: () => void;
  onAddKeyframes: () => void;
  canAddKeyframes: boolean;
  onAddBuiltIn: (node: 'transform' | 'mask' | 'color') => void;
  onAddEffect: (effectType: string) => void;
  reusableNodes?: ReactNode;
}) {
  const left = typeof window === 'undefined' ? x : Math.min(x, window.innerWidth - 188);
  const top = typeof window === 'undefined' ? y : Math.min(y, window.innerHeight - 220);

  return (
    <div
      className="node-workspace-context-backdrop"
      onClick={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        className="node-workspace-context-menu"
        style={{ left: Math.max(8, left), top: Math.max(8, top) }}
        onClick={(event) => event.stopPropagation()}
      >
        {targetNode && (
          <>
            <button type="button" disabled={!canDeleteTarget} onClick={onDeleteNode}>Delete Node</button>
            <div className="node-workspace-context-separator" />
          </>
        )}
        <button type="button" onClick={onAddAI}>AI Node</button>
        <button type="button" disabled={!canAddKeyframes} onClick={onAddKeyframes}>Keyframe Node</button>
        <button type="button" disabled={!canAddVisualBuiltIns} onClick={() => onAddBuiltIn('transform')}>Transform</button>
        <button type="button" disabled={!canAddVisualBuiltIns} onClick={() => onAddBuiltIn('mask')}>Mask</button>
        <button type="button" disabled={!canAddVisualBuiltIns} onClick={() => onAddBuiltIn('color')}>Color</button>
        {reusableNodes}
        <div
          className="node-workspace-context-submenu"
          onMouseEnter={handleSubmenuHover}
          onMouseLeave={handleSubmenuLeave}
        >
          <button type="button">Effect Nodes</button>
          <div className="node-workspace-context-submenu-list context-submenu">
            {effectCategories.map(({ category, effects }) => (
              <div key={category} className="node-workspace-context-submenu-group">
                <span>{category}</span>
                {effects.map((effect) => (
                  <button
                    key={effect.id}
                    type="button"
                    onClick={() => onAddEffect(effect.id)}
                  >
                    {effect.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
