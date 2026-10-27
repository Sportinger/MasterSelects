// Phone-specific workspace views for editors that have no dock panel on the desktop (the piano roll
// opens in its own window there). Packets register their view here.
import type { ReactNode } from 'react';

import { PhonePianoRollView } from '../pianoroll/PhonePianoRollView';
import { PhoneOutputSlices } from '../output/PhoneOutputSlices';
import { PhoneOutputStage } from '../output/PhoneOutputStage';
import { PhoneOutputTargets } from '../output/PhoneOutputTargets';

const CUSTOM_VIEWS: Record<string, () => ReactNode> = {
  'piano-roll': () => <PhonePianoRollView />,
  'output-stage': () => <PhoneOutputStage />,
  'output-targets': () => <PhoneOutputTargets />,
  'output-slices': () => <PhoneOutputSlices />,
};

export function renderPhoneWorkspaceCustom(id: string): ReactNode {
  const view = CUSTOM_VIEWS[id];
  if (view) return view();
  return (
    <p className="phone-workspace__placeholder" data-testid={`phone-workspace-custom-${id}`}>
      This editor is being built for the phone. Until then, use the full editor.
    </p>
  );
}
