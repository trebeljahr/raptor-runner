#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/android-env.sh
: "${RELEASE_BUILD_NUMBER:?Set a build number above the highest version code already uploaded to Play.}"
unset CAP_DEV_URL
npm run mobile:version
npm run build:mobile
npx --no-install cap sync android
(
  cd android
  ./gradlew --no-daemon --max-workers=2 bundleRelease assembleRelease
)
bash scripts/release/verify-android.sh
