// Stable selectors of the G1 timeline tools: the timeline control row (snap, metronome, in/out),
// the Timeline sheet (snap, range, tempo, metronome, view), the clip Details sheet (name, colour,
// parent, null), the Bake sheet and the range Compare sheet.

export const PHONE_TIMELINE_CONTROLS_TEST_IDS = {
  row: 'phone-timeline-controls',
  snap: 'phone-timeline-snap',
  metronome: 'phone-timeline-metronome',
  setIn: 'phone-timeline-set-in',
  setOut: 'phone-timeline-set-out',
  clearRange: 'phone-timeline-clear-range',
  more: 'phone-timeline-more',
  /** The in/out band on the ruler (data-in, data-out). */
  rangeBand: 'phone-timeline-range-band',
  /** One beat mark on the ruler (data-time, data-downbeat). */
  beat: 'phone-timeline-beat',
} as const;

export const PHONE_TIMELINE_TOOLS_TEST_IDS = {
  root: 'phone-tltools',
  tabSnap: 'phone-tltools-tab-snap',
  tabRange: 'phone-tltools-tab-range',
  tabTempo: 'phone-tltools-tab-tempo',
  tabView: 'phone-tltools-tab-view',
  message: 'phone-tltools-message',
  // Snap
  snapSwitch: 'phone-tltools-snap-switch',
  gridSwitch: 'phone-tltools-grid-switch',
  /** Suffix: the subdivision id ('bar', 'beat', '1/8', ...), slashes become 'of'. */
  gridChip: 'phone-tltools-grid',
  // Range
  rangeIn: 'phone-tltools-range-in',
  rangeOut: 'phone-tltools-range-out',
  rangeClear: 'phone-tltools-range-clear',
  rangeLoop: 'phone-tltools-range-loop',
  rangeSummary: 'phone-tltools-range-summary',
  rangeInStep: 'phone-tltools-range-in-step',
  rangeOutStep: 'phone-tltools-range-out-step',
  rangeBake: 'phone-tltools-range-bake',
  rangeCompare: 'phone-tltools-range-compare',
  // Tempo
  tempoBpm: 'phone-tltools-tempo-bpm',
  tempoMeter: 'phone-tltools-tempo-meter',
  tempoAdd: 'phone-tltools-tempo-add',
  tempoRow: 'phone-tltools-tempo-row',
  tempoRowBpm: 'phone-tltools-tempo-row-bpm',
  tempoRowRamp: 'phone-tltools-tempo-row-ramp',
  tempoRowRemove: 'phone-tltools-tempo-row-remove',
  tempoPosition: 'phone-tltools-tempo-position',
  metronomeSwitch: 'phone-tltools-metronome-switch',
  metronomeVolume: 'phone-tltools-metronome-volume',
  /** Suffix: 'beats' or 'bars'. */
  metronomeMode: 'phone-tltools-metronome-mode',
  // View
  /** Suffix: 'balanced', 'video' or 'audio'. */
  viewFocus: 'phone-tltools-view-focus',
  viewThumbnails: 'phone-tltools-view-thumbnails',
  viewWaveforms: 'phone-tltools-view-waveforms',
  viewMoreLanes: 'phone-tltools-view-more-lanes',
} as const;

export const PHONE_CLIP_DETAILS_TEST_IDS = {
  root: 'phone-clipdetails',
  /** Empty state: selects the clip under the playhead. */
  selectAtPlayhead: 'phone-clipdetails-select-at-playhead',
  message: 'phone-clipdetails-message',
  name: 'phone-clipdetails-name',
  rename: 'phone-clipdetails-rename',
  renameGreyed: 'phone-clipdetails-rename-greyed',
  source: 'phone-clipdetails-source',
  span: 'phone-clipdetails-span',
  /** Suffix: the label colour key ('none', 'red', ...). */
  color: 'phone-clipdetails-color',
  colorGreyed: 'phone-clipdetails-color-greyed',
  parent: 'phone-clipdetails-parent',
  /** One candidate row per possible parent clip (data-clip-id), plus 'none'. */
  parentOption: 'phone-clipdetails-parent-option',
  parentNone: 'phone-clipdetails-parent-none',
  nullParent: 'phone-clipdetails-null',
  trackParent: 'phone-clipdetails-track-parent',
  /** One option per possible parent track (data-track-id). */
  trackParentOption: 'phone-clipdetails-track-parent-option',
  trackParentNone: 'phone-clipdetails-track-parent-none',
} as const;

export const PHONE_BAKE_TEST_IDS = {
  root: 'phone-bake',
  message: 'phone-bake-message',
  markRange: 'phone-bake-mark-range',
  markClip: 'phone-bake-mark-clip',
  encoderGreyed: 'phone-bake-encoder-greyed',
  /** One row per region (data-region-id, data-scope, data-status). */
  row: 'phone-bake-row',
  bake: 'phone-bake-run',
  unbake: 'phone-bake-unbake',
  remove: 'phone-bake-remove',
  empty: 'phone-bake-empty',
} as const;

export const PHONE_VARIANTS_TEST_IDS = {
  root: 'phone-variants',
  empty: 'phone-variants-empty',
  ask: 'phone-variants-ask',
  tray: 'phone-variants-tray',
} as const;

/** 'phone-tltools-grid-1of8' for '1/8'. */
export function phoneGridChipTestId(subdivision: string): string {
  return `${PHONE_TIMELINE_TOOLS_TEST_IDS.gridChip}-${subdivision.replace('/', 'of')}`;
}
