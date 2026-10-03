import { readFileSync, writeFileSync } from 'node:fs';
import { version, buildNumber } from './lib.mjs';

const value = version(JSON.parse(readFileSync('package.json')).version);
const file = 'ios/App/App.xcodeproj/project.pbxproj';
let project = readFileSync(file, 'utf8').replace(/MARKETING_VERSION = [^;]+;/g, 'MARKETING_VERSION = ' + value + ';');
if (process.env.RELEASE_BUILD_NUMBER) {
  project = project.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, 'CURRENT_PROJECT_VERSION = ' + buildNumber(process.env.RELEASE_BUILD_NUMBER) + ';');
}
writeFileSync(file, project);
console.log('Mobile version: ' + value + '; build: ' + (process.env.RELEASE_BUILD_NUMBER || 'development'));
