import { appendFileSync, readFileSync } from 'node:fs';
import { buildNumber, desktopTargets, requireCredentials, requireMain, version } from './lib.mjs';

const [command, target] = process.argv.slice(2);
const env = process.env;
const output = (key, value) => {
  console.log(key + '=' + value);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, key + '=' + value + '\n');
};
if (command === 'desktop') {
  const mode = env.GITHUB_EVENT_NAME === 'pull_request' ? 'smoke' : env.RELEASE_MODE;
  if (!['signed', 'smoke'].includes(mode)) throw new Error('Choose signed or smoke mode.');
  if (mode === 'signed') requireMain(env);
  const platform = env.RELEASE_PLATFORM || 'all';
  if (!['all', 'macos', 'windows', 'linux'].includes(platform)) throw new Error('Unknown desktop platform.');
  output('mode', mode);
  output('matrix', JSON.stringify({ include: desktopTargets.filter((t) => platform === 'all' || t.platform === platform) }));
  output('version', version(JSON.parse(readFileSync('package.json')).version));
} else if (command === 'credentials') {
  requireCredentials(target, env);
  console.log('Required ' + target + ' configuration is present (values not printed).');
} else if (command === 'mobile') {
  requireMain(env);
  if (!['all', 'android', 'ios'].includes(env.RELEASE_PLATFORM)) throw new Error('Unknown mobile platform.');
  if (!['signed', 'smoke'].includes(env.RELEASE_MODE)) throw new Error('Choose signed or smoke mode.');
  output('mode', env.RELEASE_MODE);
  output('version', version(JSON.parse(readFileSync('package.json')).version));
  output('build_number', buildNumber(env.RELEASE_MODE === 'smoke' ? '1' : env.RELEASE_BUILD_NUMBER));
} else {
  throw new Error('Usage: plan.mjs desktop | mobile | credentials TARGET');
}
