import { Component, Suspense, lazy, useRef, type ReactNode } from 'react';
import { Logger } from '../../../services/logger';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneContextToolbar } from './PhoneContextToolbar';
import { PhoneToast } from './PhoneToast';
import { PhoneTopBar } from './PhoneTopBar';
import { PhoneTransport } from './PhoneTransport';
import { PhoneUnavailableNotice } from './PhoneUnavailableNotice';
import { usePhoneViewport } from './usePhoneViewport';
import './PhoneShell.css';

const log = Logger.create('PhoneShell');

// The landscape editors (nodes, mixer, 3D, desktop panels via DockPanelContent) are heavy and
// never needed on the first screen: their code loads only when one is opened.
const PhoneWorkspaceHost = lazy(() =>
  import('../workspace/PhoneWorkspace').then((module) => ({ default: module.PhoneWorkspaceHost })),
);

/** A landscape editor chunk that fails to load (offline) must say so and close, not stay blank. */
class WorkspaceLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    log.error('Landscape editor failed to load', error);
    const ui = usePhoneUiStore.getState();
    ui.showToast(`Could not open this editor: ${error.message}`, 'error');
    ui.closeWorkspace();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function PhoneLoadingWorkspace() {
  return (
    <div className="phone-workspace-loading" role="status" data-testid="phone-workspace-loading">
      Loading the editor…
    </div>
  );
}

interface PhoneShellProps {
  preview: ReactNode;
  timeline: ReactNode;
  /**
   * The home screen, when it shows. It lives inside the shell so that sheets opened from it
   * (Settings, Projects) stack above it, and the unavailable notice and toasts stay visible on it.
   * A landscape editor stays mounted in the store but is not rendered while the home shows.
   */
  home?: ReactNode;
}

/** Five strips: top bar, preview, transport, timeline, context toolbar. */
export function PhoneShell({ preview, timeline, home }: PhoneShellProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  usePhoneViewport(rootRef);
  const workspace = usePhoneUiStore((state) => state.workspace);
  // An open sheet keeps only the docked transport (and the preview, which some sheets draw on) in reach
  // for keyboard and screen-reader users; the strips it covers leave the focus order (PhoneSheet.tsx).
  const sheetCovers = usePhoneUiStore((state) => state.activeSheet !== null) && !home;

  return (
    <div ref={rootRef} className="phone-shell" data-touch-goo="off">
      {/* While the home shows, the strips behind it are out of the focus order and the a11y tree. */}
      <div className="phone-shell__strips" inert={home ? true : undefined}>
        <PhoneTopBar inert={sheetCovers} />
        <section className="phone-shell__preview" aria-label="Preview area">
          {preview}
        </section>
        <PhoneTransport />
        <section className="phone-shell__timeline" aria-label="Timeline area" inert={sheetCovers || undefined}>
          {timeline}
        </section>
        <PhoneContextToolbar inert={sheetCovers} />
      </div>
      {home}
      {workspace && !home ? (
        <WorkspaceLoadBoundary key={workspace}>
          <Suspense fallback={<PhoneLoadingWorkspace />}>
            <PhoneWorkspaceHost />
          </Suspense>
        </WorkspaceLoadBoundary>
      ) : null}
      <PhoneUnavailableNotice />
      <PhoneToast />
    </div>
  );
}
