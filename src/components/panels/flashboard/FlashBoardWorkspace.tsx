import { FlashBoardToolbar } from './FlashBoardToolbar';
import { FlashBoardCanvas } from './FlashBoardCanvas';
import { FlashBoardComposer } from './FlashBoardComposer';
import type { CatalogEntry } from '../../../services/flashboard/types';
import { useFlashBoardRuntime } from './useFlashBoardRuntime';
import './FlashBoard.css';

interface FlashBoardWorkspaceProps {
  initialProviderId?: string;
  initialService?: CatalogEntry['service'];
  initialVersion?: string;
  allowedServices?: CatalogEntry['service'][];
  serviceScope?: CatalogEntry['service'];
}

export function FlashBoardWorkspace({
  initialProviderId,
  initialService,
  initialVersion,
  allowedServices,
  serviceScope,
}: FlashBoardWorkspaceProps) {
  useFlashBoardRuntime();

  return (
    <div className="flashboard-workspace">
      <FlashBoardToolbar />
      <div className="flashboard-canvas-area">
        <FlashBoardCanvas />
        <FlashBoardComposer
          initialProviderId={initialProviderId}
          initialService={initialService}
          initialVersion={initialVersion}
          allowedServices={allowedServices}
          serviceScope={serviceScope}
        />
      </div>
    </div>
  );
}
