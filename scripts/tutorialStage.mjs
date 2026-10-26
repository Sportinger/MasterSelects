// Shared by tutorial-video.mjs: what a tutorial recording draws on top of the real editor, and where
// its steps aim. The overlays are page DOM that ignores the pointer, so the editor underneath still
// takes every hover, click and drag:
//   title cards        intro and outro, full frame
//   a desktop window   files the pointer picks up and drops into the editor (a real drop: the files
//                      arrive as a DataTransfer, so the editor imports them the way it imports any drop)
//   a drag ghost       what an HTML5 drag carries (the browser draws none in a screencast)
//   key caps           the shortcut a step presses, next to the pointer
//   a download chip    the browser's download bubble, which a screencast does not show either

/**
 * Page side: installs the overlays once; window.__tutorial drives them. scale: their size against a
 * 1280 px wide page (2 at 2560×1440, so cards, key caps and the file window keep their size in the video).
 */
export function installStage(scale = 1) {
  if (window.__tutorial) return;
  const style = document.createElement('style');
  const px = value => `${value * scale}px`;
  style.textContent = `
    .tut-layer { position: fixed; z-index: 2147483640; pointer-events: none; font-family: Inter, "Segoe UI", system-ui, sans-serif; }
    .tut-fade { transition: opacity 260ms ease, transform 260ms ease; }
    .tut-hidden { opacity: 0; transform: scale(.96); }
    .tut-card { inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
      background: radial-gradient(120% 90% at 50% 40%, #1d2433 0%, #0b0d12 70%); color: #fff; text-align: center; }
    .tut-card .tut-brand { font-size: 15px; letter-spacing: .32em; text-transform: uppercase; color: #8fb8ff; font-weight: 600; }
    .tut-card .tut-title { font-size: 54px; line-height: 1.08; font-weight: 800; max-width: 900px; letter-spacing: -.01em; }
    .tut-card .tut-subtitle { font-size: 22px; color: #c9d3e6; font-weight: 500; }
    .tut-files { width: 318px; border-radius: 12px; background: #f3f4f7; color: #1c1d21; overflow: hidden;
      box-shadow: 0 24px 60px rgba(0, 0, 0, .55), 0 0 0 1px rgba(0, 0, 0, .25); }
    .tut-files-bar { height: 34px; display: flex; align-items: center; padding: 0 12px; background: #e3e5ea; font-size: 13px; font-weight: 600; }
    .tut-files-bar i { width: 11px; height: 11px; border-radius: 50%; margin-right: 7px; display: inline-block; }
    .tut-files-bar span { flex: 1; text-align: center; margin-right: 54px; color: #3b3d44; }
    .tut-files-grid { display: flex; gap: 14px; padding: 16px 16px 18px; }
    .tut-file { width: 135px; padding: 7px; border-radius: 8px; display: flex; flex-direction: column; align-items: center; gap: 7px; }
    .tut-file img { width: 121px; height: 68px; object-fit: cover; border-radius: 4px; box-shadow: 0 1px 3px rgba(0, 0, 0, .35); }
    .tut-file span { font-size: 12px; padding: 2px 6px; border-radius: 4px; max-width: 128px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tut-file.selected { background: rgba(10, 110, 255, .16); }
    .tut-file.selected span { background: #0a6eff; color: #fff; }
    .tut-ghost { left: 0; top: 0; will-change: transform; transition: transform 90ms linear; }
    .tut-ghost .tut-chip { display: flex; align-items: center; gap: 8px; padding: 6px 10px 6px 6px; border-radius: 7px; opacity: .92;
      background: rgba(30, 34, 44, .92); color: #fff; font-size: 12px; box-shadow: 0 8px 22px rgba(0, 0, 0, .45); }
    .tut-ghost img { width: 64px; height: 36px; object-fit: cover; border-radius: 3px; }
    .tut-ghost .tut-stack { position: relative; width: 104px; height: 60px; }
    .tut-ghost .tut-stack img { position: absolute; width: 96px; height: 54px; border-radius: 4px; box-shadow: 0 6px 18px rgba(0, 0, 0, .5); }
    .tut-ghost .tut-count { position: absolute; right: -6px; top: -8px; min-width: 22px; height: 22px; border-radius: 11px; background: #ff3b30;
      color: #fff; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
    .tut-key { padding: 7px 14px; min-width: 40px; text-align: center; border-radius: 9px; background: #fdfdfd; color: #15171c; font-size: 22px;
      font-weight: 700; box-shadow: 0 4px 0 #9aa0ac, 0 10px 24px rgba(0, 0, 0, .5); }
    .tut-download { right: 18px; top: 40px; display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 12px;
      background: #f3f4f7; color: #1c1d21; font-size: 14px; box-shadow: 0 18px 44px rgba(0, 0, 0, .5); }
    .tut-download b { display: block; font-size: 15px; }
    .tut-download small { color: #5b5f6a; }
    .tut-download .tut-arrow { width: 34px; height: 34px; border-radius: 50%; background: #0a6eff; color: #fff; display: flex; align-items: center;
      justify-content: center; font-size: 20px; font-weight: 700; }`.replace(/(\d*\.?\d+)px/g, (_, value) => px(Number(value)));
  document.documentElement.append(style);
  const layer = (className, html = '') => {
    const element = document.createElement('div');
    element.className = `tut-layer tut-fade tut-hidden ${className}`;
    element.innerHTML = html;
    document.documentElement.append(element);
    return element;
  };
  const show = element => requestAnimationFrame(() => element.classList.remove('tut-hidden'));
  const hide = element => { element.classList.add('tut-hidden'); setTimeout(() => element.remove(), 300); };
  const escape = text => String(text).replace(/[&<>"]/g, char => `&#${char.charCodeAt(0)};`);

  let card, files, ghost, carried;
  const ghostTo = (x, y) => { if (ghost) ghost.style.transform = `translate(${x + 14 * scale}px, ${y + 16 * scale}px)`; };
  const state = window.__tutorial = {
    card({ brand = 'MasterSelects', title = '', subtitle = '' }) {
      card?.remove();
      card = layer('tut-card', `<div class="tut-brand">${escape(brand)}</div><div class="tut-title">${escape(title)}</div>`
        + (subtitle ? `<div class="tut-subtitle">${escape(subtitle)}</div>` : ''));
      card.classList.remove('tut-fade');
      card.style.transition = 'opacity 420ms ease';
      show(card);
    },
    hideCard() { if (card) { hide(card); card = undefined; } },
    /** A file window at (x, y) CSS px with these files: [{ name, thumb (data URL), url }]. */
    files({ title = 'Desktop', list, x, y }) {
      files?.remove();
      files = layer('tut-files', `<div class="tut-files-bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i>`
        + `<i style="background:#28c840"></i><span>${escape(title)}</span></div><div class="tut-files-grid">`
        + list.map((file, index) => `<div class="tut-file" data-index="${index}"><img src="${file.thumb}"><span>${escape(file.name)}</span></div>`).join('')
        + '</div>');
      Object.assign(files.style, { left: `${x}px`, top: `${y}px` });
      files.__list = list;
      show(files);
    },
    filePoint(index) {
      const rect = files?.querySelector(`[data-index="${index}"] img`)?.getBoundingClientRect();
      return rect ? { x: rect.left + rect.width * 0.55, y: rect.top + rect.height * 0.55 } : { missing: `no file ${index} in the file window` };
    },
    selectFile(index, add) {
      for (const tile of files?.querySelectorAll('.tut-file') ?? []) {
        if (Number(tile.dataset.index) === index) tile.classList.add('selected');
        else if (!add) tile.classList.remove('selected');
      }
    },
    hideFiles() { if (files) { hide(files); files = undefined; } },
    /** Picks up the selected files: the ghost follows the pointer and the editor sees a file drag. */
    async pickUp() {
      const selected = [...files.querySelectorAll('.tut-file.selected')].map(tile => files.__list[Number(tile.dataset.index)]);
      const transfer = new DataTransfer();
      for (const file of selected) {
        const blob = await (await fetch(file.url)).blob();
        transfer.items.add(new File([blob], file.name, { type: blob.type || 'video/mp4', lastModified: Date.now() }));
      }
      carried = { transfer, over: null };
      ghost = layer('tut-ghost', selected.length > 1
        ? `<div class="tut-stack">${selected.slice(0, 3).map((file, index) => `<img src="${file.thumb}" style="left:${px(index * 6)};top:${px(index * 5)}">`).join('')}`
          + `<div class="tut-count">${selected.length}</div></div>`
        : `<div class="tut-chip"><img src="${selected[0].thumb}">${escape(selected[0].name)}</div>`);
      ghost.classList.remove('tut-fade', 'tut-hidden');
      return selected.length;
    },
    /** Drops what was picked up at (x, y): the editor gets dragenter, dragover and drop with the files. */
    drop(x, y) {
      const target = document.elementFromPoint(x, y);
      for (const type of ['dragover', 'drop']) target?.dispatchEvent(new DragEvent(type, { dataTransfer: carried.transfer, bubbles: true, cancelable: true, clientX: x, clientY: y }));
      ghost?.remove();
      ghost = carried = undefined;
      return target ? target.className || target.tagName : 'nothing';
    },
    key(label, { x, y }) {
      const cap = layer('tut-key', escape(label));
      Object.assign(cap.style, { left: `${x + 26 * scale}px`, top: `${y - 54 * scale}px` });
      show(cap);
      setTimeout(() => hide(cap), 1100);
    },
    download({ name, size }) {
      const chip = layer('tut-download', `<div class="tut-arrow">↓</div><div><b>${escape(name)}</b><small>${escape(size)} · Downloads</small></div>`);
      show(chip);
      setTimeout(() => hide(chip), 3200);
    },
  };

  const options = { capture: true, passive: true };
  // A carried file drag: the editor sees dragenter/dragover wherever the pointer goes, as with a real drag.
  addEventListener('pointermove', event => {
    if (!carried) return;
    ghostTo(event.clientX, event.clientY);
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const init = { dataTransfer: carried.transfer, bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY };
    if (target !== carried.over) {
      carried.over?.dispatchEvent(new DragEvent('dragleave', init));
      target?.dispatchEvent(new DragEvent('dragenter', init));
      carried.over = target;
    }
    target?.dispatchEvent(new DragEvent('dragover', init));
  }, options);
  // An HTML5 drag inside the editor (media → timeline): Chrome draws its drag image outside the page.
  addEventListener('dragstart', event => {
    if (!event.isTrusted) return;
    const source = event.target instanceof Element ? event.target : null;
    const name = source?.textContent.trim().split('\n')[0].slice(0, 40) || 'Clip';
    const thumb = source?.querySelector('img, canvas');
    ghost?.remove();
    ghost = layer('tut-ghost', `<div class="tut-chip">${thumb?.tagName === 'IMG' ? `<img src="${thumb.src}">` : ''}${escape(state.dragLabel ?? name)}</div>`);
    ghost.classList.remove('tut-fade', 'tut-hidden');
    ghostTo(event.clientX, event.clientY);
  }, options);
  addEventListener('dragover', event => {
    if (!event.isTrusted) return;
    ghostTo(event.clientX, event.clientY);
    const pointer = document.getElementById('doc-clip-pointer');
    const tip = window.__docClipPointer?.tip ?? 2;
    if (pointer) pointer.style.transform = `translate(${event.clientX - tip}px, ${event.clientY - tip}px)`;
  }, options);
  const endDrag = event => { if (event.isTrusted && !carried) { ghost?.remove(); ghost = undefined; state.dragLabel = undefined; } };
  addEventListener('drop', endDrag, options);
  addEventListener('dragend', endDrag, options);
}

/**
 * Page side: the point (CSS px) a tutorial target names, or { missing }.
 *   clip:<name>[#n][:start|end|middle|<seconds into the clip>]   a timeline clip (n-th of that name, from the left)
 *   time:<seconds>[@<track name>]                                 that time on a track lane (default: the first)
 *   ruler:<seconds> | ruler:end                                   that time on the time ruler (end: where the last clip ends)
 *   pane:<dock group | tab=<tab name>>[:<x>,<y>]                  a point in a dock group (0–1, default the middle)
 *   file:<n>                                                      the n-th file (0-based) of the desktop window
 *   node:<node id>[:<x>,<y>]                                      a node card in the node editor (0–1, default the middle)
 *   handle:<dock group>[:right|left|top|bottom]                   the resize handle on that side of a dock group
 *   aria:<label>[@<dock group>]                                   the element with exactly that aria-label
 *   option:<label>                                                an option of the open dropdown
 *   input:<value>                                                 the text field holding that value
 *   <text>[@<dock group>]                                         the visible element whose text is exactly that
 *   @<x>,<y>                                                      a page point
 */
export async function locateTutorialTarget(target) {
  const visible = element => {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) return false;
    const hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, (rect.left + rect.right) / 2)), Math.min(innerHeight - 1, Math.max(0, (rect.top + rect.bottom) / 2)));
    return !!hit && (element.contains(hit) || hit.contains(element));
  };
  const timeline = async () => {
    const result = await window.aiTools.execute('getTimelineState', {});
    if (!result?.success) throw new Error(`getTimelineState: ${result?.error}`);
    return result.data;
  };
  const lane = trackId => document.querySelector(`.track-lane[data-track-id="${trackId}"]`)?.getBoundingClientRect();
  if (target.startsWith('@')) { const [x, y] = target.slice(1).split(',').map(Number); return { x, y }; }
  if (target.startsWith('file:')) return window.__tutorial.filePoint(Number(target.slice(5)));
  if (target.startsWith('node:')) {
    // Node ids contain colons; a trailing "<x>,<y>" is the point inside the card (0–1).
    const parts = target.slice(5).split(':');
    const at = /^[\d.]+,[\d.]+$/.test(parts.at(-1)) ? parts.pop().split(',').map(Number) : [0.5, 0.5];
    const card = [...document.querySelectorAll('[data-node-id]')].find(element => element.dataset.nodeId === parts.join(':'));
    const rect = card?.getBoundingClientRect();
    if (!rect?.width) return { missing: `no visible node ${parts.join(':')}` };
    return { x: rect.left + at[0] * rect.width, y: rect.top + at[1] * rect.height };
  }
  if (target.startsWith('aria:') || target.startsWith('option:') || target.startsWith('input:')) {
    // aria:<label>[@group] the element with exactly that aria-label (a node card, a value field);
    // option:<label> an open dropdown's option; input:<value> the field that holds that value.
    const [kind] = target.split(':', 1);
    const [wanted, group] = target.slice(kind.length + 1).split('@');
    const scope = group ? document.querySelector(`.dock-tab-pane[data-group-id="${group}"]`) : document;
    if (!scope) return { missing: `no dock group ${group}` };
    const candidates = kind === 'aria' ? [...scope.querySelectorAll('[aria-label]')].filter(element => element.getAttribute('aria-label') === wanted)
      : kind === 'option' ? [...scope.querySelectorAll('[role="option"]')].filter(element => element.textContent.trim() === wanted)
        : [...scope.querySelectorAll('input')].filter(element => element.type !== 'color' && element.value.toLowerCase() === wanted.toLowerCase());
    // The largest visible one: a node card rather than its port of the same name.
    const onScreen = element => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && rect.right > 0
      && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight; };
    const element = candidates.filter(onScreen).toSorted((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height
      - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0];
    if (!element) return { missing: `no visible ${kind} "${wanted}"${group ? ` in ${group}` : ''}` };
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  if (target.startsWith('handle:')) {
    // The resize handle on one side of a dock group: handle:<group>:right|left|top|bottom.
    const [group, side = 'right'] = target.slice(7).split(':');
    const rect = document.querySelector(`.dock-tab-pane[data-group-id="${group}"]`)?.getBoundingClientRect();
    if (!rect) return { missing: `no dock group ${group}` };
    const vertical = side === 'left' || side === 'right';
    const edge = { right: rect.right, left: rect.left, top: rect.top, bottom: rect.bottom }[side];
    const handle = [...document.querySelectorAll('.dock-resize-handle')].map(element => element.getBoundingClientRect())
      .filter(box => (vertical ? box.height > box.width : box.width > box.height))
      .map(box => ({ box, gap: Math.abs((vertical ? box.left + box.width / 2 : box.top + box.height / 2) - edge) }))
      .filter(({ gap }) => gap < 12).toSorted((a, b) => a.gap - b.gap)[0]?.box;
    if (!handle) return { missing: `no resize handle on the ${side} of ${group}` };
    return vertical ? { x: handle.left + handle.width / 2, y: (rect.top + rect.bottom) / 2 } : { x: (rect.left + rect.right) / 2, y: handle.top + handle.height / 2 };
  }
  if (target.startsWith('pane:')) {
    const [group, at = '0.5,0.5'] = target.slice(5).split(':');
    // tab=<name>: the dock group holding that tab (a group made by dragging a tab has a generated id).
    const pane = group.startsWith('tab=')
      ? [...document.querySelectorAll('.dock-tab-pane[data-group-id]')].find(element => [...element.querySelectorAll('.dock-tab')]
        .some(tab => tab.textContent.trim().replace(/×$/, '') === group.slice(4)))
      : document.querySelector(`.dock-tab-pane[data-group-id="${group}"]`);
    const rect = pane?.getBoundingClientRect();
    if (!rect) return { missing: `no dock group ${group}` };
    const [fx, fy] = at.split(',').map(Number);
    return { x: rect.left + fx * rect.width, y: rect.top + fy * rect.height };
  }
  if (target.startsWith('clip:') || target.startsWith('time:') || target.startsWith('ruler:')) {
    const state = await timeline();
    const tracks = [...state.videoTracks, ...state.audioTracks];
    const x = (rect, seconds) => rect.left + seconds * state.zoom;
    if (target.startsWith('ruler:')) {
      // ruler:end – where the last clip ends.
      const at = target.slice(6) === 'end' ? Math.max(0, ...tracks.flatMap(track => track.clips.map(clip => clip.endTime))) : Number(target.slice(6));
      const rect = lane(tracks[0].id), ruler = document.querySelector('.time-label')?.getBoundingClientRect();
      return rect && ruler ? { x: x(rect, at), y: (ruler.top + ruler.bottom) / 2 } : { missing: 'no time ruler' };
    }
    if (target.startsWith('time:')) {
      const [seconds, trackName] = target.slice(5).split('@');
      const track = trackName ? tracks.find(item => item.name === trackName) : tracks[0];
      const rect = track && lane(track.id);
      return rect ? { x: x(rect, Number(seconds)), y: (rect.top + rect.bottom) / 2 } : { missing: `no track ${trackName ?? ''}` };
    }
    const [nameAndIndex, where = 'middle'] = target.slice(5).split(':');
    const [name, nth = '1'] = nameAndIndex.split('#');
    const matches = tracks.flatMap(track => track.clips.filter(clip => clip.name === name).map(clip => ({ clip, track })))
      .toSorted((a, b) => a.clip.startTime - b.clip.startTime);
    const found = matches[Number(nth) - 1];
    if (!found) return { missing: `no clip ${name} #${nth} on the timeline (clips: ${tracks.flatMap(track => track.clips.map(clip => clip.name)).join(', ') || 'none'})` };
    const rect = lane(found.track.id);
    if (!rect) return { missing: `track ${found.track.name} is not visible` };
    const { startTime, endTime } = found.clip;
    // Trim handles sit just inside the clip edges.
    const time = where === 'start' ? startTime + 4 / state.zoom : where === 'end' ? endTime - 4 / state.zoom
      : where === 'middle' ? (startTime + endTime) / 2 : startTime + Number(where);
    return { x: x(rect, time), y: (rect.top + rect.bottom) / 2 };
  }
  const [text, group] = target.split('@');
  const scope = group ? document.querySelector(`.dock-tab-pane[data-group-id="${group}"]`) : document.body;
  if (!scope) return { missing: `no dock group ${group}` };
  // Text nodes first (fast even in a large node graph); an element whose text is split over
  // several children only through the full scan.
  const ours = item => !item.closest('.tut-layer, #doc-clip-pointer');
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let element;
  for (let node = walker.nextNode(); node && !element; node = walker.nextNode()) {
    if (node.nodeValue.trim() === text && node.parentElement && ours(node.parentElement) && visible(node.parentElement)) element = node.parentElement;
  }
  element ??= [...scope.querySelectorAll('*')].find(item => ours(item)
    && item.textContent.trim() === text && ![...item.children].some(child => child.textContent.trim() === text) && visible(item));
  if (!element) return { missing: `no visible element reading "${text}"${group ? ` in ${group}` : ''}` };
  const range = document.createRange();
  range.selectNodeContents(element);
  const rect = range.getBoundingClientRect().width ? range.getBoundingClientRect() : element.getBoundingClientRect();
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}

/**
 * Page side: the camera for `spec` – the 16:9 box (CSS px) that frames it, as { cx, cy, zoom }.
 *   "all"                         the whole editor
 *   ["left-group", ...]           the union of these dock groups
 *   { panes, pad, maxZoom }       the same with padding (CSS px) and a zoom limit (default 1.8)
 *   { box: [x, y, w, h] }         a page box
 */
export function cameraFor(spec) {
  const viewport = { width: innerWidth, height: innerHeight };
  if (spec === 'all' || !spec) return { cx: viewport.width / 2, cy: viewport.height / 2, zoom: 1 };
  const options = Array.isArray(spec) ? { panes: spec } : spec;
  let box;
  if (options.box) {
    const [x, y, w, h] = options.box;
    box = { left: x, top: y, right: x + w, bottom: y + h };
  } else {
    // A pane by its dock group id, or "tab=<name>" for the group whose active tab has that name (a group
    // that was dragged elsewhere gets a generated id).
    const paneOf = id => (id.startsWith('tab=')
      ? [...document.querySelectorAll('.dock-tab-pane[data-group-id]')].find(pane => pane.querySelector('.dock-tab-bar [role="tab"][aria-selected="true"] .dock-tab-title')?.textContent.trim() === id.slice(4))
      : document.querySelector(`.dock-tab-pane[data-group-id="${id}"]`));
    const rects = options.panes.map(id => paneOf(id)?.getBoundingClientRect());
    if (rects.some(rect => !rect)) return { missing: `no dock group among ${options.panes.join(', ')}` };
    const pad = options.pad ?? 8;
    box = { left: Math.min(...rects.map(rect => rect.left)) - pad, top: Math.min(...rects.map(rect => rect.top)) - pad,
      right: Math.max(...rects.map(rect => rect.right)) + pad, bottom: Math.max(...rects.map(rect => rect.bottom)) + pad };
  }
  const aspect = viewport.width / viewport.height;
  let width = box.right - box.left, height = box.bottom - box.top;
  if (width / height < aspect) width = height * aspect; else height = width / aspect;
  const zoom = Math.max(1, Math.min(options.maxZoom ?? 1.8, viewport.width / width));
  // Keep the framed box inside the page.
  const halfW = viewport.width / zoom / 2, halfH = viewport.height / zoom / 2;
  const cx = Math.min(viewport.width - halfW, Math.max(halfW, (box.left + box.right) / 2));
  const cy = Math.min(viewport.height - halfH, Math.max(halfH, (box.top + box.bottom) / 2));
  return { cx, cy, zoom };
}
