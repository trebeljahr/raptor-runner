#!/usr/bin/env bash
# Verify distributable artifacts, not merely the presence of credentials.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
export RELEASE_DIR="${RELEASE_DIR:-$repo_root/release}"
case "$(uname -s)" in
  Darwin)
    exec bash scripts/release/verify-macos.sh
    ;;
  MINGW* | MSYS* | CYGWIN*)
    ps_bin="$(command -v pwsh || command -v powershell.exe || true)"
    [[ -n "$ps_bin" ]] || { echo 'PowerShell is required for Windows signature verification.' >&2; exit 1; }
    exec "$ps_bin" -NoProfile -NonInteractive -File scripts/verify-windows-signing.ps1 -ReleaseDir "$RELEASE_DIR"
    ;;
  Linux)
    command -v gh >/dev/null || { echo 'GitHub CLI is required to verify Linux build provenance.' >&2; exit 1; }
    shopt -s nullglob
    images=("$RELEASE_DIR"/*.AppImage)
    [[ ${#images[@]} -gt 0 ]] || { echo 'No AppImage found.' >&2; exit 1; }
    for image in "${images[@]}"; do
      gh attestation verify "$image" --repo trebeljahr/raptor-runner \
        --signer-workflow trebeljahr/raptor-runner/.github/workflows/build-desktop.yml \
        --source-ref refs/heads/main --source-digest "$(git rev-parse HEAD)" --deny-self-hosted-runners
    done
    ;;
  *) echo 'Unsupported verification host.' >&2; exit 1 ;;
esac
