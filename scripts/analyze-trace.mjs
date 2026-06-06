// One-off: aggregate CPU self-time per function/file from a DevTools trace.
import fs from 'fs';

const path = process.argv[2];
const raw = fs.readFileSync(path, 'utf8');
const json = JSON.parse(raw);
const events = Array.isArray(json) ? json : json.traceEvents;

const nodeFrame = new Map();      // nodeId -> callFrame
const selfByNode = new Map();     // nodeId -> total self time (us)

for (const ev of events) {
  if (ev.name !== 'ProfileChunk' && ev.name !== 'Profile') continue;
  const cp = ev.args?.data?.cpuProfile;
  if (cp?.nodes) {
    for (const n of cp.nodes) nodeFrame.set(n.id, n.callFrame);
  }
  const samples = cp?.samples || ev.args?.data?.samples;
  const deltas = ev.args?.data?.timeDeltas;
  if (samples && deltas) {
    for (let i = 0; i < samples.length; i++) {
      const id = samples[i];
      selfByNode.set(id, (selfByNode.get(id) || 0) + (deltas[i] || 0));
    }
  }
}

const byFn = new Map();   // "fn @ file:line" -> us
const byFile = new Map(); // file -> us
let total = 0;

for (const [id, us] of selfByNode) {
  const cf = nodeFrame.get(id);
  if (!cf) continue;
  const fn = cf.functionName || '(anonymous)';
  let url = cf.url || '(native)';
  url = url.replace(/^https?:\/\/localhost:\d+\//, '').replace(/\?.*$/, '');
  const key = `${fn}  @ ${url}:${cf.lineNumber ?? '?'}`;
  byFn.set(key, (byFn.get(key) || 0) + us);
  byFile.set(url, (byFile.get(url) || 0) + us);
  total += us;
}

const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const ms = (us) => (us / 1000).toFixed(1);

console.log(`Total sampled self-time: ${ms(total)} ms\n`);
console.log('=== TOP 25 FUNCTIONS by self time ===');
for (const [k, us] of top(byFn, 25)) console.log(`${ms(us).padStart(8)} ms  ${k}`);
console.log('\n=== TOP 15 FILES by self time ===');
for (const [k, us] of top(byFile, 15)) console.log(`${ms(us).padStart(8)} ms  ${k}`);

