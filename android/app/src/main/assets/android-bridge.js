(() => {
  if (window !== window.top || !window.MasterSelectsNative) return;
  // WebView can expose picker functions while cancelling every request on
  // Android < 17. Let the editor use its existing OPFS backend on those devices.
  if (Number('__MASTERSELECTS_ANDROID_SDK__') < 37) {
    for (const name of ['showDirectoryPicker', 'showSaveFilePicker', 'showOpenFilePicker']) {
      Object.defineProperty(window, name, { configurable: true, value: undefined });
    }
  }
  const pending = new Map();
  let nextId = 0;
  let saving = false;
  const blobs = new Map();
  const originalCreate = URL.createObjectURL.bind(URL);
  const originalRevoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = blob => {
    const url = originalCreate(blob);
    if (blob instanceof Blob) blobs.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = url => { blobs.delete(url); originalRevoke(url); };

  window.MasterSelectsNative.onmessage = event => {
    try {
      const response = JSON.parse(event.data);
      const call = pending.get(response.id);
      if (!call) return;
      pending.delete(response.id);
      clearTimeout(call.timeout);
      if (response.error) call.reject(new Error(response.error)); else call.resolve();
    } catch { /* Ignore malformed or obsolete replies. */ }
  };
  function request(message) {
    return new Promise((resolve, reject) => {
      const id = String(++nextId);
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Android did not finish saving. Please try again.'));
      }, message.op === 'begin' ? 30 * 60 * 1000 : 60000);
      pending.set(id, { resolve, reject, timeout });
      try { window.MasterSelectsNative.postMessage(JSON.stringify({ ...message, id })); }
      catch (error) { clearTimeout(timeout); pending.delete(id); reject(error); }
    });
  }
  async function download(blob, name) {
    if (saving) throw new Error('Finish saving the current export first.');
    saving = true;
    const token = crypto.randomUUID();
    try {
      await request({ op: 'begin', token, name, mime: blob.type, size: blob.size });
      let sequence = 0;
      for (let offset = 0; offset < blob.size; offset += 262144) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + 262144).arrayBuffer());
        let binary = '';
        for (let index = 0; index < bytes.length; index += 8192) {
          binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
        }
        await request({ op: 'chunk', token, sequence: sequence++, data: btoa(binary) });
      }
      await request({ op: 'finish', token });
    } catch (error) {
      void request({ op: 'abort', token }).catch(() => {});
      throw error;
    } finally { saving = false; }
  }
  const report = error => {
    if (error?.message !== 'Save cancelled') window.alert(error?.message || 'Could not save export.');
  };
  function intercept(anchor) {
    const href = anchor.href;
    if (!href.startsWith('blob:') && !href.startsWith('data:')) return false;
    // Capture the Blob synchronously: editor callers revoke their URL just after click().
    const blob = blobs.get(href);
    const source = blob ? Promise.resolve(blob) : fetch(href).then(response => response.blob());
    void source.then(value => download(value, anchor.download || 'export')).catch(report);
    return true;
  }
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!intercept(this)) click.call(this);
  };
  document.addEventListener('click', event => {
    const anchor = event.target?.closest?.('a[href]');
    if (anchor && intercept(anchor)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  Object.defineProperty(window, '__masterselectsAndroid', { value: Object.freeze({
    bundledEditor: true,
    download,
    openEmailSignInLink: () => request({ op: 'signInLink' }),
    setScreenAwake: (lease, active) => request({ op: 'screenLock', lease, active }),
  }) });
})();
