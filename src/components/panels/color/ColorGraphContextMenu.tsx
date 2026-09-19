import type { CSSProperties } from "react";

import type { ColorNodeType } from "../../../types/colorCorrection";
import { isOriginalColorGraphAnchorNode } from "./colorEditorMath";
import type { ColorEditorNode } from "./colorEditorTypes";

interface ColorGraphContextMenuProps {
  style: CSSProperties;
  openSubmenuLeft: boolean;
  contextNode?: ColorEditorNode;
  contextEdgeId?: string;
  addCorrectorDisabled: boolean;
  alphaOutputExists: boolean;
  onClose: () => void;
  onResetAll: () => void;
  onResetNodeStackLayers: () => void;
  onAddNode: (type: ColorNodeType) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomToWindow: () => void;
  onOriginalSize: () => void;
  onToggleDisplayMode: () => void;
  onResetNodePositions: () => void;
  onNodeRemove: (nodeId: string) => void;
  onEdgeRemove: (edgeId: string) => void;
}

const ADD_NODE_ITEMS: { label: string; type: ColorNodeType }[] = [
  { label: "Corrector", type: "primary" },
  { label: "Parallel Mixer", type: "parallel-mixer" },
  { label: "Layer Mixer", type: "layer-mixer" },
  { label: "Key Mixer", type: "key-mixer" },
  { label: "Splitter", type: "splitter" },
  { label: "Combiner", type: "combiner" },
];

export function ColorGraphContextMenu({
  style,
  openSubmenuLeft,
  contextNode,
  contextEdgeId,
  addCorrectorDisabled,
  alphaOutputExists,
  onClose,
  onResetAll,
  onResetNodeStackLayers,
  onAddNode,
  onZoomIn,
  onZoomOut,
  onZoomToWindow,
  onOriginalSize,
  onToggleDisplayMode,
  onResetNodePositions,
  onNodeRemove,
  onEdgeRemove,
}: ColorGraphContextMenuProps) {
  const run = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <div
      className="color-graph-context-menu"
      role="menu"
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {contextEdgeId ? (
        <button
          type="button"
          role="menuitem"
          className="danger"
          onClick={() => run(() => onEdgeRemove(contextEdgeId))}
        >
          Delete Edge
        </button>
      ) : (
        <>
          <button type="button" role="menuitem" onClick={() => run(onResetAll)}>
            Reset All Grades and Nodes
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onResetNodeStackLayers)}
          >
            Reset All Node Stack Layers
          </button>
          <div className="color-graph-context-separator" />
          <div
            className="color-graph-context-parent"
            role="menuitem"
            tabIndex={0}
          >
            <span>Add Node</span>
            <span aria-hidden="true">›</span>
            <div
              className={`color-graph-context-submenu ${openSubmenuLeft ? "open-left" : ""}`}
              role="menu"
            >
              {ADD_NODE_ITEMS.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  role="menuitem"
                  disabled={item.type === "primary" && addCorrectorDisabled}
                  onClick={() => run(() => onAddNode(item.type))}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => run(() => onAddNode("source"))}
          >
            Add Source
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={alphaOutputExists}
            onClick={() => run(() => onAddNode("alpha-output"))}
          >
            Add Alpha Output
          </button>
          <div className="color-graph-context-separator" />
          <button type="button" role="menuitem" onClick={() => run(onZoomIn)}>
            Zoom In
          </button>
          <button type="button" role="menuitem" onClick={() => run(onZoomOut)}>
            Zoom Out
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onZoomToWindow)}
          >
            Zoom to Window
          </button>
          <div className="color-graph-context-separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onOriginalSize)}
          >
            Original Size
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onToggleDisplayMode)}
          >
            Toggle Display Mode
          </button>
          <div className="color-graph-context-separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onResetNodePositions)}
          >
            Cleanup Node Graph
          </button>
          {contextNode && !isOriginalColorGraphAnchorNode(contextNode) && (
            <>
              <div className="color-graph-context-separator" />
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => run(() => onNodeRemove(contextNode.id))}
              >
                Delete Node
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
