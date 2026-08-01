import { useCallback, useMemo, useState } from 'react';

import { propertyRegistry } from '../../../services/properties';
import {
  persistStoredMotionPropertyFavoritePaths,
  readStoredMotionPropertyFavoritePaths,
} from '../../../stores/timeline/viewPreferences';
import { useTimelineStore } from '../../../stores/timeline';

interface MotionPropertyBrowserProps {
  clipId: string;
}

const EXPANDED_STORAGE_KEY = 'masterselects.motionPropertyBrowser.expanded';

function readStoredExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persistExpanded(expanded: boolean): void {
  try {
    localStorage.setItem(EXPANDED_STORAGE_KEY, expanded ? '1' : '0');
  } catch { /* storage unavailable */ }
}

const browserStyles = {
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    width: '100%',
    margin: 0,
    padding: 0,
    border: 'none',
    background: 'none',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
  },
  chevron: {
    display: 'inline-block',
    width: '1em',
    color: 'var(--text-secondary)',
    fontSize: 'var(--font-xs)',
  },
  search: {
    boxSizing: 'border-box',
    width: '100%',
    padding: '6px 8px',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)',
    outline: 'none',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    font: 'inherit',
  },
  summary: {
    margin: '6px 0',
    color: 'var(--text-secondary)',
    fontSize: 'var(--font-xs)',
  },
  results: {
    display: 'grid',
    gap: '4px',
    maxHeight: '280px',
    overflowY: 'auto',
  },
  result: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto auto',
    alignItems: 'center',
    gap: '6px',
    padding: '6px',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg-primary)',
  },
  identity: {
    minWidth: 0,
  },
  label: {
    overflow: 'hidden',
    color: 'var(--text-primary)',
    fontSize: 'var(--font-sm)',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  metadata: {
    overflow: 'hidden',
    color: 'var(--text-secondary)',
    fontFamily: "'SF Mono', 'Monaco', 'Consolas', monospace",
    fontSize: 'var(--font-2xs)',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  empty: {
    margin: 0,
    padding: '8px 0',
    color: 'var(--text-secondary)',
    fontSize: 'var(--font-sm)',
  },
} as const;

export function MotionPropertyBrowser({ clipId }: MotionPropertyBrowserProps) {
  const clip = useTimelineStore(state => state.clips.find(candidate => candidate.id === clipId));
  const updateMotionLayer = useTimelineStore(state => state.updateMotionLayer);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(readStoredExpanded);
  const [favoritePaths, setFavoritePaths] = useState<string[]>(
    () => readStoredMotionPropertyFavoritePaths([]),
  );

  const toggleExpanded = useCallback(() => {
    setExpanded(current => {
      const next = !current;
      persistExpanded(next);
      return next;
    });
  }, []);

  const descriptors = useMemo(
    () => clip ? propertyRegistry.search({ clip, query }) : [],
    [clip, query],
  );
  const pinnedSet = useMemo(
    () => new Set(clip?.motion?.ui?.pinnedProperties ?? []),
    [clip?.motion?.ui?.pinnedProperties],
  );
  const favoriteSet = useMemo(() => new Set(favoritePaths), [favoritePaths]);

  const togglePin = useCallback((path: string) => {
    updateMotionLayer(clipId, current => {
      const currentPaths = current.ui?.pinnedProperties ?? [];
      const nextPaths = currentPaths.includes(path)
        ? currentPaths.filter(candidate => candidate !== path)
        : [...currentPaths, path];
      return {
        ...current,
        ui: {
          ...current.ui,
          pinnedProperties: nextPaths,
        },
      };
    });
  }, [clipId, updateMotionLayer]);

  const toggleFavorite = useCallback((path: string) => {
    setFavoritePaths(currentPaths => {
      const nextPaths = currentPaths.includes(path)
        ? currentPaths.filter(candidate => candidate !== path)
        : [...currentPaths, path];
      persistStoredMotionPropertyFavoritePaths(nextPaths);
      return nextPaths;
    });
  }, []);

  if (!clip?.motion) return null;

  return (
    <section className="properties-section" aria-label="Motion property browser">
      <h4>
        <button
          aria-expanded={expanded}
          style={browserStyles.header}
          type="button"
          onClick={toggleExpanded}
        >
          <span aria-hidden="true" style={browserStyles.chevron}>
            {expanded ? '▾' : '▸'}
          </span>
          Property Browser
        </button>
      </h4>
      {!expanded ? null : (<>
      <input
        aria-label="Search motion properties"
        type="search"
        value={query}
        placeholder="Search label, path, group..."
        style={browserStyles.search}
        onChange={event => setQuery(event.target.value)}
      />
      <div aria-live="polite" style={browserStyles.summary}>
        {descriptors.length} {descriptors.length === 1 ? 'property' : 'properties'}
      </div>
      {descriptors.length > 0 ? (
        <div role="list" style={browserStyles.results}>
          {descriptors.map(descriptor => {
            const pinned = pinnedSet.has(descriptor.path);
            const favorite = favoriteSet.has(descriptor.path);
            return (
              <div key={descriptor.path} role="listitem" style={browserStyles.result}>
                <div style={browserStyles.identity}>
                  <div style={browserStyles.label}>{descriptor.label}</div>
                  <div style={browserStyles.metadata} title={descriptor.path}>
                    {descriptor.group} / {descriptor.path}
                    {descriptor.animatable ? ' / animated' : ' / static'}
                  </div>
                </div>
                <button
                  aria-label={`${favorite ? 'Unfavorite' : 'Favorite'} ${descriptor.path}`}
                  aria-pressed={favorite}
                  className={`btn btn-xs${favorite ? ' btn-active' : ''}`}
                  type="button"
                  title={`${favorite ? 'Remove from' : 'Add to'} user favorites`}
                  onClick={() => toggleFavorite(descriptor.path)}
                >
                  <span aria-hidden="true">Fav</span>
                </button>
                <button
                  aria-label={`${pinned ? 'Unpin' : 'Pin'} ${descriptor.path}`}
                  aria-pressed={pinned}
                  className={`btn btn-xs${pinned ? ' btn-active' : ''}`}
                  type="button"
                  title={`${pinned ? 'Unpin from' : 'Pin to'} this clip`}
                  onClick={() => togglePin(descriptor.path)}
                >
                  {pinned ? 'Pinned' : 'Pin'}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p style={browserStyles.empty}>No properties match this search.</p>
      )}
      </>)}
    </section>
  );
}
