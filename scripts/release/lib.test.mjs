import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildNumber, desktopTargets, repository, requireCredentials, requireDesktopSet, requireMain, sha256, validateManifest, validateRun, version } from './lib.mjs';

const run = {
  id: 123, head_repository: { full_name: repository }, event: 'workflow_dispatch',
  head_branch: 'main', path: '.github/workflows/build-desktop.yml', conclusion: 'success', head_sha: 'a'.repeat(40),
};
test('release signing accepts only the canonical main dispatch, including no tag or fork trust', () => {
  const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: repository };
  assert.doesNotThrow(() => requireMain(env));
  for (const mutation of [
    { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/tags/v1.2.3' },
    { GITHUB_REF: 'refs/heads/windows-signing' }, { GITHUB_REPOSITORY: 'another/raptor-runner' },
  ]) assert.throws(() => requireMain({ ...env, ...mutation }));
});
test('a green unrelated workflow, fork, PR, failed run or mismatched run cannot be published', () => {
  validateRun(run, 'build-desktop.yml', '123');
  for (const mutation of [
    { head_repository: { full_name: 'fork/raptor-runner' } }, { event: 'pull_request' },
    { head_branch: 'feature' }, { path: '.github/workflows/deploy.yml' }, { conclusion: 'failure' }, { id: 456 },
  ]) assert.throws(() => validateRun({ ...run, ...mutation }, 'build-desktop.yml', '123'));
});
test('partial signing sets fail with names only', () => {
  assert.throws(() => requireCredentials('macos', { MAC_CSC_LINK: 'sensitive-certificate' }), (error) =>
    error.message.includes('MAC_CSC_KEY_PASSWORD') && !error.message.includes('sensitive-certificate'));
  assert.throws(() => requireCredentials('android', {}));
  assert.doesNotThrow(() => requireCredentials('linux', {}));
});
test('mobile versions and build numbers cannot silently reset or accept unsafe input', () => {
  assert.equal(version('1.2.3'), '1.2.3');
  assert.equal(buildNumber('501'), '501');
  for (const invalid of ['', '0', '-1', '1.1', '1e3', '01', '2100000001', '12\nBAD=value']) {
    assert.throws(() => buildNumber(invalid));
  }
  for (const invalid of ['1.2', '1.2.3-rc.1', 'v1.2.3', '01.2.3']) assert.throws(() => version(invalid));
});
test('all architectures and one version are required, including both Mac downloads', () => {
  const manifests = desktopTargets.map((target) => ({ ...target, version: '1.2.3' }));
  requireDesktopSet(manifests);
  assert.throws(() => requireDesktopSet(manifests.slice(1)));
  assert.throws(() => requireDesktopSet([...manifests, manifests[0]]));
  assert.throws(() => requireDesktopSet(manifests.map((m, i) => ({ ...m, version: i === 0 ? '1.2.4' : m.version }))));
});
test('artifact integrity rejects modified, unsigned, wrong-commit and unsafe payloads', () => {
  const directory = mkdtempSync(join(tmpdir(), 'raptor-release-test-'));
  try {
    const path = join(directory, 'game.exe');
    writeFileSync(path, 'signed binary stand-in');
    const manifest = {
      schema: 1, repository, commit: run.head_sha, runId: '123', mode: 'signed', version: '1.2.3',
      platform: 'windows', arch: 'x64', files: [{ name: 'game.exe', sha256: sha256(path) }],
    };
    validateManifest(manifest, run, directory);
    assert.throws(() => validateManifest({ ...manifest, mode: 'smoke' }, run, directory));
    assert.throws(() => validateManifest({ ...manifest, commit: 'b'.repeat(40) }, run, directory));
    assert.throws(() => validateManifest({ ...manifest, files: [...manifest.files, ...manifest.files] }, run, directory));
    for (const name of ['../game.exe', '..\\game.exe', 'game.exe\ninjected', '-option.exe']) {
      assert.throws(() => validateManifest({ ...manifest, files: [{ ...manifest.files[0], name }] }, run, directory));
    }
    symlinkSync(path, join(directory, 'link.exe'));
    assert.throws(() => validateManifest({ ...manifest, files: [{ ...manifest.files[0], name: 'link.exe' }] }, run, directory));
    writeFileSync(path, 'tampered binary');
    assert.throws(() => validateManifest(manifest, run, directory), /checksum mismatch/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
