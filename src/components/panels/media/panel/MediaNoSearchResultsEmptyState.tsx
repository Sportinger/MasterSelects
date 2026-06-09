import type { MouseEventHandler } from 'react';

export interface MediaNoSearchResultsEmptyStateProps {
  query: string;
  onContextMenu: MouseEventHandler<HTMLDivElement>;
}

export function MediaNoSearchResultsEmptyState({
  query,
  onContextMenu,
}: MediaNoSearchResultsEmptyStateProps) {
  return (
    <div className="media-panel-empty" onContextMenu={onContextMenu}>
      <p>No matching items</p>
      <p className="hint">{query}</p>
    </div>
  );
}
