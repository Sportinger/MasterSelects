// Entry of the /m phone skin. Loaded lazily by RootApp; never imports the desktop App, Toolbar,
// DockContainer or Preview. It boots the shared editor runtime and composes the phone shell.

import { useEffect, useState } from 'react';
import { EditorProjectSelectionOverlay } from '../common/EditorProjectSelectionOverlay';
import { PHONE_SKIN_ROOT_CLASS, PHONE_TEST_IDS } from './contracts';
import { PhoneHome } from './home/PhoneHome';
import { PhonePreview } from './preview/PhonePreview';
import { subscribePhoneHomeRequests } from './shell/phoneHomeRequests';
import { PhoneBootStatus } from './runtime/PhoneBootStatus';
import { usePhoneColorScheme } from './runtime/phoneColorScheme';
import { usePhoneProjectSelection, usePhoneRuntime } from './runtime/PhoneRuntimeContext';
import { PhoneRuntimeHost } from './runtime/PhoneRuntimeHost';
import { PhoneShell } from './shell/PhoneShell';
import { PhoneSheetHost } from './sheets/PhoneSheetHost';
import { usePhoneUiStore } from './state/phoneUiStore';
import { PhoneTimeline } from './timeline/PhoneTimeline';
import './PhoneApp.css';

function PhoneWorkspace() {
  const { status } = usePhoneRuntime();
  const { markProjectSelected } = usePhoneProjectSelection();
  const [homeRequested, setHomeRequested] = useState(false);

  // The top bar and the project sheet ask for the home screen; any open sheet closes first.
  useEffect(
    () =>
      subscribePhoneHomeRequests(() => {
        usePhoneUiStore.getState().closeSheet();
        setHomeRequested(true);
      }),
    [],
  );

  // Without an open project the home screen is the default; a stale request must not outlive that.
  const projectOpen = status.projectOpen;
  useEffect(() => {
    if (!projectOpen) setHomeRequested(false);
  }, [projectOpen]);

  // Restore runs first; the home screen appears only once it has resolved.
  if (status.bootPending) return <PhoneBootStatus />;

  // A stored project that only needs its folder access again is resumed by the editor's chooser:
  // the phone home has no resume command.
  const resumeNeeded = !status.projectOpen && status.permissionPending;
  const showHome = !resumeNeeded && (!status.projectOpen || homeRequested);

  return (
    <>
      <PhoneShell
        preview={<PhonePreview />}
        timeline={<PhoneTimeline />}
        home={showHome ? <PhoneHome showBack={status.projectOpen} onClose={() => setHomeRequested(false)} /> : null}
      />
      <PhoneSheetHost />
      {resumeNeeded && <EditorProjectSelectionOverlay onProjectSelected={markProjectSelected} />}
      <PhoneBootStatus />
    </>
  );
}

export default function PhoneApp() {
  // Every light editor theme (Light, System on a light device, a bright Custom) gives the phone light tokens.
  const colorScheme = usePhoneColorScheme();
  return (
    <div className={PHONE_SKIN_ROOT_CLASS} data-testid={PHONE_TEST_IDS.root} data-phone-scheme={colorScheme}>
      <PhoneRuntimeHost>
        <PhoneWorkspace />
      </PhoneRuntimeHost>
    </div>
  );
}
