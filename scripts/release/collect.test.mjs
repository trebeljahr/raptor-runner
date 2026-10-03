import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./collect.mjs', import.meta.url));
test('Linux collection preserves executables in depot archives and never includes stale staging files', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'raptor-collect-'));
  try {
    mkdirSync(join(fixture, 'release/linux-unpacked'), { recursive: true });
    writeFileSync(join(fixture, 'package.json'), '{"version":"1.2.3"}');
    writeFileSync(join(fixture, 'release/game.AppImage'), 'test image');
    writeFileSync(join(fixture, 'release/linux-unpacked/raptor-runner'), 'test executable');
    chmodSync(join(fixture, 'release/linux-unpacked/raptor-runner'), 0o755);
    const run = () => execFileSync(process.execPath, [script, 'linux', 'x64', 'smoke'], {
      cwd: fixture, env: { ...process.env, GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123' }, stdio: 'pipe',
    });
    run();
    writeFileSync(join(fixture, 'release/upload/stale-secret.txt'), 'must not be uploaded');
    run();
    const output = join(fixture, 'release/upload');
    assert.equal(readdirSync(output).includes('stale-secret.txt'), false);
    const manifest = JSON.parse(readFileSync(join(output, 'manifest-linux-x64.json')));
    assert.equal(manifest.mode, 'smoke');
    assert.equal(manifest.signature, 'unsigned');
    assert.equal(manifest.files.length, 2);
    const listing = execFileSync('tar', ['-tvzf', join(output, 'Raptor-Runner-1.2.3-linux-x64-depot.tar.gz')], { encoding: 'utf8' });
    assert.match(listing, /-rwxr-xr-x.*raptor-runner/);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
