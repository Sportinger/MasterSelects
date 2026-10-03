import { Fragment, type ReactNode } from 'react';

/** Menus belong to mounted clip controllers, independently of canvas selection.
 * Stable keys preserve search text and focus when the inspector changes owners. */
export function WorkspaceControllerMenus({ controllers }: {
  controllers: ReadonlyMap<string, { menus: ReactNode }>;
}) {
  return <>{[...controllers].map(([id, controller]) => <Fragment key={id}>{controller.menus}</Fragment>)}</>;
}
