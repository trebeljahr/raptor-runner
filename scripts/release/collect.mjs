import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildNumber, repository, sha256, version } from './lib.mjs';

const [platform, arch, mode] = process.argv.slice(2);
if (!['signed', 'smoke'].includes(mode)) throw new Error('Missing release mode.');
const appVersion = version(JSON.parse(readFileSync('package.json')).version);
const output = 'release/upload';
// This directory contains only generated release staging files.
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const copy = (path, name) => cpSync(path, join(output, name));
let paths;
if (['macos', 'windows', 'linux'].includes(platform)) {
  const extensions = { macos: ['.dmg', '.zip'], windows: ['.exe'], linux: ['.AppImage'] }[platform];
  paths = readdirSync('release').filter((name) => extensions.some((ext) => name.endsWith(ext)));
  const expected = platform === 'linux' ? 1 : 2;
  if (paths.length !== expected) throw new Error('Expected ' + expected + ' packaged files; found ' + paths.length);
  paths.forEach((name) => copy(join('release', name), name));
  // Tar preserves executable bits and app symlinks through Actions artifact storage.
  const unpacked = platform === 'windows' ? 'win-unpacked' : platform === 'linux' ? 'linux-unpacked' :
    arch === 'arm64' ? 'mac-arm64' : 'mac';
  const archive = join(output, 'Raptor-Runner-' + appVersion + '-' + platform + '-' + arch + '-depot.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', join('release', unpacked), '.'], { stdio: 'inherit' });
  if (platform === 'windows' && mode === 'signed') copy('release/signing-evidence.json', 'windows-signing-evidence.json');
} else if (platform === 'android') {
  buildNumber(process.env.RELEASE_BUILD_NUMBER);
  const prefix = 'Raptor-Runner-' + appVersion + '-android-' + process.env.RELEASE_BUILD_NUMBER;
  copy('android/app/build/outputs/bundle/release/app-release.aab', prefix + '.aab');
  copy('android/app/build/outputs/apk/release/app-release.apk', prefix + '.apk');
  copy('android/app/build/outputs/mapping/release/mapping.txt', prefix + '-mapping.txt');
} else if (platform === 'ios') {
  buildNumber(process.env.RELEASE_BUILD_NUMBER);
  const ipas = readdirSync('ios/App/build/ipa').filter((name) => name.endsWith('.ipa'));
  if (ipas.length !== 1) throw new Error('Expected exactly one exported IPA.');
  copy(join('ios/App/build/ipa', ipas[0]), 'Raptor-Runner-' + appVersion + '-ios-' + process.env.RELEASE_BUILD_NUMBER + '.ipa');
  execFileSync('tar', ['-czf', join(output, 'Raptor-Runner-' + appVersion + '-ios-' + process.env.RELEASE_BUILD_NUMBER + '-symbols.tar.gz'),
    '-C', 'ios/App/build/App.xcarchive', 'dSYMs'], { stdio: 'inherit' });
} else {
  throw new Error('Unknown platform.');
}
const files = readdirSync(output).sort().map((name) => ({ name, sha256: sha256(join(output, name)) }));
const manifest = {
  schema: 1, repository, commit: process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  runId: process.env.GITHUB_RUN_ID || 'local', version: appVersion, buildNumber: process.env.RELEASE_BUILD_NUMBER || null,
  platform, arch, mode,
  signature: mode === 'smoke' ? 'unsigned' : platform === 'linux' ? 'github-provenance' :
    platform === 'macos' ? 'developer-id-notarized' : platform === 'windows' ? 'authenticode' : 'store-distribution',
  files,
};
writeFileSync(join(output, 'manifest-' + platform + '-' + arch + '.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(output, 'SHA256SUMS-' + platform + '-' + arch + '.txt'), files.map((f) => f.sha256 + '  ' + f.name).join('\n') + '\n');
