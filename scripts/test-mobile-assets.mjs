import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const assetsRoot = dirname(require.resolve('@capacitor/assets/package.json'));
const sharp = createRequire(join(assetsRoot, 'package.json'))('sharp');
const fixture = mkdtempSync(join(tmpdir(), 'raptor-mobile-assets-'));
try {
  for (const dir of ['resources', 'ios', 'android']) {
    cpSync(join(root, dir), join(fixture, dir), {
      recursive: true,
      filter: (path) => !/(?:^|\/)(?:build|Pods|\.gradle|\.build|\.git)(?:\/|$)/.test(path)
        && !/\.(?:jks|keystore)$/.test(path) && !path.endsWith('keystore.properties'),
    });
  }
  const iosIcons = join(fixture, 'ios/App/App/Assets.xcassets/AppIcon.appiconset');
  const androidIcon = join(fixture, 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png');
  for (const name of readdirSync(iosIcons)) {
    if (name.endsWith('.png')) rmSync(join(iosIcons, name));
  }
  rmSync(androidIcon, { force: true });
  execFileSync(process.execPath, [join(assetsRoot, 'bin/capacitor-assets'), 'generate',
    '--ios', '--android', '--iconBackgroundColor', '#50b4cd', '--splashBackgroundColor', '#50b4cd'], {
    cwd: fixture, timeout: 180_000, stdio: 'pipe',
    env: { ...process.env, UV_THREADPOOL_SIZE: '1', VIPS_CONCURRENCY: '1' },
  });
  assert.ok(existsSync(androidIcon), 'Android icon must be regenerated');
  const android = await sharp(androidIcon).metadata();
  assert.equal(android.width, 192);
  assert.equal(android.height, 192);
  const icons = readdirSync(iosIcons).filter((name) => name.endsWith('.png'));
  assert.ok(icons.length > 0, 'iOS icons must be regenerated');
  const dimensions = await Promise.all(icons.map((name) => sharp(join(iosIcons, name)).metadata()));
  assert.ok(dimensions.some(({ width, height }) => width === 1024 && height === 1024));
  console.log(`Native asset generation passed: Android 192px icon and ${icons.length} iOS icons.`);
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
