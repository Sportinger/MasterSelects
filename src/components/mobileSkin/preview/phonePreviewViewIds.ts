// Stable selectors of the phone preview's handles, view options and compare line (tests import them).
export const PHONE_PREVIEW_VIEW_TEST_IDS = {
  /** Button in the preview corner that opens the 'preview-view' sheet. */
  viewButton: 'phone-preview-view-button',
  sheet: 'phone-preview-view-sheet',
  handles: 'phone-preview-view-handles',
  snap: 'phone-preview-view-snap',
  rulers: 'phone-preview-view-rulers',
  /** Segmented 'fit' | 'actual'. */
  zoom: 'phone-preview-view-zoom',
  guideAddH: 'phone-preview-view-guide-h',
  guideAddV: 'phone-preview-view-guide-v',
  guideClear: 'phone-preview-view-guide-clear',
  guideStatus: 'phone-preview-view-guide-status',
  compare: 'phone-preview-view-compare',
  comparePosition: 'phone-preview-view-compare-position',
  compareFeather: 'phone-preview-view-compare-feather',
  // On the preview.
  /** Transform handles of the selected clip; data-clip-id, data-gesture, data-snapped-x/y. */
  gizmo: 'phone-transform-gizmo',
  gizmoBox: 'phone-transform-gizmo-box',
  gizmoReset: 'phone-transform-gizmo-reset',
  /** Pan surface of the actual-pixels view. */
  panSurface: 'phone-preview-pan-surface',
  /** Draggable compare line; data-position. */
  compareHandle: 'phone-preview-compare-handle',
  rulersHost: 'phone-preview-rulers',
} as const;
