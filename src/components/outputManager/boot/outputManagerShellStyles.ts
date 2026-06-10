// Output Manager popup CSS: window shell (layout chrome, preview surface,
// tab bar, overlays, context menu, footer). Selector set is disjoint from
// outputManagerListStyles, so concatenation order does not affect the cascade.

export const OUTPUT_MANAGER_SHELL_STYLES = `
    .om-container {
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: #0f0f0f;
      color: #d4d4d4;
    }
    .om-header {
      display: flex;
      align-items: center;
      padding: 8px 16px;
      background: #161616;
      border-bottom: 1px solid #2a2a2a;
      flex-shrink: 0;
    }
    .om-title {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: #e0e0e0;
    }
    .om-body {
      display: flex;
      flex: 1;
      min-height: 0;
    }
    .om-main {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: #0a0a0a;
      min-width: 0;
    }
    .om-sidebar {
      width: 320px;
      flex-shrink: 0;
      background: #161616;
      border-left: 1px solid #2a2a2a;
      overflow-y: auto;
    }

    /* Preview Wrapper (zoom/pan container) */
    .om-preview-wrapper {
      position: relative;
      flex: 1;
      overflow: hidden;
      min-height: 0;
      cursor: default;
    }
    .om-preview-viewport {
      position: relative;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* Preview */
    .om-preview {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      box-sizing: border-box;
    }
    .om-preview-canvas {
      max-width: 100%;
      max-height: 100%;
      background: #000;
      object-fit: contain;
    }
    .om-preview-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      color: #555;
      font-size: 14px;
    }

    /* Tab Bar */
    .om-tab-bar {
      display: flex;
      gap: 0;
      background: #161616;
      border-bottom: 1px solid #2a2a2a;
      flex-shrink: 0;
      padding: 0 12px;
    }
    .om-tab {
      background: none;
      border: none;
      color: #888;
      padding: 8px 16px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 2px solid transparent;
      transition: color 0.15s, border-color 0.15s;
    }
    .om-tab:hover {
      color: #ccc;
    }
    .om-tab.active {
      color: #2D8CEB;
      border-bottom-color: #2D8CEB;
    }

    /* Slice SVG Overlay */
    .om-slice-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      touch-action: none;
    }

    /* Context Menu */
    .om-context-menu-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 200;
    }
    .om-context-menu {
      position: fixed;
      background: #1e1e1e;
      border: 1px solid #444;
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      padding: 4px 0;
      min-width: 160px;
      z-index: 201;
    }
    .om-context-menu-item {
      display: block;
      width: 100%;
      background: none;
      color: #ccc;
      border: none;
      padding: 6px 14px;
      cursor: pointer;
      font-size: 12px;
      text-align: left;
    }
    .om-context-menu-item:hover {
      background: #2a2a2a;
      color: #fff;
    }

    /* Footer */
    .om-footer {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 12px;
      padding: 8px 16px;
      background: #161616;
      border-top: 1px solid #2a2a2a;
      flex-shrink: 0;
    }
    .om-zoom-label {
      font-size: 11px;
      color: #666;
      font-variant-numeric: tabular-nums;
    }
    .om-save-exit-btn {
      background: #2D8CEB;
      color: white;
      border: none;
      padding: 6px 20px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
    }
    .om-save-exit-btn:hover {
      background: #4DA3F0;
    }
  `;
