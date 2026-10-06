#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# Steam can start games under Rosetta, where uname -m reports x86_64 even on
# Apple Silicon. hw.optional.arm64 reports the hardware, so prefer it. The arm64
# executable has no x86_64 slice, so exec runs it natively.
if [[ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" == 1 ]]; then
  arch=arm64
else
  case "$(uname -m)" in
    arm64) arch=arm64 ;;
    x86_64) arch=x64 ;;
    *) echo 'Unsupported Mac architecture.' >&2; exit 1 ;;
  esac
fi
exec "./$arch/Raptor Runner.app/Contents/MacOS/Raptor Runner" "$@"
