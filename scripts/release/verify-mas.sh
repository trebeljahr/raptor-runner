#!/usr/bin/env bash
# Checks a Mac App Store build from build-mas.sh. With MAS_UNSIGNED=1 it
# checks only the bundle; otherwise also the signature, sandbox, profile and pkg.
set -euo pipefail
release_dir="${RELEASE_DIR:-release/mas}"
shopt -s nullglob
apps=("$release_dir"/mas-universal/*.app)
[[ ${#apps[@]} -eq 1 ]] || { echo 'Expected one universal MAS app.' >&2; exit 1; }
app="${apps[0]}"
plist="$app/Contents/Info.plist"
value() { plutil -extract "$1" raw -o - "$plist"; }
fail() { echo "$*" >&2; exit 1; }

[[ "$(value CFBundleIdentifier)" = com.ricoslabs.raptorrunner ]] || fail 'Wrong bundle id.'
[[ "$(value CFBundleShortVersionString)" = "$(node -p "require('./package.json').version")" ]] ||
  fail 'Marketing version differs from package.json.'
if [[ -n "${RELEASE_BUILD_NUMBER:-}" ]]; then
  [[ "$(value CFBundleVersion)" = "$RELEASE_BUILD_NUMBER" ]] || fail 'Build number differs from RELEASE_BUILD_NUMBER.'
fi
[[ "$(value ITSAppUsesNonExemptEncryption)" = false ]] || fail 'Missing ITSAppUsesNonExemptEncryption=false.'
[[ "$(value ElectronTeamID)" = 4BHY8H2J25 ]] || fail 'Missing ElectronTeamID.'
[[ "$(value LSApplicationCategoryType)" = public.app-category.arcade-games ]] || fail 'Missing category.'
[[ "$(value CFBundleIconName)" = Icon ]] || fail 'Missing CFBundleIconName.'
[[ -f "$app/Contents/Resources/Assets.car" ]] || fail 'Missing Assets.car.'
xcrun assetutil --info "$app/Contents/Resources/Assets.car" | grep -q '"PixelWidth" : 1024' ||
  fail 'Assets.car has no 1024 px app icon.'
archs="$(lipo -archs "$app/Contents/MacOS/Raptor Runner")"
[[ "$archs" == *x86_64* && "$archs" == *arm64* ]] || fail "Not universal: $archs"
if find "$app" -iname '*steam*' | grep -q .; then fail 'Steam SDK files in the store build.'; fi

if [[ "${MAS_UNSIGNED:-}" = 1 ]]; then
  echo "Unsigned MAS bundle OK: $app"
  exit 0
fi

codesign --verify --deep --strict --verbose=2 "$app"
codesign -dv --verbose=4 "$app" 2>&1 | grep -Fx 'TeamIdentifier=4BHY8H2J25'
codesign -dv --verbose=4 "$app" 2>&1 | grep -E 'Authority=(Apple Distribution|3rd Party Mac Developer Application):'
entitlements="$(codesign -d --entitlements - --xml "$app" 2>/dev/null)"
grep -q 'com.apple.security.app-sandbox' <<<"$entitlements" || fail 'App is not sandboxed.'
grep -q '4BHY8H2J25.com.ricoslabs.raptorrunner' <<<"$entitlements" || fail 'Missing application identifier or group.'
[[ -f "$app/Contents/embedded.provisionprofile" ]] || fail 'Missing embedded.provisionprofile.'
pkgs=("$release_dir"/*.pkg)
[[ ${#pkgs[@]} -eq 1 ]] || fail 'Expected one pkg.'
pkgutil --check-signature "${pkgs[0]}" | grep -E '(3rd Party Mac Developer Installer|Mac Installer Distribution): Ricos Labs LLC'
echo "Signed MAS package OK: ${pkgs[0]}"
