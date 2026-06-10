// Output Manager popup CSS: sidebar target/slice list items, source selector,
// inline controls, drag/drop affordances. Selector set is disjoint from
// outputManagerShellStyles, so concatenation order does not affect the cascade.
// Order-sensitive equal-specificity pairs (.om-add-btn/.om-add-slice-btn,
// .om-slice-item/.om-mask-item) keep their original relative order here.

export const OUTPUT_MANAGER_LIST_STYLES = `
    /* Target List */
    .om-target-list {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .om-target-list-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      border-bottom: 1px solid #2a2a2a;
    }
    .om-target-list-title {
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #888;
    }
    .om-header-buttons {
      display: flex;
      gap: 4px;
    }
    .om-add-btn {
      background: #2D8CEB;
      color: white;
      border: none;
      padding: 4px 10px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
    }
    .om-add-btn:hover {
      background: #4DA3F0;
    }
    .om-add-btn:disabled {
      background: #333;
      color: #666;
      cursor: default;
    }
    .om-add-slice-btn {
      background: #3a3a3a;
      color: #ccc;
    }
    .om-add-slice-btn:hover:not(:disabled) {
      background: #4a4a4a;
    }
    .om-add-mask-btn {
      background: #3a2020;
      color: #f88;
    }
    .om-add-mask-btn:hover:not(:disabled) {
      background: #4a2a2a;
    }
    .om-target-items {
      flex: 1;
      overflow-y: auto;
      padding: 4px;
    }
    .om-empty {
      padding: 24px 16px;
      text-align: center;
      color: #666;
      font-size: 12px;
    }
    .om-target-item {
      padding: 8px 10px;
      margin-bottom: 2px;
      border-radius: 4px;
      cursor: pointer;
      border: 1px solid transparent;
    }
    .om-target-item:hover {
      background: #1e1e1e;
    }
    .om-target-item.selected {
      background: #1a2a3a;
      border-color: #2D8CEB;
    }
    .om-target-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .om-target-controls {
      margin-top: 6px;
    }
    .om-target-status {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .om-target-status.enabled {
      background: #4f4;
    }
    .om-target-status.disabled {
      background: #666;
    }
    .om-target-name {
      font-weight: 500;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .om-target-type {
      font-size: 10px;
      color: #666;
      text-transform: uppercase;
    }

    /* Inline edit input */
    .om-inline-edit {
      background: #1a1a1a;
      color: #e0e0e0;
      border: 1px solid #2D8CEB;
      border-radius: 3px;
      padding: 1px 4px;
      font-size: inherit;
      font-weight: inherit;
      font-family: inherit;
      flex: 1;
      min-width: 0;
      outline: none;
    }
    .om-toggle-btn {
      background: #333;
      color: #888;
      border: 1px solid #444;
      padding: 2px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
      font-weight: 600;
    }
    .om-toggle-btn.active {
      background: #1a3a1a;
      color: #4f4;
      border-color: #4f4;
    }
    .om-close-btn {
      background: none;
      color: #888;
      border: 1px solid #444;
      padding: 2px 6px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
    }
    .om-close-btn:hover {
      background: #4a1a1a;
      color: #f44;
      border-color: #f44;
    }

    /* Closed (deactivated) target state */
    .om-target-item.closed {
      opacity: 0.55;
    }
    .om-target-status.closed {
      background: #555;
      border: 1px solid #777;
    }
    .om-source-label-readonly {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 11px;
      color: #777;
      font-style: italic;
    }
    .om-restore-btn {
      background: #2D8CEB;
      color: white;
      border: none;
      padding: 2px 10px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
      font-weight: 600;
    }
    .om-restore-btn:hover {
      background: #4DA3F0;
    }
    .om-remove-btn {
      background: none;
      color: #888;
      border: 1px solid #444;
      padding: 2px 6px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
    }
    .om-remove-btn:hover {
      background: #4a1a1a;
      color: #f44;
      border-color: #f44;
    }

    /* Source Selector */
    .om-source-selector {
      position: relative;
      flex: 1;
      min-width: 0;
    }
    .om-source-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      width: 100%;
      background: #222;
      color: #ccc;
      border: 1px solid #444;
      padding: 3px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
      text-align: left;
    }
    .om-source-btn:hover {
      border-color: #666;
    }
    .om-source-label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .om-source-arrow {
      font-size: 8px;
      color: #888;
      flex-shrink: 0;
    }
    .om-source-dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      z-index: 100;
      background: #1e1e1e;
      border: 1px solid #444;
      border-radius: 4px;
      margin-top: 2px;
      max-height: 250px;
      overflow-y: auto;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    }
    .om-source-option {
      display: block;
      width: 100%;
      background: none;
      color: #ccc;
      border: none;
      padding: 6px 10px;
      cursor: pointer;
      font-size: 11px;
      text-align: left;
    }
    .om-source-option:hover {
      background: #2a2a2a;
    }
    .om-source-option.active {
      background: #1a2a3a;
      color: #4DA3F0;
    }
    .om-source-separator {
      height: 1px;
      background: #333;
      margin: 2px 0;
    }

    /* Nested Slice Items (under each target) */
    .om-slice-items-nested {
      padding-left: 16px;
      border-left: 2px solid #2a2a2a;
      margin-left: 14px;
      margin-bottom: 4px;
    }
    .om-slice-item {
      padding: 6px 10px;
      margin-bottom: 1px;
      border-radius: 4px;
      cursor: pointer;
      border: 1px solid transparent;
      font-size: 12px;
    }
    .om-slice-item:hover {
      background: #1e1e1e;
    }
    .om-slice-item.selected {
      background: #1a2a3a;
      border-color: #2D8CEB;
    }
    .om-slice-item.disabled {
      opacity: 0.5;
    }
    .om-slice-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .om-target-status.small {
      width: 6px;
      height: 6px;
    }
    .om-slice-name {
      font-weight: 500;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 11px;
    }
    .om-slice-mode {
      font-size: 10px;
      color: #666;
    }
    .om-slice-controls {
      display: flex;
      gap: 4px;
      margin-top: 4px;
    }

    /* Mask item styling */
    .om-mask-item {
      border-left: 2px solid #FF444466;
    }
    .om-mask-item.selected {
      border-left-color: #FF4444;
    }

    /* Drag handle */
    .om-drag-handle {
      cursor: grab;
      color: #555;
      font-size: 12px;
      user-select: none;
      flex-shrink: 0;
      width: 14px;
      text-align: center;
    }
    .om-drag-handle:hover {
      color: #999;
    }
    .om-slice-item[draggable="true"] {
      cursor: default;
    }

    /* Drop target indicator */
    .om-drop-target {
      border-top: 2px solid #2D8CEB !important;
    }

    /* Invert toggle */
    .om-invert-toggle {
      background: #333;
      color: #888;
      border: 1px solid #444;
      padding: 2px 6px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
      font-weight: 600;
    }
    .om-invert-toggle.active {
      background: #3a2020;
      color: #f44;
      border-color: #f44;
    }
  `;
