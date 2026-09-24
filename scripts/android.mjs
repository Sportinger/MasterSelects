#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANDROID_ORIGIN, createAssetLinks, hasAssetLink } from './android/assetLinks.mjs';
import { prepareEditor } from './android/prepareEditor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const android = path.join(root, 'android');
const output = path.join(root, 'output/android');
const windows = process.platform === 'win32';
const [command = 'doctor', ...options] = process.argv.slice(2);
const option = name => {
  const position = options.indexOf(`--${name}`);
  return position === -1 ? undefined : options[position + 1];
};
const sdk = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
  path.join(homedir(), 'android-sdk'), path.join(homedir(), 'AppData/Local/Android/Sdk'),
  path.join(homedir(), 'Library/Android/sdk'), path.join(homedir(), 'Android/Sdk')]
  .find(candidate => candidate && ['android-37', 'android-37.0'].some(platform => existsSync(path.join(candidate, 'platforms', platform))));
const env = { ...process.env, ...(sdk ? { ANDROID_HOME: sdk } : {}) };

// Batch files need cmd.exe on Windows. Arguments to those calls are internally
// fixed task/file paths, not user-provided shell fragments.
function run(executable, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const batch = windows && /\.(bat|cmd)$/i.test(executable);
    if (batch && [executable, ...args].some(value => /["%\r\n]/.test(value))) {
      reject(new Error('Unsupported shell characters in Android build path.'));
      return;
    }
    const child = batch
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[executable, ...args].map(value => `"${value}"`).join(' ')}"`],
        { cwd: android, env, windowsHide: true, windowsVerbatimArguments: true, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
      : spawn(executable, args, { cwd: android, env, windowsHide: true, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let result = '';
    child.stdout?.on('data', data => { result += data; });
    child.stderr?.on('data', data => { result += data; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(result) : reject(new Error(`${path.basename(executable)} failed (${code}). ${capture ? result : 'See build output.'}`)));
  });
}

function requireSdk() {
  if (!sdk) throw new Error('Install Android SDK platform 37.0 and build tools 36.0.0, then set ANDROID_HOME. See docs/Features/Android-App.md.');
}

async function writeLinks(packageName, fingerprints, filename) {
  await mkdir(output, { recursive: true });
  const destination = path.join(output, filename);
  await writeFile(destination, JSON.stringify(createAssetLinks(packageName, fingerprints), null, 2) + '\n');
  console.log(`Prepared ${destination}; no website files were changed or deployed.`);
}

async function gradle(tasks) {
  requireSdk();
  await run(path.join(android, windows ? 'gradlew.bat' : 'gradlew'), [...tasks, '--console=plain', '--no-daemon']);
}

async function main() {
  if (command === 'doctor') {
    console.log(`Android SDK 37: ${sdk || 'NOT FOUND (set ANDROID_HOME)'}`);
    console.log(`Java: ${(await run('java', ['-version'], { capture: true })).split('\n')[0]}`);
    console.log('Build: node scripts/android.mjs build');
    if (sdk) console.log(await run(path.join(sdk, 'platform-tools', windows ? 'adb.exe' : 'adb'), ['devices', '-l'], { capture: true }));
    return;
  }
  if (command === 'build') {
    await prepareEditor(root);
    await gradle([':app:testDebugUnitTest', ':app:lintDebug', ':app:assembleDebug']);
    const builtApk = path.join(android, 'app/build/outputs/apk/debug/app-debug.apk');
    await run('java', [path.join(root, 'scripts/android/VerifyBundle.java'), builtApk, path.join(android, 'app/src/main/assets')]);
    await mkdir(output, { recursive: true });
    const apk = path.join(output, 'MasterSelects-debug.apk');
    await copyFile(builtApk, apk);
    const versions = (await readdir(path.join(sdk, 'build-tools'))).filter(version => /^\d+\.\d+\.\d+$/.test(version))
      .toSorted((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    if (!versions.length) throw new Error('Install Android SDK build tools.');
    const signer = path.join(sdk, 'build-tools', versions[0], windows ? 'apksigner.bat' : 'apksigner');
    const verification = await run(signer, ['verify', '--print-certs', apk], { capture: true });
    const fingerprint = /certificate SHA-256 digest:\s*([a-f\d]{64})/i.exec(verification)?.[1];
    if (!fingerprint) throw new Error('Could not read the verified APK signing certificate.');
    await writeLinks('com.masterselects.app.debug', [fingerprint], 'assetlinks.debug.json');
    console.log(`Verified installable test APK: ${apk}`);
    return;
  }
  if (command === 'bundle') {
    if (!['MS_ANDROID_KEYSTORE', 'MS_ANDROID_STORE_PASSWORD', 'MS_ANDROID_KEY_ALIAS', 'MS_ANDROID_KEY_PASSWORD'].every(name => process.env[name])) {
      throw new Error('Release signing is not configured. Set the four MS_ANDROID signing variables described in the Android guide. Debug APKs use the build command.');
    }
    const versionCode = option('version-code');
    if (!versionCode || !/^[1-9]\d{0,8}$/.test(versionCode)) throw new Error('Pass --version-code with an increasing positive Android release number.');
    await prepareEditor(root);
    await gradle([':app:lintRelease', ':app:bundleRelease', `-PandroidVersionCode=${versionCode}`]);
    const builtBundle = path.join(android, 'app/build/outputs/bundle/release/app-release.aab');
    await run('java', [path.join(root, 'scripts/android/VerifyBundle.java'), builtBundle, path.join(android, 'app/src/main/assets'), 'base/assets/']);
    await mkdir(output, { recursive: true });
    await copyFile(builtBundle, path.join(output, 'MasterSelects-release.aab'));
    console.log('Prepared signed output/android/MasterSelects-release.aab. Nothing was published.');
    return;
  }
  if (command === 'prepare') { await prepareEditor(root); return; }
  if (command === 'assetlinks') {
    await writeLinks(option('package') || 'com.masterselects.app', (option('fingerprint') || '').split(',').filter(Boolean), 'assetlinks.json');
    return;
  }
  if (command === 'verify-links') {
    const expected = JSON.parse(await readFile(path.join(output, options.includes('--debug') ? 'assetlinks.debug.json' : 'assetlinks.json'), 'utf8'));
    const response = await fetch(`${ANDROID_ORIGIN}/.well-known/assetlinks.json`, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      throw new Error(`Website verification is not ready (HTTP ${response.status}; expected application/json).`);
    }
    if (!hasAssetLink(await response.json(), expected)) throw new Error('The website does not authorize this package/signing certificate yet.');
    console.log('Website authorizes the expected Android package and signing certificate.');
    return;
  }
  if (command === 'install') {
    requireSdk();
    const apk = path.join(output, 'MasterSelects-debug.apk');
    if (!existsSync(apk)) throw new Error('Build the test APK first.');
    const serial = option('serial');
    if (!serial) throw new Error('Pass --serial DEVICE_ID from adb devices to select the intended device explicitly.');
    await run(path.join(sdk, 'platform-tools', windows ? 'adb.exe' : 'adb'), ['-s', serial, 'install', '-r', apk]);
    return;
  }
  throw new Error('Commands: doctor, prepare, build, bundle, assetlinks, verify-links, install. See docs/Features/Android-App.md.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
