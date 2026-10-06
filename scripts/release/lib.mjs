import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { basename, join } from 'node:path';

export const repository = 'trebeljahr/raptor-runner';
export const bundleId = 'com.ricoslabs.raptorrunner';
export const teamId = '4BHY8H2J25';
export const desktopTargets = [
  { platform: 'macos', arch: 'arm64', runner: 'macos-15', flag: 'mac' },
  { platform: 'macos', arch: 'x64', runner: 'macos-15', flag: 'mac' },
  { platform: 'windows', arch: 'x64', runner: 'windows-2025', flag: 'win' },
  { platform: 'linux', arch: 'x64', runner: 'ubuntu-24.04', flag: 'linux' },
];
export const credentials = {
  macos: ['MAC_CSC_LINK', 'MAC_CSC_KEY_PASSWORD', 'APPLE_API_KEY_BASE64', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER_ID'],
  windows: ['AZURE_CLIENT_ID'],
  linux: [],
  android: ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'],
  ios: ['APPLE_CERTIFICATE_BASE64', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_PROVISIONING_PROFILE_BASE64'],
  itch: ['BUTLER_API_KEY', 'ITCH_USER', 'ITCH_GAME'],
  steam: ['STEAM_USERNAME', 'STEAM_CONFIG_VDF', 'STEAM_DEPOT_WINDOWS', 'STEAM_DEPOT_LINUX', 'STEAM_DEPOT_MACOS'],
  play: ['PLAY_SERVICE_ACCOUNT_JSON'],
  testflight: ['APPLE_API_KEY_BASE64', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER_ID'],
};

export function requireCredentials(target, env) {
  if (!Object.hasOwn(credentials, target)) throw new Error('Unknown credential target: ' + target);
  const missing = credentials[target].filter((name) => !env[name]?.trim());
  if (missing.length) throw new Error('Missing ' + target + ' configuration: ' + missing.join(', '));
}

export function version(value) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error('Release version must be a stable X.Y.Z value: ' + value);
  }
  return value;
}

export function buildNumber(value) {
  // One explicit number for both stores. It must exceed their existing builds.
  if (!/^[1-9]\d*$/.test(String(value)) || Number(value) > 2100000000) {
    throw new Error('Set RELEASE_BUILD_NUMBER to an integer from 1 to 2100000000, above both stores’ current build numbers.');
  }
  return String(value);
}

export function requireMain(env) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main' ||
      env.GITHUB_REPOSITORY !== repository) {
    throw new Error('Release signing and publishing must be dispatched from main in ' + repository);
  }
}

export function validateRun(run, workflow, runId) {
  if (!/^[1-9]\d*$/.test(String(runId)) || String(run.id) !== String(runId) ||
      run.head_repository?.full_name !== repository || run.event !== 'workflow_dispatch' ||
      run.head_branch !== 'main' || run.path !== '.github/workflows/' + workflow ||
      run.conclusion !== 'success' || !/^[a-f0-9]{40}$/.test(run.head_sha)) {
    throw new Error('Source must be a successful main-branch dispatch of ' + workflow + ' in ' + repository);
  }
}

export function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function validateManifest(manifest, run, directory) {
  if (manifest.schema !== 1 || manifest.repository !== repository || manifest.commit !== run.head_sha ||
      manifest.runId !== String(run.id) || manifest.mode !== 'signed') {
    throw new Error('Artifact metadata does not match the signed source run.');
  }
  version(manifest.version);
  const target = manifest.platform + '-' + manifest.arch;
  const allowed = [...desktopTargets.map((t) => t.platform + '-' + t.arch), 'android-universal', 'ios-arm64'];
  if (!allowed.includes(target)) throw new Error('Unknown artifact target: ' + target);
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Empty artifact manifest.');
  const seen = new Set();
  for (const file of manifest.files) {
    if (typeof file.name !== 'string' || basename(file.name) !== file.name ||
        file.name.includes('\\') || !/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(file.name) ||
        seen.has(file.name) || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error('Unsafe or duplicate artifact name/digest.');
    }
    seen.add(file.name);
    const path = join(directory, file.name);
    if (!lstatSync(path).isFile() || sha256(path) !== file.sha256) throw new Error('Artifact checksum mismatch: ' + file.name);
  }
  return target;
}

export function requireDesktopSet(manifests) {
  const targets = manifests.map((m) => m.platform + '-' + m.arch).sort();
  const expected = desktopTargets.map((t) => t.platform + '-' + t.arch).sort();
  if (JSON.stringify(targets) !== JSON.stringify(expected) || new Set(manifests.map((m) => m.version)).size !== 1) {
    throw new Error('Publishing desktop requires all four targets from one version and one successful run.');
  }
}

// Valve forbids automatic SetLive on default, so test uploads go to a beta branch.
// An empty input falls back to the repository's test branch; "none" uploads only.
export function steamBranch(input, fallback) {
  const branch = input?.trim() || fallback?.trim() || '';
  if (branch === 'none') return '';
  if (branch && (!/^[a-z0-9_-]{4,32}$/.test(branch) || branch === 'default' || branch === 'public')) {
    throw new Error('Choose a Steam beta branch (4-32 lowercase characters), or "none" to upload without setting a build live.');
  }
  return branch;
}
