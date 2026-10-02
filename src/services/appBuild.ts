// Public build timestamp, independent of version bumps and source-control IDs.
export const APP_BUILD_ID = typeof __APP_BUILD_ID__ === 'string' ? __APP_BUILD_ID__ : 'unknown';
export const APP_SOURCE_REVISION = typeof __APP_SOURCE_REVISION__ === 'string' ? __APP_SOURCE_REVISION__ : null;
export const APP_SOURCE_DIRTY = typeof __APP_SOURCE_DIRTY__ === 'boolean' ? __APP_SOURCE_DIRTY__ : true;
export const APP_RELEASE_ID = typeof __APP_RELEASE_ID__ === 'string' ? __APP_RELEASE_ID__ : null;
