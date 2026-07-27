import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSyntheticBenchmark } from './benchmarkCore.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '..', '..');

function parseArgs(argv) {
  const options = {
    out: path.join(repoRoot, 'fixtures', 'agent-timeline-benchmarks'),
    profiles: ['quick', 'balanced', 'deep'],
    cacheStates: ['cold', 'warm'],
    cancelAfter: null,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') options.out = path.resolve(argv[++index] ?? options.out);
    else if (arg === '--profiles') options.profiles = (argv[++index] ?? '').split(',').filter(Boolean);
    else if (arg === '--cache-states') options.cacheStates = (argv[++index] ?? '').split(',').filter(Boolean);
    else if (arg === '--cancel-after') options.cancelAfter = argv[++index] ?? null;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/agent-timeline/run-benchmark.mjs [options]

Runs the deterministic synthetic Phase-0A benchmark. It reads no media and
does not use the network. Attach licensed real-media collectors only after this
schema and budget contract has a measured baseline.

Options:
  --out <dir>                Report directory (default fixtures/agent-timeline-benchmarks)
  --profiles quick,balanced  Comma-separated analysis profiles
  --cache-states cold,warm   Comma-separated cache states
  --cancel-after <checkpoint> Stop at a named checkpoint for cancel-path verification
`);
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) return printHelp();
  const report = await runSyntheticBenchmark({
    profiles: options.profiles,
    cacheStates: options.cacheStates,
    shouldCancel: (checkpoint) => checkpoint === options.cancelAfter,
  });
  await fs.mkdir(options.out, { recursive: true });
  const reportPath = path.join(options.out, 'report.synthetic.json');
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Agent Timeline synthetic benchmark: ${report.summary.completedRuns}/${report.summary.totalRuns} completed`);
  console.log(`Report: ${path.relative(repoRoot, reportPath)}`);
  if (report.summary.cancelledRuns > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
