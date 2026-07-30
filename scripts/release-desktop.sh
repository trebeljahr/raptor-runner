#!/usr/bin/env bash
# release-desktop.sh — preflight, build, verify. One command, and it
# refuses to hand you an artifact it could not prove is signed.
#
# The three steps exist separately because each catches a different
# failure:
#
#   preflight  fails in a second if credentials are absent, instead of
#              letting a fifteen-minute build discover it
#   build      electron-builder itself
#   verify     fails if the finished artifact is not actually signed and
#              notarized, which is the only check that catches a wrong
#              certificate type
#
# Skipping straight to `electron-builder` is what produced a set of
# unsigned .dmg files that exited 0 and looked fine.
#
# Usage:
#   npm run release:desktop
#   APPLE_KEYCHAIN_PROFILE="Other Profile" npm run release:desktop
#   SKIP_PREFLIGHT=1 npm run release:desktop     # e.g. deliberate unsigned build

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# The notarytool keychain profile created by `xcrun notarytool
# store-credentials`. Overridable so other projects can reuse this script
# unchanged — see docs/CODE_SIGNING.md.
export APPLE_KEYCHAIN_PROFILE="${APPLE_KEYCHAIN_PROFILE:-Raptor Runner}"

if [[ "${SKIP_PREFLIGHT:-}" != "1" ]]; then
  echo "==> preflight"
  bash scripts/preflight-signing.sh
  echo
fi

echo "==> build"
# Notarization adds several minutes per architecture: the artifact is
# uploaded to Apple, scanned, and the resulting ticket stapled back on.
npm run electron:build
echo

echo "==> verify"
bash scripts/verify-signing.sh
