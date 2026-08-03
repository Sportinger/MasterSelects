export default {
  define: {
    __APP_VERSION__: JSON.stringify('1.0.0-test'),
    __SHOW_CHANGELOG__: false,
    __DEV_BRIDGE_TOKEN__: JSON.stringify(''),
    __DEV_ALLOWED_FILE_ROOTS__: JSON.stringify([]),
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [],
  },
};
