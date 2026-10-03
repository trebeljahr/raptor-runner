import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { repository, requireCredentials, requireDesktopSet } from './lib.mjs';

const [destination] = process.argv.slice(2);
const { run, manifests } = JSON.parse(readFileSync('artifacts/verified.json'));
requireDesktopSet(manifests);
const execute = (command, args, capture = false) => execFileSync(command, args, {
  encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
});
const one = (manifest, suffix) => {
  const files = manifest.files.filter((file) => file.name.endsWith(suffix));
  if (files.length !== 1) throw new Error('Expected one ' + suffix + ' for ' + manifest.platform);
  return join(manifest.directory, files[0].name);
};
if (destination === 'itch') {
  requireCredentials('itch', process.env);
  const project = process.env.ITCH_USER + '/' + process.env.ITCH_GAME;
  if (!/^[a-z0-9_-]+\/[a-z0-9_-]+$/.test(project)) throw new Error('Invalid itch project.');
  for (const manifest of manifests) {
    const base = [process.env.BUTLER_PATH || 'butler'];
    const push = (file, channel) => execute(base[0], ['push', file, project + ':' + channel, '--userversion', manifest.version]);
    if (manifest.platform === 'macos') {
      push(one(manifest, '.zip'), 'osx-' + manifest.arch);
      push(one(manifest, '.dmg'), 'osx-dmg-' + manifest.arch);
    } else if (manifest.platform === 'windows') {
      const files = manifest.files.filter((file) => file.name.endsWith('.exe'));
      if (files.length !== 2) throw new Error('Expected installer and portable EXE.');
      for (const file of files) push(join(manifest.directory, file.name), file.name.includes('Setup') ? 'windows-setup' : 'windows');
    } else {
      push(one(manifest, '.AppImage'), 'linux');
    }
  }
} else if (destination === 'downloads-draft') {
  const tag = 'v' + manifests[0].version;
  // The tag must already identify these exact tested bytes. Never retag or clobber a release.
  execute('git', ['fetch', '--no-tags', 'origin', 'refs/tags/' + tag]);
  const tagged = execute('git', ['rev-parse', 'FETCH_HEAD^{commit}'], true).trim();
  if (tagged !== run.head_sha) throw new Error('Tag ' + tag + ' does not point to the build commit.');
  const files = [];
  const checksums = [];
  for (const manifest of manifests) {
    files.push(manifest.manifest);
    for (const file of manifest.files) {
      if (file.name.endsWith('-depot.tar.gz')) continue;
      files.push(join(manifest.directory, file.name));
      checksums.push(file.sha256 + '  ' + file.name);
    }
  }
  const sumFile = 'artifacts/SHA256SUMS.txt';
  writeFileSync(sumFile, checksums.sort().join('\n') + '\n');
  const notes = 'artifacts/release-notes.txt';
  writeFileSync(notes, 'Raptor Runner ' + manifests[0].version + '\n\nBuild commit: ' + run.head_sha +
    '\nBuild run: https://github.com/' + repository + '/actions/runs/' + run.id +
    '\n\nmacOS downloads are signed and notarized. Windows downloads are signed by Ricos Labs LLC.' +
    '\nLinux files have signed GitHub build provenance. SHA256SUMS.txt lists download checksums.\n');
  execute('gh', ['release', 'create', tag, ...files, sumFile, '--repo', repository, '--verify-tag', '--draft',
    '--title', 'Raptor Runner ' + manifests[0].version, '--notes-file', notes]);
} else if (destination === 'steam') {
  requireCredentials('steam', process.env);
  const root = resolve('artifacts/steam');
  for (const manifest of manifests) {
    const sub = manifest.platform === 'macos' ? 'macos/' + manifest.arch : manifest.platform;
    const directory = join(root, sub);
    mkdirSync(directory, { recursive: true });
    execute('tar', ['-xzf', one(manifest, '-depot.tar.gz'), '-C', directory]);
  }
  cpSync('scripts/release/steam-macos.sh', join(root, 'macos', 'raptor-runner.sh'));
  execute('chmod', ['+x', join(root, 'macos', 'raptor-runner.sh')]);
  const ids = ['WINDOWS', 'LINUX', 'MACOS'].map((os) => process.env['STEAM_DEPOT_' + os]);
  if (ids.some((id) => !/^[1-9]\d*$/.test(id)) || new Set(ids).size !== ids.length) throw new Error('Set three distinct Steam depot IDs.');
  const branch = process.env.STEAM_BRANCH || '';
  if (branch && (!/^[a-zA-Z0-9_-]+$/.test(branch) || branch === 'default')) throw new Error('Choose a Steam beta branch or leave empty for upload only.');
  const quote = (value) => JSON.stringify(String(value));
  const depots = ids.map((id, i) => quote(id) + ' { "ContentRoot" ' + quote(join(root, ['windows', 'linux', 'macos'][i])) +
    ' "FileMapping" { "LocalPath" "*" "DepotPath" "." "recursive" "1" } "FileExclusion" "steam_appid.txt" }').join('\n');
  const vdf = '"appbuild" { "AppID" "5035590" "Desc" ' + quote('Raptor Runner ' + manifests[0].version + ' ' + run.head_sha) +
    ' "BuildOutput" ' + quote(join(process.env.RUNNER_TEMP, 'steam-build-output')) +
    (branch ? ' "SetLive" ' + quote(branch) : '') + ' "Depots" { ' + depots + ' } }\n';
  writeFileSync('artifacts/steam-build.vdf', vdf);
} else {
  throw new Error('Choose itch, downloads-draft, or steam.');
}
