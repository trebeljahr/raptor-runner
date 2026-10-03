#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob
ipas=(ios/App/build/ipa/*.ipa)
[[ ${#ipas[@]} -eq 1 ]] || { echo 'Expected exactly one IPA.' >&2; exit 1; }
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
ditto -x -k "${ipas[0]}" "$scratch"
apps=("$scratch"/Payload/*.app)
[[ ${#apps[@]} -eq 1 ]] || { echo 'Expected exactly one exported app.' >&2; exit 1; }
app="${apps[0]}"
codesign --verify --deep --strict "$app"
codesign -dv --verbose=4 "$app" 2>&1 | grep -Fx 'TeamIdentifier=4BHY8H2J25'
codesign -dv --verbose=4 "$app" 2>&1 | grep -F 'Authority=Apple Distribution:'
[[ "$(plutil -extract CFBundleIdentifier raw -o - "$app/Info.plist")" = com.ricoslabs.raptorrunner ]]
[[ "$(plutil -extract CFBundleVersion raw -o - "$app/Info.plist")" = "$RELEASE_BUILD_NUMBER" ]]
[[ "$(plutil -extract CFBundleShortVersionString raw -o - "$app/Info.plist")" = "$(node -p "require('./package.json').version")" ]]
plutil -lint "$app/PrivacyInfo.xcprivacy"
security cms -D -i "$app/embedded.mobileprovision" > "$scratch/profile.plist"
python3 scripts/release/ios-profile.py "$scratch/profile.plist"
