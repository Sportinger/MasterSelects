import { readFile } from 'node:fs/promises';
import { freezeCampaign } from './campaign.mjs';
import { runCampaign, recover } from './worker.mjs';

const [command, configFile] = process.argv.slice(2);
try {
  if (!configFile || !['freeze', 'run', 'recover'].includes(command)) throw new Error('Usage: node scripts/windows-quality/cli.mjs freeze|run|recover <config.json>');
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  const result = command === 'freeze' ? await freezeCampaign(config, config.manifestFile)
    : command === 'run' ? await runCampaign(config) : await recover(config.stateRoot);
  console.log(JSON.stringify(result, null, 2));
  if (command === 'run' && result.verdict !== 'passed') process.exitCode = 1;
} catch (error) { console.error(String(error)); process.exitCode = 1; }
