// Public build timestamp, independent of version bumps and source-control IDs.
export const APP_BUILD_ID = typeof __APP_BUILD_ID__ === 'string' ? __APP_BUILD_ID__ : 'unknown';

// Public commit of the built source, so a production error maps to the code
// that raised it. Null in the dev server and outside a git checkout.
export const APP_SOURCE_REVISION = typeof __APP_SOURCE_REVISION__ === 'string' && /^[a-f0-9]{40}$/.test(__APP_SOURCE_REVISION__)
  ? __APP_SOURCE_REVISION__ : null;
export const APP_SOURCE_DIRTY = typeof __APP_SOURCE_DIRTY__ === 'boolean' ? __APP_SOURCE_DIRTY__ : true;
// Only clean production builds receive a release identifier.
export const APP_RELEASE_ID = typeof __APP_RELEASE_ID__ === 'string' ? __APP_RELEASE_ID__ : null;
