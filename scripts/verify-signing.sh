#!/usr/bin/env bash
# verify-signing.sh — assert every artifact in release/ is signed the way
# its platform requires, and fail loudly if not.
#
# Why this exists: both signing paths fail *silently* by design.
#
#   macOS   — electron-builder skips notarization without a word when no
#             credentials are in the environment (macPackager.js
#             `getNotarizeOptions` returns undefined and the build still
#             exits 0). Signing with the wrong certificate type fails the
#             same quiet way: Apple Distribution is App Store only, while
#             direct distribution needs Developer ID Application. Both
#             produce a valid-looking signature. Only spctl tells them
#             apart, and only after a user has already downloaded it.
#
#   Windows — an unsigned .exe builds and runs fine on the build machine.
#             The cost lands on users as a SmartScreen block.
#
# So a broken release is indistinguishable from a good one until someone
# else tries to open it. This script is the missing failure mode.
#
# Linux AppImages are intentionally unsigned — no runtime verifies them
# and no store we publish to requires it — so they are reported but never
# fail a run.
#
# Usage:
#   npm run verify:signing            # check whatever is in release/
#   SKIP_WINDOWS=1 npm run verify:signing

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="${RELEASE_DIR:-$REPO_ROOT/release}"

if [[ ! -d "$RELEASE_DIR" ]]; then
  echo "no release/ directory — run a desktop build first" >&2
  exit 1
fi

failures=0
checked=0
skipped=0

pass() { echo "  PASS  $1"; checked=$((checked + 1)); }
fail() { echo "  FAIL  $1 — $2"; checked=$((checked + 1)); failures=$((failures + 1)); }
skip() { echo "  SKIP  $1 — $2"; skipped=$((skipped + 1)); }

flatten() { tr '\n' ' ' | sed 's/  */ /g'; }

# ---------------------------------------------------------------- macOS

# spctl and stapler only exist on macOS, so mac artifacts have to be
# verified on the same runner that produced them.
if [[ "$(uname -s)" == "Darwin" ]]; then
  while IFS= read -r app; do
    [[ -n "$app" ]] || continue
    rel="${app#"$REPO_ROOT"/}"

    assess="$(spctl -a -vvv -t exec "$app" 2>&1)"
    if grep -q "source=Notarized Developer ID" <<<"$assess"; then
      pass "$rel (gatekeeper)"
    else
      fail "$rel (gatekeeper)" "$(flatten <<<"$assess")"
    fi

    # Stapling is what lets the app validate with no network. Without a
    # stapled ticket, a first launch while offline is refused.
    if xcrun stapler validate "$app" >/dev/null 2>&1; then
      pass "$rel (stapled)"
    else
      fail "$rel (stapled)" "no notarization ticket stapled"
    fi
  done < <(find "$RELEASE_DIR" -maxdepth 2 -name "*.app" -type d 2>/dev/null)

  # Do NOT assert a signature on the .dmg itself. electron-builder leaves
  # disk images unsigned on purpose (`dmg.sign` defaults to false: "Signing
  # is not required and will lead to unwanted errors in combination with
  # notarization requirements"), so `spctl -t open` on a .dmg reports "no
  # usable signature" even for a perfectly good release.
  #
  # What actually decides whether a user can launch the app is the bundle
  # they drag out of the image, which carries its own stapled ticket. So
  # mount each image and check that.
  while IFS= read -r dmg; do
    [[ -n "$dmg" ]] || continue
    rel="${dmg#"$REPO_ROOT"/}"

    mnt="$(mktemp -d)"
    if ! hdiutil attach "$dmg" -nobrowse -quiet -mountpoint "$mnt" >/dev/null 2>&1; then
      fail "$rel (mount)" "could not attach the disk image"
      rmdir "$mnt" 2>/dev/null
      continue
    fi

    inner="$(find "$mnt" -maxdepth 1 -name "*.app" -type d 2>/dev/null | head -n1)"
    if [[ -z "$inner" ]]; then
      fail "$rel (contents)" "no .app found inside the image"
    else
      assess="$(spctl -a -vvv -t exec "$inner" 2>&1)"
      if grep -q "source=Notarized Developer ID" <<<"$assess"; then
        pass "$rel (contained app notarized)"
      else
        fail "$rel (contained app notarized)" "$(flatten <<<"$assess")"
      fi

      if xcrun stapler validate "$inner" >/dev/null 2>&1; then
        pass "$rel (contained app stapled)"
      else
        fail "$rel (contained app stapled)" "no notarization ticket stapled"
      fi
    fi

    hdiutil detach "$mnt" -quiet >/dev/null 2>&1
    rmdir "$mnt" 2>/dev/null
  done < <(find "$RELEASE_DIR" -maxdepth 1 -name "*.dmg" 2>/dev/null)
else
  if find "$RELEASE_DIR" -maxdepth 2 \( -name "*.app" -o -name "*.dmg" \) -print -quit 2>/dev/null | grep -q .; then
    skip "macOS artifacts" "spctl/stapler unavailable on $(uname -s); verify on a macOS runner"
  fi
fi

# -------------------------------------------------------------- Windows

# Three ways to read an Authenticode signature, in order of availability:
# PowerShell on a Windows runner, osslsigncode anywhere else, otherwise
# report honestly that we could not check rather than implying success.
if [[ "${SKIP_WINDOWS:-}" != "1" ]]; then
  while IFS= read -r exe; do
    [[ -n "$exe" ]] || continue
    rel="${exe#"$REPO_ROOT"/}"

    ps_bin="$(command -v powershell.exe || command -v pwsh || true)"
    if [[ -n "$ps_bin" ]]; then
      status="$("$ps_bin" -NoProfile -NonInteractive -Command \
        "(Get-AuthenticodeSignature -FilePath '$exe').Status" 2>&1 | tr -d '\r' | tail -n1)"
      if [[ "$status" == "Valid" ]]; then
        pass "$rel (authenticode)"
      else
        fail "$rel (authenticode)" "signature status: ${status:-unknown}"
      fi
    elif command -v osslsigncode >/dev/null 2>&1; then
      if osslsigncode verify "$exe" 2>&1 | grep -q "Signature verification: ok"; then
        pass "$rel (authenticode)"
      else
        fail "$rel (authenticode)" "osslsigncode could not verify the signature"
      fi
    else
      skip "$rel (authenticode)" "no powershell or osslsigncode available to check"
    fi
  done < <(find "$RELEASE_DIR" -maxdepth 1 -name "*.exe" 2>/dev/null)
fi

# ---------------------------------------------------------------- Linux

# Reported for completeness. AppImages ship unsigned: nothing in the Linux
# desktop stack verifies them at launch and no store we publish to asks.
while IFS= read -r img; do
  [[ -n "$img" ]] || continue
  skip "${img#"$REPO_ROOT"/}" "AppImages ship unsigned by design"
done < <(find "$RELEASE_DIR" -maxdepth 1 -name "*.AppImage" 2>/dev/null)

# --------------------------------------------------------------- Result

echo
if [[ "$checked" -eq 0 && "$skipped" -eq 0 ]]; then
  echo "no artifacts found in $RELEASE_DIR" >&2
  exit 1
fi

if [[ "$failures" -gt 0 ]]; then
  echo "$failures of $checked checks failed — do NOT ship these artifacts" >&2
  exit 1
fi

if [[ "$skipped" -gt 0 ]]; then
  echo "all $checked checks passed, $skipped skipped"
else
  echo "all $checked checks passed"
fi
