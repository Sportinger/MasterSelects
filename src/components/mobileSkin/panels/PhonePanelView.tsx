// A desktop panel rendered inside the phone: the same component the desktop dock shows
// (DockPanelContent), with the story workflow provider the dock normally supplies, inside a touch
// host that enlarges hit areas and keeps the panel inside the phone's width. Edits go through the
// desktop panel's own store actions, so they are identical to the desktop and part of the normal
// undo history. A panel that throws says so in place instead of closing the whole sheet.

import { Component, Suspense, useEffect, type ReactNode } from 'react';

import { Logger } from '../../../services/logger';
import { DockPanelContent } from '../../dock/DockPanelContent';
import { SeedanceEditorWorkflowProvider } from '../../story/SeedanceEditorWorkflowContext';
import type { PanelType } from '../../../types/dock';
import { requestPropertiesTab, takePendingPropertiesTab } from './phonePanelNavigation';
import { PHONE_PANELS_TEST_IDS as IDS } from './phonePanelsTestIds';
import './PhonePanelHost.css';

const log = Logger.create('PhonePanelView');

export interface PhonePanelViewProps {
  type: PanelType;
  title: string;
}

class PanelBoundary extends Component<{ title: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message || String(error) };
  }
  componentDidCatch(error: Error) {
    log.error(`${this.props.title} panel failed on the phone`, error);
  }
  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <p className="phone-panel-host__error" role="alert">
        {this.props.title} could not be shown: {this.state.error}. Close this sheet and try again, or use the full editor.
      </p>
    );
  }
}

export function PhonePanelView({ type, title }: PhonePanelViewProps) {
  // Children's effects run first, so the Properties panel already listens when this one runs.
  useEffect(() => {
    if (type !== 'clip-properties') return undefined;
    const tab = takePendingPropertiesTab();
    if (!tab) return undefined;
    requestPropertiesTab(tab);
    // A tab whose content was still loading may be re-chosen once the panel settled.
    const frame = window.requestAnimationFrame(() => requestPropertiesTab(tab));
    return () => window.cancelAnimationFrame(frame);
  }, [type]);

  return (
    <div className="phone-panel-host" data-testid={IDS.panelHost} data-panel-type={type}>
      <PanelBoundary title={title}>
        <SeedanceEditorWorkflowProvider enabled>
          <Suspense fallback={<p className="phone-panel-host__loading">Loading {title}…</p>}>
            <DockPanelContent panel={{ id: `phone-panel-${type}`, type, title }} />
          </Suspense>
        </SeedanceEditorWorkflowProvider>
      </PanelBoundary>
    </div>
  );
}
