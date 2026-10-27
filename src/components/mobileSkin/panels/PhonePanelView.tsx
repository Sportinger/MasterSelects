// A desktop panel rendered inside the phone: the same component the desktop dock shows
// (DockPanelContent), with the story workflow provider the dock normally supplies, inside a touch
// host that enlarges hit areas. Edits go through the desktop panel's own store actions, so they are
// identical to the desktop and part of the normal undo history.

import { Suspense } from 'react';

import { DockPanelContent } from '../../dock/DockPanelContent';
import { SeedanceEditorWorkflowProvider } from '../../story/SeedanceEditorWorkflowContext';
import type { PanelType } from '../../../types/dock';
import './PhonePanelHost.css';

export interface PhonePanelViewProps {
  type: PanelType;
  title: string;
}

export function PhonePanelView({ type, title }: PhonePanelViewProps) {
  return (
    <div className="phone-panel-host" data-testid="phone-panel-host" data-panel-type={type}>
      <SeedanceEditorWorkflowProvider enabled>
        <Suspense fallback={<p className="phone-panel-host__loading">Loading {title}…</p>}>
          <DockPanelContent panel={{ id: `phone-panel-${type}`, type, title }} />
        </Suspense>
      </SeedanceEditorWorkflowProvider>
    </div>
  );
}
