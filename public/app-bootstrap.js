// MasterSelects pre-module bootstrap.
//
// Loaded as a classic script at the end of <body>, so it runs before the
// deferred module bundle. It lives in its own file (not inline in index.html)
// so the Content-Security-Policy can allow it via 'self' instead of a script
// hash that would change with every release.
(function () {
  'use strict';

  var VERSION_PLACEHOLDER = '__APP_VERSION__';

  // The build replaces the placeholder in <meta name="app-version">; in a raw
  // dev checkout it stays as-is and the version check is skipped.
  function readAppVersion() {
    var meta = document.querySelector('meta[name="app-version"]');
    var version = meta ? meta.getAttribute('content') : null;
    if (!version || version === VERSION_PLACEHOLDER) return null;
    return version;
  }

  // Version check - force reload on version change.
  function runVersionCheck() {
    var currentVersion = readAppVersion();
    if (!currentVersion) return;

    var storedVersion = null;
    try {
      storedVersion = localStorage.getItem('app_version');
    } catch (e) {
      return;
    }

    if (storedVersion && storedVersion !== currentVersion) {
      console.log('[Version] Update detected:', storedVersion, '->', currentVersion);
      try { localStorage.setItem('app_version', currentVersion); } catch (e) { /* storage unavailable */ }
      // Clear caches and reload
      if ('caches' in window) {
        caches.keys().then(function (names) {
          names.forEach(function (name) { caches.delete(name); });
        });
      }
      window.location.reload();
    } else {
      try { localStorage.setItem('app_version', currentVersion); } catch (e) { /* storage unavailable */ }
    }
  }

  // Every IndexedDB database this origin has ever used (legacy names included).
  var RESET_DATABASES = [
    'webvj-db',
    'webvj-projects',
    'webvj-apikeys',
    'keyval-store',
    'MASterSelectsDB',
    'multicam-settings',
    'masterselects-ai-chat-runs',
    'masterselects-ai-tool-audit',
  ];

  var RESET_CONFIRM_MESSAGE = [
    'Reset MasterSelects on this device?',
    '',
    'This permanently deletes everything this browser stores for MasterSelects:',
    '- all local projects and their media references (MasterSelects database)',
    '- multicam settings',
    '- AI chat history and tool audit logs',
    '- all settings, layouts and cached sign-in state',
    '',
    'This cannot be undone.',
  ].join('\n');

  // Remove ?reset=true from the address bar (other parameters and the hash
  // are kept) so a reload or history navigation can never repeat the reset.
  function stripResetParam() {
    var params = new URLSearchParams(window.location.search);
    params.delete('reset');
    var query = params.toString();
    var cleanUrl = window.location.pathname + (query ? '?' + query : '') + window.location.hash;
    try {
      window.history.replaceState(window.history.state, '', cleanUrl);
    } catch (e) { /* history unavailable */ }
    return cleanUrl;
  }

  // Returns true when a reset was confirmed and the page is about to reload.
  function runResetIfRequested() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('reset') !== 'true') return false;

    // Strip first: neither a declined nor a confirmed reset may be replayable.
    var cleanUrl = stripResetParam();
    if (!window.confirm(RESET_CONFIRM_MESSAGE)) return false;

    try { localStorage.clear(); } catch (e) { /* storage unavailable */ }
    try { sessionStorage.clear(); } catch (e) { /* storage unavailable */ }

    var pending = RESET_DATABASES.length;
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      window.location.replace(cleanUrl);
    }
    function settle() {
      pending -= 1;
      if (pending <= 0) finish();
    }

    // Another tab holding a database open would block deletion indefinitely;
    // reload anyway after a grace period (the delete completes once it closes).
    window.setTimeout(finish, 5000);

    RESET_DATABASES.forEach(function (name) {
      try {
        var request = indexedDB.deleteDatabase(name);
        request.onsuccess = settle;
        request.onerror = settle;
        request.onblocked = settle;
      } catch (e) {
        settle();
      }
    });
    return true;
  }

  if (!runResetIfRequested()) {
    runVersionCheck();
  }
})();
