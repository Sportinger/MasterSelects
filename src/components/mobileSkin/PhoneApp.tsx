// Entry of the /m phone skin. Loaded lazily by RootApp; never imports the desktop App, Toolbar,
// DockContainer or Preview. It boots the shared editor runtime and composes the phone shell.

import { EditorProjectSelectionOverlay } from '../common/EditorProjectSelectionOverlay';
import { PHONE_SKIN_ROOT_CLASS, PHONE_TEST_IDS } from './contracts';
import { PhonePreview } from './preview/PhonePreview';
import { PhoneBootStatus } from './runtime/PhoneBootStatus';
import { usePhoneProjectSelection, usePhoneRuntime } from './runtime/PhoneRuntimeContext';
import { PhoneRuntimeHost } from './runtime/PhoneRuntimeHost';
import { PhoneShell } from './shell/PhoneShell';
import { PhoneTimeline } from './timeline/PhoneTimeline';
import './PhoneApp.css';

function PhoneWorkspace() {
  const { status } = usePhoneRuntime();
  const { markProjectSelected } = usePhoneProjectSelection();

  // Restore runs first; the project chooser appears only once it has resolved.
  if (status.bootPending) return <PhoneBootStatus />;

  return (
    <>
      <PhoneShell preview={<PhonePreview />} timeline={<PhoneTimeline />} />
      {!status.projectOpen && (
        // M0 reuses the editor's chooser as-is (create, browser-stored, recent, archive, resume).
        <EditorProjectSelectionOverlay onProjectSelected={markProjectSelected} />
      )}
      <PhoneBootStatus />
    </>
  );
}

export default function PhoneApp() {
  return (
    <div className={PHONE_SKIN_ROOT_CLASS} data-testid={PHONE_TEST_IDS.root}>
      <PhoneRuntimeHost>
        <PhoneWorkspace />
      </PhoneRuntimeHost>
    </div>
  );
}
