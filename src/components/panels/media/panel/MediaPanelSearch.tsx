export interface MediaPanelSearchProps {
  query: string;
  onQueryChange: (value: string) => void;
}

export function MediaPanelSearch({ query, onQueryChange }: MediaPanelSearchProps) {
  return (
    <div className="media-panel-search">
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="7" cy="7" r="4.4" />
        <path d="M10.3 10.3 14 14" />
      </svg>
      <input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onQueryChange('');
        }}
        placeholder="Search or *.mp4"
        aria-label="Search project items"
      />
      {query ? (
        <button
          type="button"
          className="media-panel-search-clear"
          onClick={() => onQueryChange('')}
          title="Clear search"
          aria-label="Clear search"
        >
          x
        </button>
      ) : null}
    </div>
  );
}
