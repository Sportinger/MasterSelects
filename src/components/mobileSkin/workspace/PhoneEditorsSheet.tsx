// 'editors' sheet: the landscape editors (M4). Tapping one closes the sheet and opens it full screen.
import type { PhoneIconName, PhoneSheetComponent } from '../contracts';
import { ProGlyph } from '../compositions/phoneProGlyphs';
import { PhoneIcon } from '../shell/phoneIcons';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PHONE_WORKSPACES, type PhoneWorkspaceId } from './phoneWorkspaceCatalog';
import { PHONE_WORKSPACE_TEST_IDS as IDS } from './phoneWorkspaceTestIds';
import './PhoneWorkspace.css';

const EDITOR_ICONS: Record<PhoneWorkspaceId, PhoneIconName> = {
  nodes: 'nodes', mixer: 'volume', multicam: 'compositions', pianoRoll: 'audio', scene3d: 'overlay', curves: 'animation',
  color: 'color', output: 'fullscreen',
};

export const PhoneEditorsSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const openWorkspace = usePhoneUiStore((state) => state.openWorkspace);
  return (
    <PhoneSheet title="Editors" height="tall" onCancel={closeSheet} cancelLabel="Close">
      <ul className="phone-editors">
        {PHONE_WORKSPACES.map((workspace) => (
          <li key={workspace.id}>
            <button
              type="button"
              className="phone-editors__row"
              data-testid={`${IDS.editorRow}-${workspace.id}`}
              onClick={() => openWorkspace(workspace.id)}
              onPointerUp={(event) => event.currentTarget.blur()}
            >
              <span className="phone-editors__icon" aria-hidden="true"><PhoneIcon name={EDITOR_ICONS[workspace.id]} size={22} /></span>
              <span className="phone-editors__text">
                <span className="phone-editors__title">{workspace.title}</span>
                <span className="phone-editors__summary">{workspace.summary}</span>
              </span>
              <span className="phone-editors__rotate" aria-hidden="true" title="Opens in landscape"><ProGlyph name="rotate" size={18} /></span>
            </button>
          </li>
        ))}
      </ul>
    </PhoneSheet>
  );
};
