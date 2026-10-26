// Shared by tutorial-video.mjs and tutorial-tab.mjs: what one recipe step does on the page. The take runs
// every step through it, and `tutorial-tab.mjs step` runs a single step in the build server's Chrome, so a
// setup can be built and checked step by step. The steps are listed in scripts/tutorial-video.mjs.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export const now = () => Date.now() / 1000;
const plain = text => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A small poster of a media file for the desktop window, as a data URL. */
function thumbnail(file) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', 'scale=256:-2',
    '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '4', '-'], { maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`No thumbnail of ${file}: ${result.stderr}`);
  return `data:image/jpeg;base64,${result.stdout.toString('base64')}`;
}

/** Page side: what an `expect` step compares, read from the editor tools and the page. */
async function editorFacts() {
  const state = (await window.aiTools.execute('getTimelineState', {}))?.data ?? {};
  const clips = [...(state.videoTracks ?? []), ...(state.audioTracks ?? [])]
    .flatMap(track => track.clips.map(clip => ({ name: clip.name, track: track.name, start: clip.startTime, end: clip.startTime + clip.duration })));
  return {
    clips, playhead: state.playheadPosition ?? 0, selected: (state.selectedClips ?? []).map(clip => clip.name),
    playing: Boolean(document.querySelector('.dock-tab-pane[data-group-id="timeline-group"] button[aria-label="Pause"]')),
  };
}

/**
 * The step runner for one page. mouse: humanMouse of scripts/docClipPointer.mjs; media: { <name>: <file> };
 * work: the folder for downloads; take: the recording's clock ({ t0, scene, lead, camera, fast, downloads }),
 * which camera, word, fast-wait and download steps write into. Helpers come from the take (locateTutorialTarget,
 * cameraFor, the gesture paths, snapshot for `expect` pictures).
 * Returns { run(step), locate(target) }.
 */
export function stepRunner({ page, context, mouse, viewport, media = {}, work, take, helpers }) {
  const { locateTutorialTarget, cameraFor, circlePoints, swingPoints, tracePoints, previewRect, snapshot, luminance } = helpers;
  const saved = since => take.fast.filter(range => range.from >= since - take.t0).reduce((sum, range) => sum + (range.to - range.from) * (1 - 1 / range.factor), 0);

  const locate = async target => {
    // ~dx,dy: relative to where the pointer is.
    if (target.startsWith('~')) { const [dx, dy] = target.slice(1).split(',').map(Number); const at = mouse.position(); return { x: at.x + dx, y: at.y + dy }; }
    // button:<name>: the button whose accessible name starts with it ("button:Export" for "Export ~109 MB").
    if (target.startsWith('button:')) {
      const name = target.slice(7).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const box = await page.getByRole('button', { name: new RegExp(`^\\s*${name}`) }).first().boundingBox({ timeout: 5000 }).catch(() => null);
      if (!box) throw new Error(`Step target "${target}": no visible button`);
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    // A control that is still appearing (a menu, a freshly opened tab) gets a moment to render.
    let point;
    for (const until = Date.now() + 1500; ; await pause(150)) {
      point = await page.evaluate(locateTutorialTarget, target);
      if (!point.missing || Date.now() > until) break;
    }
    if (point.missing) throw new Error(`Step target "${target}": ${point.missing}`);
    return point;
  };
  const pointer = () => page.evaluate(() => window.__docClipPointer.expected.at(-1));
  // A click on an overlay (the desktop window): the ripple without a real click on the editor beneath.
  const fakeClick = () => page.evaluate(() => {
    const { x, y } = window.__docClipPointer.expected.at(-1), ripple = document.createElement('div');
    ripple.className = 'doc-clip-ripple';
    Object.assign(ripple.style, { left: `${x}px`, top: `${y}px` });
    document.documentElement.append(ripple);
    setTimeout(() => ripple.remove(), 650);
  });
  // A port of a node card by its aria-label, the one nearest the card (ports exist as page
  // elements only while the pointer is over their card).
  const portNear = async (label, card) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const point = await page.evaluate(({ label, card }) => {
        const ports = [...document.querySelectorAll('.node-workspace-port')].filter(port => port.getAttribute('aria-label') === label && port.getBoundingClientRect().width);
        const centers = ports.map(port => { const rect = port.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; });
        return centers.toSorted((a, b) => Math.hypot(a.x - card.x, a.y - card.y) - Math.hypot(b.x - card.x, b.y - card.y))[0] ?? null;
      }, { label, card });
      if (point) return point;
      await pause(120);
    }
    throw new Error(`no port "${label}" near the card`);
  };
  const press = async (button = 'left') => { await pause(140); await page.mouse.down({ button }); await pause(90); await page.mouse.up({ button }); };

  /**
   * { "expect": { clips, clip: { name, track, start, end }, playing, playhead, selected, text, gone, previewNotBlack, within } }
   * Times match within `within` s (default 0.1: a drag lands a few frames off).
   */
  const expectState = async want => {
    const facts = await page.evaluate(editorFacts);
    const wrong = [], near = (a, b) => Math.abs(a - b) <= (want.within ?? 0.1);
    if (want.clips !== undefined && facts.clips.length !== want.clips) wrong.push(`${facts.clips.length} clips, not ${want.clips}`);
    for (const clip of [want.clip ?? []].flat()) {
      const found = facts.clips.filter(item => item.name === clip.name && (!clip.track || item.track === clip.track));
      if (!found.length) { wrong.push(`no clip "${clip.name}"${clip.track ? ` on ${clip.track}` : ''}`); continue; }
      const item = found[0];
      if (clip.start !== undefined && !near(item.start, clip.start)) wrong.push(`${clip.name} starts at ${item.start.toFixed(2)}, not ${clip.start}`);
      if (clip.end !== undefined && !near(item.end, clip.end)) wrong.push(`${clip.name} ends at ${item.end.toFixed(2)}, not ${clip.end}`);
    }
    if (want.playing !== undefined && facts.playing !== want.playing) wrong.push(facts.playing ? 'the timeline is playing' : 'the timeline is paused');
    if (want.playhead !== undefined && !near(facts.playhead, want.playhead)) wrong.push(`playhead at ${facts.playhead.toFixed(2)}, not ${want.playhead}`);
    if (want.selected !== undefined && JSON.stringify(facts.selected) !== JSON.stringify([want.selected].flat())) wrong.push(`selected: ${facts.selected.join(', ') || 'nothing'}`);
    for (const text of [want.text ?? []].flat()) if (!await page.getByText(text, { exact: true }).first().isVisible().catch(() => false)) wrong.push(`"${text}" is not visible`);
    for (const text of [want.gone ?? []].flat()) if (await page.getByText(text, { exact: true }).first().isVisible().catch(() => false)) wrong.push(`"${text}" is still visible`);
    if (want.previewNotBlack) {
      const rect = await page.evaluate(previewRect);
      if (!rect) wrong.push('no preview canvas visible');
      else {
        // The drawn pointer and the overlays would count as picture: hidden for the moment of the check.
        const file = path.join(work, 'expect-preview.png');
        const overlays = '#doc-clip-pointer, .doc-clip-ripple, .tut-layer';
        await page.evaluate(selector => document.querySelectorAll(selector).forEach(element => { element.style.visibility = 'hidden'; }), overlays);
        try { await snapshot(context, page, file, { clip: rect }); }
        finally { await page.evaluate(selector => document.querySelectorAll(selector).forEach(element => { element.style.visibility = ''; }), overlays); }
        const light = await luminance(file);
        if (light.lit < 0.005) wrong.push(`the preview is black (${(light.lit * 100).toFixed(2)} % of its pixels are lit)`);
      }
    }
    if (wrong.length) throw new Error(`expected ${JSON.stringify(want)}: ${wrong.join('; ')} (clips: ${facts.clips.map(clip => `${clip.track}/${clip.name}@${clip.start.toFixed(2)}–${clip.end.toFixed(2)}`).join(', ') || 'none'})`);
  };

  const run = async step => {
    if (step.pause) await pause(step.pause);
    else if (step.expect) await expectState(step.expect);
    else if (step.defaultLayout) {
      // Setup: View > Layouts > Load Default Layout until the panels have their default widths (a project
      // that opens late may restore its own saved layout over it).
      const leftWidth = () => page.evaluate(() => document.querySelector('.dock-tab-pane[data-group-id="left-group"]')?.getBoundingClientRect().width ?? 0);
      for (let attempt = 0; ; attempt += 1) {
        await page.getByText('View', { exact: true }).first().click();
        await page.getByText('Layouts', { exact: true }).first().hover();
        await pause(300);
        await page.getByText('Load Default Layout', { exact: true }).first().click();
        await pause(1200);
        const width = await leftWidth();
        if (Math.abs(width - viewport.width * (step.defaultLayout.left ?? 0.293)) < 40 * viewport.width / 1280) break;
        if (attempt >= 3) throw new Error(`the default layout did not stay: left group ${Math.round(width)} px`);
      }
    } else if (step.word) {
      // The narration reaches the word at the scene's start + lead + its offset in the sentence
      // (sped-up waits in between count at their output length).
      const scene = take.scene;
      if (!scene?.part) return;
      const matches = scene.part.words.filter(word => plain(word.text) === plain(step.word));
      const word = matches[(step.nth ?? 1) - 1];
      if (!word) throw new Error(`no word "${step.word}" #${step.nth ?? 1} in scene ${scene.id}`);
      const at = scene.start + take.lead + (word.start - scene.part.start) + saved(scene.start) - (step.early ?? 0);
      const wait = at - now();
      if (wait < -0.15) console.warn(`  ${scene.id}: ${(-wait).toFixed(2)} s late for "${step.word}"`);
      if (wait > 0) await pause(wait * 1000);
    } else if (step.card) {
      await page.evaluate(card => window.__tutorial.card(card), step.card);
      await pause(step.ms ?? 2500);
      if (!step.keep) await page.evaluate(() => window.__tutorial.hideCard());
    } else if (step.hideCard) await page.evaluate(() => window.__tutorial.hideCard());
    else if (step.camera) {
      let framing;
      if (step.camera.focus) {
        // A push in (or out) around a point, kept inside the page.
        const at = step.camera.focus === 'pointer' ? mouse.position() : await locate(step.camera.focus);
        const zoom = step.camera.zoom ?? 1.15, halfW = viewport.width / zoom / 2, halfH = viewport.height / zoom / 2;
        framing = { zoom, cx: Math.min(viewport.width - halfW, Math.max(halfW, at.x)), cy: Math.min(viewport.height - halfH, Math.max(halfH, at.y)) };
      } else framing = await page.evaluate(cameraFor, step.camera);
      if (framing.missing) throw new Error(framing.missing);
      take.camera.push({ t: now() - take.t0, ms: step.ms ?? 900, ...framing });
    } else if (step.files) {
      const missing = step.files.filter(name => !media[name]);
      if (missing.length) throw new Error(`No file for ${missing.join(', ')}: name it in the recipe's "media" (or serve --recipe / --media)`);
      const at = await locate(step.at ?? 'pane:preview-group:0.3,0.2');
      await page.evaluate(window_ => window.__tutorial.files(window_), {
        title: step.title ?? 'Desktop', x: at.x, y: at.y,
        list: step.files.map(name => ({ name, thumb: thumbnail(media[name]), url: `/__tutorial-media/${encodeURIComponent(name)}` })) });
      await pause(step.after ?? 500);
    } else if (step.pick) {
      for (const [order, index] of step.pick.entries()) {
        await mouse.glide(await locate(`file:${index}`), { ms: step.ms });
        if (order) await page.evaluate(() => window.__tutorial.key('Shift', window.__docClipPointer.expected.at(-1)));
        await pause(120);
        await fakeClick();
        await page.evaluate(([i, add]) => window.__tutorial.selectFile(i, add), [index, order > 0]);
        await pause(step.after ?? 380);
      }
    } else if (step.dropFiles) {
      await page.evaluate(() => window.__tutorial.pickUp());
      await mouse.glide(await locate(step.dropFiles), { ms: step.ms ?? 1300 });
      await pause(250);
      const at = await pointer();
      const target = await page.evaluate(({ x, y }) => window.__tutorial.drop(x, y), at);
      console.log(`  dropped the files on ${target}`);
      await pause(300);
      await page.evaluate(() => window.__tutorial.hideFiles());
    } else if (step.drag) {
      if (step.label) await page.evaluate(label => { window.__tutorial.dragLabel = label; }, step.label);
      await mouse.glide(await locate(step.drag), { ms: step.approach });
      await pause(180);
      await page.mouse.down();
      await pause(step.hold ?? 120);
      // A few pixels first, so the editor (and Chrome's HTML5 drag) recognize a drag before the long move.
      const from = await pointer();
      await mouse.glide({ x: from.x + 6, y: from.y + 2 }, { ms: 120, straight: true });
      if (step.via) {
        // Through the via points (a "~dx,dy" one is relative to the point before it) to `to`.
        const way = [];
        for (const target of [...step.via, step.to]) {
          const [dx, dy] = target.startsWith('~') ? target.slice(1).split(',').map(Number) : [];
          const last = way.at(-1) ?? mouse.position();
          way.push(target.startsWith('~') ? { x: last.x + dx, y: last.y + dy } : await locate(target));
        }
        await mouse.path(way, { ms: step.ms ?? 1500 });
      } else await mouse.glide(await locate(step.to), { ms: step.ms });
      await pause(220);
      await page.mouse.up();
      await pause(step.after ?? 200);
    } else if (step.click) {
      for (let attempt = 0; attempt < (step.until ? 3 : 1); attempt += 1) {
        if (step.until && await page.getByText(step.until, { exact: true }).first().isVisible().catch(() => false)) break;
        await mouse.glide(await locate(step.click), { ms: step.ms });
        await press(step.button);
        await pause(step.after ?? 250);
      }
    } else if (step.cableClick) {
      // Right-click the middle of the cable between two node cards (its context menu inserts nodes).
      const { from, output, to, input, group = 'left-group' } = step.cableClick;
      const source = await locate(`aria:${from}@${group}`);
      await mouse.glide(source, { ms: step.approach });
      await pause(150);
      const start = await portNear(output, source);
      const target = await locate(`aria:${to}@${group}`);
      await mouse.glide(target, { ms: 450 });
      await pause(150);
      const end = await portNear(input, target);
      await mouse.glide({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, { ms: step.ms ?? 450 });
      await press('right');
      await pause(step.after ?? 300);
    } else if (step.connect) {
      // A cable between two node cards: ports exist as page elements only under the pointer, so
      // the pointer rests on the source card, grabs its port, drags onto the target card and
      // settles on the input that appeared there.
      const { from, output, to, input, group = 'left-group' } = step.connect;
      const source = await locate(`aria:${from}@${group}`);
      await mouse.glide(source, { ms: step.approach });
      await pause(200);
      await mouse.glide(await portNear(output, source), { ms: 280 });
      await pause(120);
      await page.mouse.down();
      await pause(100);
      const target = await locate(`aria:${to}@${group}`);
      await mouse.glide(target, { ms: step.ms ?? 900 });
      await pause(220);
      await mouse.glide(await portNear(input, target), { ms: 300 });
      await pause(160);
      await page.mouse.up();
      await pause(step.after ?? 250);
    } else if (step.marquee) {
      // A right-drag marquee around the named node cards (with `pad` CSS px around them).
      const group = step.group ?? 'left-group', pad = step.pad ?? 10;
      const box = await page.evaluate(({ labels, group }) => {
        const pane = document.querySelector(`.dock-tab-pane[data-group-id="${group}"]`);
        const rects = labels.map(label => [...(pane?.querySelectorAll('[data-node-id][aria-label]') ?? [])]
          .filter(element => element.getAttribute('aria-label') === label).map(element => element.getBoundingClientRect())
          .filter(rect => rect.width > 8).toSorted((a, b) => b.width * b.height - a.width * a.height)[0]).filter(Boolean);
        if (rects.length !== labels.length) return { missing: `only ${rects.length} of ${labels.length} node cards visible` };
        return { left: Math.min(...rects.map(r => r.left)), top: Math.min(...rects.map(r => r.top)),
          right: Math.max(...rects.map(r => r.right)), bottom: Math.max(...rects.map(r => r.bottom)) };
      }, { labels: step.marquee, group });
      if (box.missing) throw new Error(`marquee: ${box.missing}`);
      await mouse.glide({ x: box.left - pad, y: box.bottom + pad }, { ms: step.approach });
      await pause(150);
      await page.mouse.down({ button: 'right' });
      await pause(80);
      await mouse.path([{ x: box.right + pad, y: box.top - pad }], { ms: step.ms ?? 900 });
      await pause(120);
      await page.mouse.up({ button: 'right' });
      await pause(step.after ?? 250);
    } else if (step.dblclick) {
      await mouse.glide(await locate(step.dblclick), { ms: step.ms });
      await pause(140);
      for (const clickCount of [1, 2]) { await page.mouse.down({ clickCount }); await pause(60); await page.mouse.up({ clickCount }); await pause(70); }
      await pause(step.after ?? 250);
    } else if (step.scroll) {
      // Wheel turns at the target: scrolls a panel, or zooms the node canvas (negative dy zooms in).
      await mouse.glide(await locate(step.scroll), { ms: step.ms });
      const turns = step.turns ?? 6;
      for (let turn = 0; turn < turns; turn += 1) { await page.mouse.wheel(0, (step.dy ?? 240) / turns); await pause(step.every ?? 70); }
      await pause(step.after ?? 250);
    } else if (step.move) await mouse.glide(await locate(step.move), { ms: step.ms });
    else if (step.circle) {
      const center = await locate(step.circle);
      await mouse.path(circlePoints(center, mouse.position(), step), { ms: step.ms ?? 900 });
    } else if (step.wave || step.nod) {
      const center = await locate(step.wave ?? step.nod);
      if (Math.hypot(center.x - mouse.position().x, center.y - mouse.position().y) > 3) await mouse.glide(center, { ms: step.approach });
      await mouse.path(swingPoints(center, { amp: step.amp ?? (step.wave ? 40 : 12), cycles: step.cycles ?? 2, axis: step.wave ? 'x' : 'y' }), { ms: step.ms ?? 900 });
    } else if (step.trace) {
      const points = [];
      for (const target of step.trace) points.push(await locate(target));
      await mouse.glide(points[0], { ms: step.approach });
      await mouse.path(tracePoints(points, step).filter((_, index) => step.curve || index > 0), { ms: step.ms ?? 900 });
    } else if (step.type) {
      // Letters typed outside a text field are timeline shortcuts (l plays, j and k shuttle): refuse them.
      const typing = await page.evaluate(() => {
        const active = document.activeElement;
        return Boolean(active && (active.isContentEditable || (active.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes(active.type)) || active.tagName === 'TEXTAREA'));
      });
      if (!typing) throw new Error(`type "${step.type}": no text field has the focus, so the letters would reach the timeline as shortcuts (click the field first)`);
      await page.keyboard.type(step.type, { delay: step.delay ?? 110 });
    } else if (step.press) { await page.keyboard.press(step.press); await pause(step.after ?? 200); }
    else if (step.key) {
      await page.evaluate(label => window.__tutorial.key(label, window.__docClipPointer.expected.at(-1)), step.label ?? step.key.toUpperCase());
      await pause(250);
      await page.keyboard.press(step.key);
      await pause(step.after ?? 450);
    } else if (step.waitFor) {
      const from = now();
      const deadline = from + (step.timeout ?? 180);
      const count = take.downloads.length, savedDownloads = await page.evaluate(() => window.__tutorialDownloads.length);
      let saving;
      for (;;) {
        if (now() > deadline) throw new Error(`waitFor ${step.waitFor} timed out`);
        if (step.waitFor === 'media') {
          const items = await page.evaluate(() => window.aiTools.execute('getMediaItems', {}));
          if ((items?.data?.files ?? []).filter(file => !file.isImporting).length >= (step.count ?? 1)) break;
        } else if (step.waitFor === 'clips') {
          const state = await page.evaluate(() => window.aiTools.execute('getTimelineState', {}));
          if ([...(state?.data?.videoTracks ?? []), ...(state?.data?.audioTracks ?? [])].flatMap(track => track.clips).length >= (step.count ?? 1)) break;
        } else if (step.waitFor === 'download') {
          saving = await page.evaluate(index => window.__tutorialDownloads[index], savedDownloads);
          if (saving || take.downloads.length > count) break;
        } else if (step.waitFor === 'text') {
          if (await page.getByText(step.text, { exact: true }).first().isVisible().catch(() => false)) break;
        } else if (step.waitFor === 'gone') {
          if (!await page.getByText(step.text, { exact: true }).first().isVisible().catch(() => false)) break;
        } else throw new Error(`unknown waitFor ${step.waitFor}`);
        await pause(200);
      }
      if (step.fast) take.fast.push({ from: from - take.t0, to: now() - take.t0, factor: step.fast });
      if (step.waitFor === 'download') {
        const download = take.downloads.length > count ? take.downloads.at(-1) : undefined;
        const name = saving?.name ?? download.suggestedFilename();
        let size = saving?.size;
        if (download) {
          const file = path.join(work, name);
          await download.saveAs(file).catch(() => {});
          if (fs.existsSync(file)) size = fs.statSync(file).size;
        }
        await page.evaluate(chip => window.__tutorial.download(chip), { name, size: `${((size ?? 0) / 1e6).toFixed(1)} MB` });
        console.log(`  exported ${name} (${size} bytes)`);
      }
    } else throw new Error(`unknown step ${JSON.stringify(step)}`);
  };

  return { run, locate, saved };
}
