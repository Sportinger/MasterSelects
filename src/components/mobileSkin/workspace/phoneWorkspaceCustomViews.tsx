// Phone-specific workspace views for editors that have no dock panel on the desktop (the piano roll
// opens in its own window there). Packets register their view here.
import type { ReactNode } from 'react';

export function renderPhoneWorkspaceCustom(id: string): ReactNode {
  return (
    <p className="phone-workspace__placeholder" data-testid={`phone-workspace-custom-${id}`}>
      This editor is being built for the phone. Until then, use the full editor.
    </p>
  );
}
