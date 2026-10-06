import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const script = fileURLToPath(new URL('./steam-macos.sh', import.meta.url));
const appleSilicon = process.platform === 'darwin' &&
  execFileSync('sysctl', ['-n', 'hw.optional.arm64'], { encoding: 'utf8' }).trim() === '1';

function depot() {
  const root = mkdtempSync(join(tmpdir(), 'raptor-steam-mac-'));
  copyFileSync(script, join(root, 'raptor-runner.sh'));
  for (const arch of ['arm64', 'x64']) {
    const dir = join(root, arch, 'Raptor Runner.app', 'Contents', 'MacOS');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'Raptor Runner'), '#!/bin/sh\necho ' + arch + ' "$@"\n', { mode: 0o755 });
  }
  return root;
}

test('Steam launcher picks the native app on Apple Silicon even under Rosetta', { skip: !appleSilicon }, () => {
  const root = depot();
  try {
    // Steam may start the launcher translated; uname -m then says x86_64.
    const out = execFileSync('arch', ['-x86_64', '/bin/bash', join(root, 'raptor-runner.sh'), '--flag'], { encoding: 'utf8' });
    assert.equal(out.trim(), 'arm64 --flag');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
