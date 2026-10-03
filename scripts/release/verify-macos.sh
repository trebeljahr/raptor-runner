#!/usr/bin/env bash
set -euo pipefail
release_dir="${RELEASE_DIR:-release}"
scratch="$(mktemp -d)"
mounted=""
cleanup() {
  if [[ -n "$mounted" ]]; then hdiutil detach "$mounted" -quiet; fi
  rm -rf "$scratch"
}
trap cleanup EXIT
verify_app() {
  local app="$1"
  codesign --verify --deep --strict --verbose=2 "$app"
  codesign -dv --verbose=4 "$app" 2>&1 | grep -Fx 'TeamIdentifier=4BHY8H2J25'
  spctl --assess --type execute --verbose=2 "$app" 2>&1 | grep -F 'source=Notarized Developer ID'
  xcrun stapler validate "$app"
}
shopt -s nullglob
dmgs=("$release_dir"/*.dmg)
zips=("$release_dir"/*.zip)
[[ ${#dmgs[@]} -gt 0 && ${#dmgs[@]} -eq ${#zips[@]} ]] || { echo 'Expected a DMG and ZIP per architecture.' >&2; exit 1; }
for dmg in "${dmgs[@]}"; do
  mounted="$scratch/mount"
  mkdir -p "$mounted"
  hdiutil attach "$dmg" -nobrowse -quiet -mountpoint "$mounted"
  apps=("$mounted"/*.app)
  [[ ${#apps[@]} -eq 1 ]] || { echo 'Expected one app in DMG.' >&2; exit 1; }
  verify_app "${apps[0]}"
  hdiutil detach "$mounted" -quiet
  rmdir "$mounted"
  mounted=""
done
for zip in "${zips[@]}"; do
  unpacked="$(mktemp -d "$scratch/zip.XXXXXX")"
  ditto -x -k "$zip" "$unpacked"
  apps=("$unpacked"/*.app)
  [[ ${#apps[@]} -eq 1 ]] || { echo 'Expected one app in ZIP.' >&2; exit 1; }
  verify_app "${apps[0]}"
done
apps=("$release_dir"/mac*/*.app)
[[ ${#apps[@]} -eq ${#dmgs[@]} ]] || { echo 'Missing unpacked app.' >&2; exit 1; }
for app in "${apps[@]}"; do verify_app "$app"; done
