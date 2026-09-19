const EMPTY_GRAPH_GRID_COLUMNS = 12;
const EMPTY_GRAPH_GRID_ROWS = 6;

interface GlobalCurveEditorEmptyStateProps {
  emptyMessage: string;
  height: number;
  width: number;
}

/** Keeps Graph mode visually identifiable even before a numeric curve exists. */
export function GlobalCurveEditorEmptyState({
  emptyMessage,
  height,
  width,
}: GlobalCurveEditorEmptyStateProps) {
  return (
    <div className="global-curve-editor empty" style={{ width, height }}>
      <svg
        className="curve-editor-svg global-curve-editor-svg"
        width={width}
        height={height}
        role="img"
        aria-label="Global property curve editor"
      >
        <rect x={0} y={0} width={width} height={height} className="global-curve-editor-background" />
        <g className="global-curve-editor-empty-grid" aria-hidden="true">
          {Array.from({ length: EMPTY_GRAPH_GRID_COLUMNS - 1 }, (_, index) => {
            const x = width * (index + 1) / EMPTY_GRAPH_GRID_COLUMNS;
            return <line key={`empty-grid-x:${index}`} x1={x} y1={0} x2={x} y2={height} />;
          })}
          {Array.from({ length: EMPTY_GRAPH_GRID_ROWS - 1 }, (_, index) => {
            const y = height * (index + 1) / EMPTY_GRAPH_GRID_ROWS;
            return <line key={`empty-grid-y:${index}`} x1={0} y1={y} x2={width} y2={y} />;
          })}
          <line
            className="global-curve-editor-empty-axis"
            x1={0}
            y1={height / 2}
            x2={width}
            y2={height / 2}
          />
        </g>
      </svg>
      <div className="global-curve-editor-empty-state" role="status">
        <strong>Graph mode</strong>
        <span>{emptyMessage}</span>
        <small>Select a clip with animated properties or add keyframes.</small>
      </div>
    </div>
  );
}
