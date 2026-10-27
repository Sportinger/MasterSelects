// Full-screen landscape editor (M4): a desktop workspace panel in the middle, collapsible side panels
// left and right whose open/closed state is kept per editor across reloads (owner rule), and a slim
// bar with Back and the two side toggles. In portrait it still works and suggests turning the phone.

import { useState, type ReactNode } from 'react';

import { PhonePanelView } from '../panels/PhonePanelView';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneIcon } from '../shell/phoneIcons';
import {
  getPhoneWorkspace, isPhoneWorkspaceSideCollapsed, setPhoneWorkspaceSideCollapsed,
  type PhoneWorkspaceContent, type PhoneWorkspaceId, type PhoneWorkspaceSide,
} from './phoneWorkspaceCatalog';
import { PHONE_WORKSPACE_TEST_IDS as IDS } from './phoneWorkspaceTestIds';
import { renderPhoneWorkspaceCustom } from './phoneWorkspaceCustomViews';
import './PhoneWorkspace.css';

function WorkspaceArea({ content }: { content: PhoneWorkspaceContent }): ReactNode {
  if (content.kind === 'panel') return <PhonePanelView type={content.type} title={content.title} />;
  return renderPhoneWorkspaceCustom(content.id);
}

function useSideState(id: PhoneWorkspaceId, side: PhoneWorkspaceSide) {
  const [collapsed, setCollapsed] = useState(() => isPhoneWorkspaceSideCollapsed(id, side));
  const toggle = () => {
    setCollapsed((current) => {
      setPhoneWorkspaceSideCollapsed(id, side, !current);
      return !current;
    });
  };
  return { collapsed, toggle };
}

export function PhoneWorkspace({ id }: { id: PhoneWorkspaceId }) {
  const closeWorkspace = usePhoneUiStore((state) => state.closeWorkspace);
  const definition = getPhoneWorkspace(id);
  const left = useSideState(id, 'left');
  const right = useSideState(id, 'right');
  if (!definition) return null;

  return (
    <div className="phone-workspace" data-testid={IDS.root} data-workspace={id} role="dialog" aria-label={`${definition.title} editor`}>
      <header className="phone-workspace__bar">
        <button
          type="button"
          className="phone-workspace__button"
          data-testid={IDS.back}
          aria-label="Back to the timeline"
          onClick={closeWorkspace}
          onPointerUp={(event) => event.currentTarget.blur()}
        >
          <PhoneIcon name="back" />
        </button>
        {definition.left ? (
          <button
            type="button"
            className="phone-workspace__button"
            data-testid={IDS.toggleLeft}
            aria-pressed={!left.collapsed}
            aria-label={`${left.collapsed ? 'Show' : 'Hide'} ${definition.left.title}`}
            onClick={left.toggle}
            onPointerUp={(event) => event.currentTarget.blur()}
          >
            <span aria-hidden="true">{left.collapsed ? '⟩' : '⟨'}</span>
          </button>
        ) : null}
        <h2 className="phone-workspace__title">{definition.title}</h2>
        <p className="phone-workspace__hint">Turn your phone for more room</p>
        {definition.right ? (
          <button
            type="button"
            className="phone-workspace__button"
            data-testid={IDS.toggleRight}
            aria-pressed={!right.collapsed}
            aria-label={`${right.collapsed ? 'Show' : 'Hide'} ${definition.right.title}`}
            onClick={right.toggle}
            onPointerUp={(event) => event.currentTarget.blur()}
          >
            <span aria-hidden="true">{right.collapsed ? '⟨' : '⟩'}</span>
          </button>
        ) : null}
      </header>
      <div className="phone-workspace__body">
        {definition.left && !left.collapsed ? (
          <aside className="phone-workspace__side phone-workspace__side--left" data-testid={IDS.sideLeft} aria-label={definition.left.title}>
            <WorkspaceArea content={definition.left} />
          </aside>
        ) : null}
        <main className="phone-workspace__main" data-testid={IDS.main} aria-label={definition.main.title}>
          <WorkspaceArea content={definition.main} />
        </main>
        {definition.right && !right.collapsed ? (
          <aside className="phone-workspace__side phone-workspace__side--right" data-testid={IDS.sideRight} aria-label={definition.right.title}>
            <WorkspaceArea content={definition.right} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/** Mounted once in the shell: shows the open landscape editor, nothing otherwise. */
export function PhoneWorkspaceHost() {
  const workspace = usePhoneUiStore((state) => state.workspace);
  return workspace ? <PhoneWorkspace key={workspace} id={workspace as PhoneWorkspaceId} /> : null;
}
