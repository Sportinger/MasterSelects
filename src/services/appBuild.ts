import { APP_VERSION } from '../version';

// Public build timestamp, independent of version bumps and source-control IDs.
export const APP_BUILD_ID = typeof __APP_BUILD_ID__ === 'string' ? __APP_BUILD_ID__ : 'unknown';

// Public commit of the built source, so a production error maps to the code
// that raised it. Null in the dev server and outside a git checkout.
export const APP_SOURCE_REVISION = typeof __APP_SOURCE_REVISION__ === 'string' && /^[a-f0-9]{40}$/.test(__APP_SOURCE_REVISION__)
  ? __APP_SOURCE_REVISION__ : null;
export const APP_SOURCE_DIRTY = typeof __APP_SOURCE_DIRTY__ === 'boolean' ? __APP_SOURCE_DIRTY__ : null;
// Names the exact public source only for a build without local changes.
export const APP_RELEASE_ID = APP_SOURCE_REVISION && APP_SOURCE_DIRTY === false
  ? `masterselects-${APP_VERSION}-${APP_SOURCE_REVISION}` : null;
