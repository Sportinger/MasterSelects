import { useEffect, useState } from 'react';
import { MuscriptorSetupDialog } from './MuscriptorSetupDialog';
import {
  subscribeMuscriptorDialogOpen,
  type OpenMuscriptorDialogDetail,
} from './muscriptorSetup/dialogController';

export function MuscriptorDialogHost() {
  const [request, setRequest] = useState<OpenMuscriptorDialogDetail | null>(null);

  useEffect(() => {
    return subscribeMuscriptorDialogOpen(setRequest);
  }, []);

  if (!request) return null;
  return (
    <MuscriptorSetupDialog
      sourceClipId={request.sourceClipId}
      onClose={() => setRequest(null)}
    />
  );
}
