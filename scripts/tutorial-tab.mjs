// The build server: one open editor in the same headless Chrome a take records in (2560×1440, scale 1), so an
// agent builds a part's start state step by step and sees every step (see scripts/tutorials/guides/agents.md).
//
//   node scripts/tutorial-tab.mjs serve [--from <checkpoint>] [--project <name>] [--url <url>]
//                                                start the editor (from a checkpoint, or a new project) and wait;
//                                                --keep continues the build server's last editor (after a restart)
//   node scripts/tutorial-tab.mjs step '<step json>' ['<step json>' …]
//                                                run recipe steps there; a picture after each
//   node scripts/tutorial-tab.mjs shot [name]    a picture of the page (tutorial-videos/.tab/shots/<name>.jpg)
//   node scripts/tutorial-tab.mjs locate <target>   where a step target is, with a picture of it marked
//   node scripts/tutorial-tab.mjs state          clips, playhead, selection, panels, focus
//   node scripts/tutorial-tab.mjs checkpoint <name> ['<resume steps json>']
//                                                save the editor as a checkpoint (then continue from it)
//   node scripts/tutorial-tab.mjs make <recipe> [options]
//                                                a take (options of scripts/tutorial-video.mjs); afterwards the editor
//                                                continues from the take's end checkpoint
//   node scripts/tutorial-tab.mjs eval <file.js | code>
//                                                run a snippet with (context, load, page, session); it returns what to print
//
//   serve --attach                               the user's running Chrome instead (asks to allow the connection;
//                                                1280×720 screencast only: for trying things, not for takes)
//
// Jobs pass through tutorial-videos/.tab/ (job → log → result). Every job imports the newest helpers, so edits
// to them apply without restarting the server.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = path.join(import.meta.dirname, '..', 'tutorial-videos', '.tab');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const [mode, ...rest] = process.argv.slice(2);
const option = (args, name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const load = file => import(`${pathToFileURL(path.resolve(import.meta.dirname, '..', file)).href}?t=${Date.now()}`);

async function serve() {
  fs.mkdirSync(dir, { recursive: true });
  // One build server at a time: a new one takes over (the old one sees the pid file change and exits).
  const pidFile = path.join(dir, 'server');
  fs.writeFileSync(pidFile, String(process.pid));
  for (const file of fs.readdirSync(dir)) if (/\.(job|tmp|log|done)$/.test(file)) fs.rmSync(path.join(dir, file));
  const url = option(rest, '--url', 'http://localhost:5192').replace(/\/$/, '');
  const work = path.join(dir, 'work'), profile = path.join(dir, 'profile');
  // Pictures are numbered on from the last run, so a restarted server does not overwrite them.
  let chrome, session, shots = fs.existsSync(path.join(work, 'steps'))
    ? Math.max(0, ...fs.readdirSync(path.join(work, 'steps')).map(name => Number(name.match(/^step(\d+)-/)?.[1] ?? 0))) : 0;

  // The editor in the headless Chrome, on the build server's own profile (a copy of `from`, if given).
  const open = async ({ from, keep = false } = {}) => {
    const { openSession } = await load('scripts/tutorialSession.mjs');
    const { copyProfile, readCheckpoint } = await load('scripts/tutorialCheckpoint.mjs');
    if (!keep) copyProfile(from ? readCheckpoint(from).profile : null, profile);
    session = await openSession({ url, work, profile, from: keep ? undefined : from, project: keep ? false : option(rest, '--project', 'Workbench'),
      storage: { settings: { hasSeenTutorial: true, hasSeenTutorialPart2: true } }, fresh: true });
    session.from = from;
    console.log(`editor open${from ? ` from checkpoint ${from}` : ''}: ${url}/editor`);
  };

  if (rest.includes('--attach')) {
    const { connectChrome } = await load('scripts/tutorialBrowser.mjs');
    // Chrome refuses (403) until the user allows the connection in its dialog, so ask again a while.
    for (let attempt = 1; !chrome; attempt += 1) {
      try {
        chrome = await connectChrome();
      } catch (error) {
        if (attempt >= 40 || !/403|Forbidden|rejected|Timeout/i.test(error.message)) throw error;
        if (attempt === 1) console.log('Waiting for Chrome: allow the remote debugging connection there …');
        await pause(3000);
      }
    }
    chrome.browser().on('disconnected', () => { console.log('Chrome closed the connection.'); process.exit(1); });
    console.log('Connected to Chrome (1280×720 screencast: for trying things, not for takes).');
  } else await open(rest.includes('--keep') ? { keep: true } : { from: option(rest, '--from') });
  const stop = async reason => {
    console.log(reason);
    await session?.close().catch(() => {});
    process.exit(0);
  };
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => void stop(`${signal}: closing the editor`));
  console.log('Waiting for jobs: node scripts/tutorial-tab.mjs step | shot | locate | state | checkpoint | make | eval');

  // The step runner and helpers are imported again for every job, so edits to them apply at once.
  const needSession = async () => {
    if (!session) throw new Error(chrome ? 'this command needs the headless build server (serve without --attach)' : 'the editor is not open (an earlier job failed): restart serve');
    const { tutorialModules } = await load('scripts/tutorialSession.mjs');
    const m = await tutorialModules(true);
    Object.assign(session, m.stepRunner({ page: session.page, context: session.context, mouse: session.mouse, viewport: session.viewport,
      work, take: session.take, helpers: m }), { modules: m });
  };
  const commands = {
    async step(args) {
      await needSession();
      const { runSteps } = await load('scripts/tutorialSession.mjs');
      const steps = args.flatMap(arg => [JSON.parse(arg)].flat());
      shots += 1;
      const items = await runSteps(session, steps, { prefix: `step${String(shots).padStart(3, '0')}` });
      for (const item of items) console.log(`${item.label}: ${path.relative(process.cwd(), item.file)}`);
    },
    async shot([name]) {
      await needSession();
      const { snapshot } = await load('scripts/tutorialPictures.mjs');
      fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });
      shots += 1;
      const file = path.join(dir, 'shots', `${name ?? `shot${String(shots).padStart(3, '0')}`}.jpg`);
      await snapshot(session.context, session.page, file);
      console.log(path.relative(process.cwd(), file));
    },
    async locate(args) {
      await needSession();
      const target = args.join(' ');
      const point = await session.locate(target);
      const { snapshot } = await load('scripts/tutorialPictures.mjs');
      // A ring at the point, for a picture of the area around it.
      await session.page.evaluate(({ x, y }) => {
        const ring = document.createElement('div');
        ring.id = 'tutorial-locate-ring';
        Object.assign(ring.style, { position: 'fixed', left: `${x - 14}px`, top: `${y - 14}px`, width: '28px', height: '28px', borderRadius: '50%',
          border: '3px solid #ff2d55', boxShadow: '0 0 0 2px #fff', zIndex: 2147483647, pointerEvents: 'none' });
        document.documentElement.append(ring);
      }, point);
      const { width, height } = session.viewport, half = { w: 480, h: 270 };
      const clip = { x: Math.max(0, Math.min(width - 2 * half.w, point.x - half.w)), y: Math.max(0, Math.min(height - 2 * half.h, point.y - half.h)), width: 2 * half.w, height: 2 * half.h };
      fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });
      const file = path.join(dir, 'shots', 'locate.jpg');
      try { await snapshot(session.context, session.page, file, { clip }); } finally { await session.page.evaluate(() => document.getElementById('tutorial-locate-ring')?.remove()); }
      console.log(`${target}: x ${Math.round(point.x)}, y ${Math.round(point.y)} (pointer now at ${Object.values(session.mouse.position()).map(Math.round).join(', ')})`);
      console.log(`picture: ${path.relative(process.cwd(), file)}`);
    },
    async state() {
      await needSession();
      const { readRuntime } = await load('scripts/tutorialCheckpoint.mjs');
      const runtime = await session.page.evaluate(readRuntime);
      const focus = await session.page.evaluate(() => {
        const active = document.activeElement;
        return !active || active === document.body ? 'nothing (letters would be timeline shortcuts)'
          : `${active.tagName.toLowerCase()}${active.getAttribute('aria-label') ? ` "${active.getAttribute('aria-label')}"` : ''}${'value' in active ? ` value "${active.value}"` : ''}`;
      });
      console.log([`${runtime.playing ? 'PLAYING' : 'paused'} at ${runtime.playhead.toFixed(2)} s, composition ${runtime.composition}`,
        `selected: ${runtime.selected.join(', ') || 'nothing'}`, ...runtime.clips, `panels: ${runtime.layout.join(', ')}`, `focus: ${focus}`,
        `pointer: ${Object.values(session.mouse.position()).map(Math.round).join(', ')}${session.from ? `, started from checkpoint ${session.from}` : ''}`].join('\n'));
    },
    async checkpoint([name, resume]) {
      await needSession();
      if (!name) throw new Error('name the checkpoint: checkpoint <name> [\'<resume steps json>\']');
      const m = await load('scripts/tutorialCheckpoint.mjs');
      const { snapshot } = await load('scripts/tutorialPictures.mjs');
      const last = await snapshot(session.context, session.page, path.join(work, 'last.png'));
      const state = { recipe: null, origin: new URL(url).origin, viewport: session.viewport, runtime: await session.page.evaluate(m.readRuntime),
        pointer: session.mouse.position(), camera: { cx: session.viewport.width / 2, cy: session.viewport.height / 2, zoom: 1 },
        resume: resume ? [JSON.parse(resume)].flat() : (session.checkpoint?.resume ?? []) };
      await m.saveCheckpoint({ name, page: session.page, profile, close: session.close, lastPng: last, state });
      session = null;
      await open({ from: name });
    },
    async make(args) {
      if (session) { await session.close(); session = null; }
      const started = Date.now();
      const { main } = await load('scripts/tutorial-video.mjs');
      try {
        return await main(args, { chrome, fresh: true });
      } finally {
        if (!chrome) {
          // Continue from the take's end checkpoint, or where the editor was if the take saved none.
          const recipe = JSON.parse(fs.readFileSync(args.find(arg => arg.endsWith('.json')), 'utf8'));
          const saved = args.includes('--setup-only') ? option(args, '--save', `${recipe.name}-start`) : recipe.checkpoint ?? recipe.name;
          const { checkpointDir } = await load('scripts/tutorialCheckpoint.mjs');
          const fresh = fs.existsSync(path.join(checkpointDir(saved), 'checkpoint.json'))
            && fs.statSync(path.join(checkpointDir(saved), 'checkpoint.json')).mtimeMs > started;
          await open(fresh ? { from: saved } : { keep: true }).catch(error => console.log(`the editor did not reopen: ${error.message}`));
        }
      }
    },
    async eval(args) {
      const code = fs.existsSync(args[0]) ? fs.readFileSync(args[0], 'utf8') : args.join(' ');
      const value = await new Function('context', 'load', 'page', 'session', `return (async () => { ${code} })()`)(chrome ?? session?.context, load, session?.page, session);
      if (value !== undefined) console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 1));
    },
  };

  for (;;) {
    if (fs.readFileSync(pidFile, 'utf8').trim() !== String(process.pid)) await stop('another build server took over');
    const job = fs.readdirSync(dir).filter(file => file.endsWith('.job')).sort()[0];
    if (!job) { await pause(300); continue; }
    const id = job.slice(0, -4), log = path.join(dir, `${id}.log`);
    const request = JSON.parse(fs.readFileSync(path.join(dir, job), 'utf8'));
    fs.rmSync(path.join(dir, job));
    // The job's output goes to its log as well, for the waiting caller.
    const original = { log: console.log, warn: console.warn };
    const tee = print => (...parts) => { print(...parts); fs.appendFileSync(log, `${parts.join(' ')}\n`); };
    console.log = tee(original.log);
    console.warn = tee(original.warn);
    let result;
    try {
      const command = commands[request.mode];
      if (!command) throw new Error(`unknown command ${request.mode}`);
      result = { ok: true, ...await command(request.args) };
    } catch (error) {
      console.log(`ERROR ${error.stack ?? error.message}`);
      result = { ok: false, error: error.message };
    } finally {
      Object.assign(console, original);
    }
    fs.writeFileSync(path.join(dir, `${id}.done`), JSON.stringify(result));
  }
}

async function send() {
  const server = path.join(dir, 'server');
  const alive = fs.existsSync(server) && (() => { try { process.kill(Number(fs.readFileSync(server, 'utf8')), 0); return true; } catch { return false; } })();
  if (!alive) throw new Error('No server: start `node scripts/tutorial-tab.mjs serve` first');
  // Paths are resolved here, so the server finds them whatever its folder.
  const args = mode === 'eval' ? [fs.existsSync(rest[0]) ? path.resolve(rest[0]) : rest.join(' ')]
    : rest.map(arg => (!arg.startsWith('--') && !arg.startsWith('{') && !arg.startsWith('[') && fs.existsSync(arg) ? path.resolve(arg) : arg));
  const id = String(Date.now());
  fs.writeFileSync(path.join(dir, `${id}.tmp`), JSON.stringify({ mode, args }));
  fs.renameSync(path.join(dir, `${id}.tmp`), path.join(dir, `${id}.job`));
  let shown = 0;
  for (;;) {
    const log = path.join(dir, `${id}.log`), done = path.join(dir, `${id}.done`);
    if (fs.existsSync(log)) {
      const text = fs.readFileSync(log, 'utf8');
      process.stdout.write(text.slice(shown));
      shown = text.length;
    }
    if (fs.existsSync(done)) {
      const result = JSON.parse(fs.readFileSync(done, 'utf8'));
      for (const file of [log, done]) fs.rmSync(file, { force: true });
      process.exit(result.ok ? 0 : 1);
    }
    await pause(300);
  }
}

if (mode === 'serve') await serve();
else if (['make', 'eval', 'step', 'shot', 'locate', 'state', 'checkpoint'].includes(mode)) await send();
else {
  console.log('Usage: node scripts/tutorial-tab.mjs serve [--from <checkpoint>] | step <json> | shot [name] | locate <target> | state | checkpoint <name> | make <recipe> [options] | eval <file.js | code>');
  process.exit(1);
}
