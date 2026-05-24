import { spawnSync } from 'node:child_process';

const commands = [
  {
    name: 'jco',
    args: ['--version'],
    installHint: 'npm exec --yes @bytecodealliance/jco -- --version',
  },
  {
    name: 'componentize-js',
    args: ['--version'],
    installHint: 'npm exec --yes @bytecodealliance/componentize-js -- --version',
  },
];

function check(command) {
  const result = spawnSync(command.name, command.args, {
    encoding: 'utf8',
  });

  if (result.status === 0) {
    const version = `${result.stdout}${result.stderr}`.trim();
    console.log(`${command.name}: ${version || 'available'}`);
    return true;
  }

  console.log(`${command.name}: not found`);
  console.log(`  Try: ${command.installHint}`);
  return false;
}

const available = commands.map(check).every(Boolean);

console.log('');
console.log('WIT package: wit/masterselects/runtime.wit');
console.log('Transpile target: npm exec --yes @bytecodealliance/jco -- transpile <component.wasm> --out-dir dist/wasm/masterselects-importer');
console.log('Fixture fallback: src/runtime/wasm/fixtures/csvBinaryImporter.ts is testable without a Rust/Wasm toolchain.');

if (!available) {
  console.log('');
  console.log('Toolchain is optional for this slice; no build is required when jco/componentize-js are missing.');
}
