import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('./upload-steam.sh', import.meta.url));
const fakeSecret = 'fake-sensitive-session-do-not-log';
function runUpload(log, exitCode) {
  const root = mkdtempSync(join(tmpdir(), 'raptor-steam-test-'));
  try {
    const bin = join(root, 'bin');
    const runner = join(root, 'runner');
    mkdirSync(bin);
    mkdirSync(runner);
    const executable = (name, body) => writeFileSync(join(bin, name), '#!/usr/bin/env bash\n' + body, { mode: 0o700 });
    executable('curl', 'exit 0\n');
    executable('tar', 'cp "$FAKE_STEAMCMD" "$RUNNER_TEMP/raptor-steamcmd/steamcmd.sh"\nchmod 700 "$RUNNER_TEMP/raptor-steamcmd/steamcmd.sh"\n');
    executable('fixture-steamcmd', `
if [[ "$1" == '+quit' ]]; then
  mkdir -p "$RUNNER_TEMP/steam-data/logs"
  printf 'Logging directory: %s/steam-data/logs\\n' "$RUNNER_TEMP"
  exit 0
fi
if [[ ! -f "$RUNNER_TEMP/steam-data/config/config.vdf" ]]; then exit 95; fi
if ! grep -q '"fixture" "session"' "$RUNNER_TEMP/steam-data/config/config.vdf"; then exit 96; fi
printf '%s\\n' "$FAKE_STEAM_LOG"
exit "$FAKE_STEAM_EXIT"
`);
    const result = spawnSync('bash', [script], {
      cwd: root,
      encoding: 'utf8',
      timeout: 5000,
      env: {
        ...process.env,
        PATH: bin + ':' + process.env.PATH,
        RUNNER_TEMP: runner,
        STEAM_USERNAME: 'fixture-account',
        STEAM_CONFIG_VDF: Buffer.from('"fixture" "session"').toString('base64'),
        FAKE_STEAMCMD: join(bin, 'fixture-steamcmd'),
        FAKE_STEAM_LOG: log,
        FAKE_STEAM_EXIT: String(exitCode),
      },
    });
    assert.ifError(result.error);
    assert.equal(existsSync(join(runner, 'raptor-steamcmd')), false, 'session and logs must be removed');
    assert.equal(existsSync(join(runner, 'steam-data/config/config.vdf')), false, 'the discovered session file must also be removed');
    assert.equal((result.stdout + result.stderr).includes(fakeSecret), false, 'raw authentication output must stay private');
    return result;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('Steam login failure reports a fixed diagnosis and removes private files', () => {
  const result = runUpload('password: ' + fakeSecret + '\nERROR (Invalid Password)', 5);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exit code 5/);
  assert.match(result.stderr, /matching Steam Guard machine record/);
});

test('Steam exit zero without the requested app success still fails', () => {
  const result = runUpload('Successfully finished AppID 999 build (BuildID 123)\n' + fakeSecret, 0);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No successful upload was confirmed/);
});

test('Steam nonzero exit rejects an earlier success message', () => {
  const result = runUpload('Successfully finished AppID 5035590 build (BuildID 123)', 1);
  assert.equal(result.status, 1);
});

test('Steam success prints only the app and build confirmation', () => {
  const result = runUpload(fakeSecret + ' Successfully finished AppID 5035590 build (BuildID 123) ' + fakeSecret, 0);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'Successfully finished AppID 5035590 build (BuildID 123)');
});
