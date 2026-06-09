type ModelPopoverCategoryId = 'image' | 'video' | 'voice' | 'music';

interface ModelPopoverCategory {
  id: ModelPopoverCategoryId;
  label: string;
}

interface ModelPopoverEntry {
  id: string;
  active: boolean;
  label: string;
  meta?: string;
  title: string;
}

interface FlashBoardModelPopoverProps {
  activeCategoryId: ModelPopoverCategoryId;
  activePopover: string | null;
  categories: ModelPopoverCategory[];
  entries: ModelPopoverEntry[];
  onCategoryChange: (categoryId: ModelPopoverCategoryId) => void;
  onEntrySelect: (entryId: string) => void;
}

function renderModelCategoryIcon(categoryId: ModelPopoverCategoryId) {
  switch (categoryId) {
    case 'image':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2.5" y="3" width="11" height="10" rx="2" />
          <circle cx="6" cy="6.25" r="1.15" />
          <path d="m4 11 3.1-3.1 2 2L10.5 8.5 13 11" />
        </svg>
      );
    case 'video':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2.3" y="4.2" width="8.8" height="7.6" rx="1.7" />
          <path d="m11.1 6.4 2.6-1.45v6.1L11.1 9.6" />
          <path d="M4.4 4.2 5.6 2.5M8.2 4.2 9.4 2.5" />
        </svg>
      );
    case 'voice':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2.4a2 2 0 0 0-2 2v3.1a2 2 0 0 0 4 0V4.4a2 2 0 0 0-2-2Z" />
          <path d="M3.8 7.2a4.2 4.2 0 0 0 8.4 0M8 11.4v2.2M5.7 13.6h4.6" />
        </svg>
      );
    case 'music':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M10.4 2.7v7.2a1.9 1.9 0 1 1-1.2-1.75" />
          <path d="M10.4 3.2 13 4v2.15l-2.6-.8" />
          <circle cx="5.1" cy="11.3" r="1.75" />
        </svg>
      );
    default:
      return null;
  }
}

export function FlashBoardModelPopover({
  activeCategoryId,
  activePopover,
  categories,
  entries,
  onCategoryChange,
  onEntrySelect,
}: FlashBoardModelPopoverProps) {
  if (activePopover !== 'model') {
    return null;
  }

  return (
    <div className="fb-popover fb-popover-model">
      <div className="fb-popover-title">Model</div>
      <div className="fb-model-category-tabs" role="tablist" aria-label="Model categories">
        {categories.map((category) => (
          <button
            key={category.id}
            className={`fb-model-category-tab category-${category.id} ${activeCategoryId === category.id ? 'active' : ''}`}
            type="button"
            role="tab"
            aria-selected={activeCategoryId === category.id}
            onClick={() => onCategoryChange(category.id)}
          >
            {renderModelCategoryIcon(category.id)}
            <span className="fb-model-category-label">{category.label}</span>
          </button>
        ))}
      </div>
      <div className="fb-model-list">
        <div className="fb-popover-pills">
          {entries.map((entry) => (
            <button
              key={entry.id}
              className={`fb-popover-pill ${entry.active ? 'active' : ''}`}
              type="button"
              title={entry.title}
              onClick={() => onEntrySelect(entry.id)}
            >
              <span className="fb-popover-pill-label">{entry.label}</span>
              {entry.meta && <span className="fb-popover-pill-meta">{entry.meta}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
