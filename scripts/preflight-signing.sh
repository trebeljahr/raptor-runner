#!/usr/bin/env bash
# preflight-signing.sh — check that the credentials the build config
# expects are actually reachable, before starting a build that takes
# fifteen minutes to tell you they weren't.
#
# This is the companion to verify-signing.sh. That one catches a bad
# artifact after the fact; this one refuses to start. Both exist because
# electron-builder treats missing signing credentials as a reason to skip
# signing, not as an error.
#
# Checks only — reads no secret values and prints none.
#
# Usage:
#   npm run preflight:signing            # check the current platform
#   PLATFORM=win npm run preflight:signing

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLATFORM="${PLATFORM:-$(uname -s)}"

problems=0
note() { echo "  $1"; }
bad() { echo "  MISSING  $1"; problems=$((problems + 1)); }

# The identity name electron-builder is configured to sign with. Read from
# package.json so this script stays correct if the config changes.
mac_identity="$(node -p "require('$REPO_ROOT/package.json').build?.mac?.identity ?? ''" 2>/dev/null)"

case "$PLATFORM" in
  Darwin | mac | darwin)
    echo "macOS signing preflight"

    if [[ -z "$mac_identity" ]]; then
      note "build.mac.identity unset — electron-builder will auto-select a certificate"
    else
      note "configured identity: $mac_identity"
    fi

    # For a non-MAS target electron-builder only ever considers
    # "Developer ID Application" certificates, so that is the one that has
    # to be present. An Apple Distribution cert does not substitute.
    if [[ -n "${CSC_LINK:-}" && -n "${CSC_KEY_PASSWORD:-}" ]]; then
      note "OK       certificate and password supplied through CSC_LINK/CSC_KEY_PASSWORD"
    elif security find-identity -v -p codesigning 2>/dev/null |
      grep -q "Developer ID Application"; then
      note "OK       Developer ID Application certificate in keychain"
    else
      bad "no Developer ID Application certificate — see docs/CODE_SIGNING.md"
    fi

    # Any one of electron-builder's three credential modes is enough.
    # Order here mirrors getNotarizeOptions() in macPackager.js.
    if [[ -n "${APPLE_API_KEY:-}" || -n "${APPLE_API_KEY_ID:-}" || -n "${APPLE_API_ISSUER:-}" ]]; then
      for v in APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER; do
        [[ -n "${!v:-}" ]] || bad "$v (App Store Connect API key mode is partially configured)"
      done
      [[ "$problems" -eq 0 ]] && note "OK       notarization via App Store Connect API key"
    elif [[ -n "${APPLE_ID:-}" || -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]]; then
      for v in APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; do
        [[ -n "${!v:-}" ]] || bad "$v (Apple ID mode is partially configured)"
      done
      [[ "$problems" -eq 0 ]] && note "OK       notarization via Apple ID + app-specific password"
    elif [[ -n "${APPLE_KEYCHAIN_PROFILE:-}" ]]; then
      note "OK       notarization via keychain profile '${APPLE_KEYCHAIN_PROFILE}'"
    else
      bad "no notarization credentials — set APPLE_KEYCHAIN_PROFILE, or the APPLE_API_* trio, or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID"
    fi
    ;;

  MINGW* | MSYS* | CYGWIN* | Windows_NT | win | windows)
    echo "Windows signing preflight"

    bad "Use the signed Windows GitHub build; this local wrapper has no Azure OIDC login."
    ;;

  Linux | linux)
    echo "Linux signing preflight"
    bad "Use the signed Linux GitHub build to generate verifiable provenance."
    ;;

  *)
    echo "unknown platform '$PLATFORM' — nothing checked" >&2
    exit 1
    ;;
esac

echo
if [[ "$problems" -gt 0 ]]; then
  echo "$problems problem(s) — build would produce unsigned or unnotarized artifacts" >&2
  exit 1
fi

echo "preflight passed"
