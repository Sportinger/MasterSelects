// Builds tutorial videos through one lasting connection to the user's Chrome, so iterating on a
// recipe does not ask for Chrome's permission on every take (see scripts/tutorials/README.md).
//
//   node scripts/tutorial-tab.mjs serve                     connect once (Chrome asks to allow it), then wait
//   node scripts/tutorial-tab.mjs make <recipe> [options]   build a video through the running server
//                                                           (options of scripts/tutorial-video.mjs, e.g. --recut)
//   node scripts/tutorial-tab.mjs eval <file.js | code>     run a snippet with (context, load) in the user's Chrome,
//                                                           e.g. to find a step's target; it returns what to print
//
// Jobs pass through tutorial-videos/.tab/ (job → log → result). Every job imports the newest
// tutorial-video.mjs and its helpers, so edits to them apply without reconnecting. The recording
// tab stays open between takes; if the user closes it, the next job opens a new one.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { connectChrome } from './tutorialBrowser.mjs';

const dir = path.join(import.meta.dirname, '..', 'tutorial-videos', '.tab');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const [mode, ...rest] = process.argv.slice(2);

async function serve() {
  fs.mkdirSync(dir, { recursive: true });
  for (const file of fs.readdirSync(dir)) fs.rmSync(path.join(dir, file));
  // Chrome refuses (403) until the user allows the connection in its dialog, so ask again a while.
  let chrome;
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
  fs.writeFileSync(path.join(dir, 'server'), String(process.pid));
  console.log('Connected to Chrome. Waiting for jobs: node scripts/tutorial-tab.mjs make <recipe>');
  for (;;) {
    const job = fs.readdirSync(dir).filter(file => file.endsWith('.job')).sort()[0];
    if (!job) { await pause(300); continue; }
    const id = job.slice(0, -4), log = path.join(dir, `${id}.log`);
    const request = JSON.parse(fs.readFileSync(path.join(dir, job), 'utf8'));
    fs.rmSync(path.join(dir, job));
    // The job's output goes to its log as well, for the waiting `make`.
    const original = { log: console.log, warn: console.warn };
    const tee = print => (...parts) => { print(...parts); fs.appendFileSync(log, `${parts.join(' ')}\n`); };
    console.log = tee(original.log);
    console.warn = tee(original.warn);
    let result;
    try {
      // load(module): a fresh import, so edited helpers apply without reconnecting.
      const load = file => import(`${pathToFileURL(path.resolve(import.meta.dirname, '..', file)).href}?t=${Date.now()}`);
      if (request.eval) {
        const value = await new Function('context', 'load', `return (async () => { ${request.eval} })()`)(chrome, load);
        if (value !== undefined) console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 1));
        result = { ok: true };
      } else {
        const { main } = await load('scripts/tutorial-video.mjs');
        result = { ok: true, ...await main(request, { chrome, fresh: true }) };
      }
    } catch (error) {
      console.log(`ERROR ${error.stack ?? error.message}`);
      result = { ok: false, error: error.message };
    } finally {
      Object.assign(console, original);
    }
    fs.writeFileSync(path.join(dir, `${id}.done`), JSON.stringify(result));
  }
}

async function make() {
  const server = path.join(dir, 'server');
  const alive = fs.existsSync(server) && (() => { try { process.kill(Number(fs.readFileSync(server, 'utf8')), 0); return true; } catch { return false; } })();
  if (!alive) throw new Error('No server: start `node scripts/tutorial-tab.mjs serve` first (and allow the connection in Chrome)');
  // Paths are resolved here, so the server finds them whatever its folder.
  const args = mode === 'eval' ? { eval: fs.existsSync(rest[0]) ? fs.readFileSync(rest[0], 'utf8') : rest.join(' ') }
    : rest.map(arg => (!arg.startsWith('--') && fs.existsSync(arg) ? path.resolve(arg) : arg));
  const id = String(Date.now());
  fs.writeFileSync(path.join(dir, `${id}.tmp`), JSON.stringify(args));
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
else if (mode === 'make' || mode === 'eval') await make();
else {
  console.log('Usage: node scripts/tutorial-tab.mjs serve | make <recipe> [options] | eval <file.js | code>');
  process.exit(1);
}
