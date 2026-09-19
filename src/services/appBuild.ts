// Public build timestamp, independent of version bumps and source-control IDs.
export const APP_BUILD_ID = typeof __APP_BUILD_ID__ === 'string' ? __APP_BUILD_ID__ : 'unknown';
