export interface MediaGridBreadcrumbItem {
  id: string | null;
  name: string;
}

export interface MediaGridBreadcrumbProps {
  items: readonly MediaGridBreadcrumbItem[];
  onSelectFolder: (folderId: string | null) => void;
}

export function MediaGridBreadcrumb({
  items,
  onSelectFolder,
}: MediaGridBreadcrumbProps) {
  return (
    <div className="media-grid-breadcrumb">
      {items.map((item, index) => (
        <span key={item.id ?? 'root'}>
          {index > 0 && <span className="media-grid-breadcrumb-sep">/</span>}
          <button
            className={`media-grid-breadcrumb-btn ${index === items.length - 1 ? 'active' : ''}`}
            onClick={() => onSelectFolder(item.id)}
          >
            {item.name}
          </button>
        </span>
      ))}
    </div>
  );
}
