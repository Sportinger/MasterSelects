import { useSettingsStore } from '../../../../stores/settingsStore';
import { NODE_CABLE_STYLES } from './cableRoute';

const LABELS = { curved: 'Curved', angular: 'Angular', smart: 'Smart' } as const;
const DESCRIPTIONS = {
  curved: 'Curved cables',
  angular: 'Straight cables with hard corners',
  smart: 'Orthogonal cable lanes with rounded corners',
} as const;

/** Cycles the node editor's cable routing; the choice is a persisted editor preference. */
export function NodeCableStyleButton() {
  const style = useSettingsStore(state => state.nodeCableStyle);
  const setStyle = useSettingsStore(state => state.setNodeCableStyle);
  const next = NODE_CABLE_STYLES[(NODE_CABLE_STYLES.indexOf(style) + 1) % NODE_CABLE_STYLES.length];
  return <button type="button" className="node-workspace-toolbar-button"
    title={`${DESCRIPTIONS[style]}. Click for ${LABELS[next].toLowerCase()} lines.`}
    onClick={event => { setStyle(next); if (event.detail > 0) event.currentTarget.blur(); }}>
    Lines: {LABELS[style]}
  </button>;
}
