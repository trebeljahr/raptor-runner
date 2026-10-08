#!/usr/bin/env bash
# Mac App Store package: a sandboxed universal app inside a signed installer
# pkg, for the App Store Connect record shared with iOS (app 6815029628).
#
#   MAS_UNSIGNED=1 bash scripts/release/build-mas.sh
#       Packaging check only. Produces the .app, no pkg, nothing to upload.
#
#   RELEASE_BUILD_NUMBER=N MAS_PROVISIONING_PROFILE=path/to/profile \
#     bash scripts/release/build-mas.sh [--upload]
#       Needs "Apple Distribution" and "3rd Party Mac Developer Installer"
#       (Mac Installer Distribution) identities for team 4BHY8H2J25 in the
#       login keychain and a Mac App Store profile for
#       com.ricoslabs.raptorrunner. --upload sends the pkg to App Store Connect
#       with an API key: APPLE_API_KEY_ID, APPLE_API_ISSUER_ID, and the key at
#       ~/.appstoreconnect/private_keys/AuthKey_<id>.p8.
set -euo pipefail
cd "$(dirname "$0")/../.."

upload=0
for arg in "$@"; do
  case "$arg" in
    --upload) upload=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

out=release/mas
args=(--mac --publish never --config electron-builder.mas.cjs "-c.directories.output=$out")
if [[ "${MAS_UNSIGNED:-}" = 1 ]]; then
  [[ $upload = 0 ]] || { echo 'An unsigned build cannot be uploaded.' >&2; exit 2; }
else
  : "${RELEASE_BUILD_NUMBER:?Set a build number above every earlier macOS upload.}"
  : "${MAS_PROVISIONING_PROFILE:?Set the path to the Mac App Store provisioning profile.}"
  [[ -f "$MAS_PROVISIONING_PROFILE" ]] || { echo "No profile at $MAS_PROVISIONING_PROFILE" >&2; exit 1; }
  security find-identity -v | grep -Fq 'Apple Distribution: Ricos Labs LLC (4BHY8H2J25)' ||
    { echo 'Missing identity: Apple Distribution: Ricos Labs LLC (4BHY8H2J25)' >&2; exit 1; }
  security find-identity -v | grep -Eq '(3rd Party Mac Developer Installer|Mac Installer Distribution): Ricos Labs LLC \(4BHY8H2J25\)' ||
    { echo 'Missing identity: 3rd Party Mac Developer Installer: Ricos Labs LLC (4BHY8H2J25)' >&2; exit 1; }
  if [[ $upload = 1 ]]; then
    : "${APPLE_API_KEY_ID:?Set APPLE_API_KEY_ID for the upload.}"
    : "${APPLE_API_ISSUER_ID:?Set APPLE_API_ISSUER_ID for the upload.}"
  fi
  args+=("-c.buildVersion=$RELEASE_BUILD_NUMBER" "-c.forceCodeSigning=true")
fi

# A stale app or pkg from an earlier run would satisfy the checks below.
if [[ -d "$out" ]]; then find "$out" -mindepth 1 -delete; fi
pnpm run build:desktop
pnpm run electron:compile
npx --no-install electron-builder "${args[@]}"
RELEASE_DIR="$out" bash scripts/release/verify-mas.sh

if [[ $upload = 1 ]]; then
  pkgs=("$out"/*.pkg)
  xcrun altool --validate-app --file "${pkgs[0]}" --type macos \
    --apiKey "$APPLE_API_KEY_ID" --apiIssuer "$APPLE_API_ISSUER_ID"
  xcrun altool --upload-app --file "${pkgs[0]}" --type macos \
    --apiKey "$APPLE_API_KEY_ID" --apiIssuer "$APPLE_API_ISSUER_ID"
fi
