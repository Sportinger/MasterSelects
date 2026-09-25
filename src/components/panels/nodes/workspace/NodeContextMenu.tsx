import type { getCategoriesWithEffects } from '../../../../effects';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { NodeGraphNode } from '../../../../services/nodeGraph';
import { handleSubmenuHover, handleSubmenuLeave } from '../../media/submenuPosition';

export function NodeContextMenu({
  x,
  y,
  targetNode,
  canDeleteTarget,
  canAddVisualBuiltIns,
  effectCategories,
  onPublishOutput,
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
  onPublishOutput?: () => void;
  onClose: () => void;
  onDeleteNode: () => void;
  onAddAI: () => void;
  onAddKeyframes: () => void;
  canAddKeyframes: boolean;
  onAddBuiltIn: (node: 'transform' | 'mask' | 'color') => void;
  onAddEffect: (effectType: string) => void;
  reusableNodes?: ReactNode;
}) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const matches = (label: string) => label.toLocaleLowerCase().includes(query);
  const effectMatches = effectCategories.flatMap(({ category, effects }) =>
    effects.filter((effect) => matches(effect.name) || matches(category)));
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
        <input
          className="node-workspace-context-search"
          type="search"
          placeholder="Search nodes…"
          aria-label="Search nodes"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && query && effectMatches.length === 1) onAddEffect(effectMatches[0].id);
          }}
        />
        {targetNode && (
          <>
            {onPublishOutput && <button type="button" onClick={onPublishOutput}>Show output in timeline</button>}
            <button type="button" disabled={!canDeleteTarget} onClick={onDeleteNode}>Delete Node</button>
            <div className="node-workspace-context-separator" />
          </>
        )}
        {matches('AI Node') && <button type="button" onClick={onAddAI}>AI Node</button>}
        {matches('Keyframe Node') && <button type="button" disabled={!canAddKeyframes} onClick={onAddKeyframes}>Keyframe Node</button>}
        {matches('Transform') && <button type="button" disabled={!canAddVisualBuiltIns} onClick={() => onAddBuiltIn('transform')}>Transform</button>}
        {matches('Mask') && <button type="button" disabled={!canAddVisualBuiltIns} onClick={() => onAddBuiltIn('mask')}>Mask</button>}
        {matches('Color') && <button type="button" disabled={!canAddVisualBuiltIns} onClick={() => onAddBuiltIn('color')}>Color</button>}
        {!query && reusableNodes}
        {query ? <div className="node-workspace-context-results">
          {effectMatches.map((effect) => (
            <button key={effect.id} type="button" onClick={() => onAddEffect(effect.id)}>{effect.name}</button>
          ))}
          {!effectMatches.length && !['AI Node', 'Keyframe Node', 'Transform', 'Mask', 'Color'].some(matches) && (
            <span className="node-workspace-context-empty">No nodes found</span>
          )}
        </div> : <div
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
        </div>}
      </div>
    </div>
  );
}
