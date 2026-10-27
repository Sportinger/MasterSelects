// 'editors' sheet: the landscape editors (M4). Tapping one closes the sheet and opens it full screen.
import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PHONE_WORKSPACES } from './phoneWorkspaceCatalog';
import { PHONE_WORKSPACE_TEST_IDS as IDS } from './phoneWorkspaceTestIds';
import './PhoneWorkspace.css';

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
              <span className="phone-editors__title">{workspace.title}</span>
              <span className="phone-editors__summary">{workspace.summary}</span>
            </button>
          </li>
        ))}
      </ul>
    </PhoneSheet>
  );
};
