#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
case "$(uname -m)" in
  arm64) arch=arm64 ;;
  x86_64) arch=x64 ;;
  *) echo 'Unsupported Mac architecture.' >&2; exit 1 ;;
esac
exec "./$arch/Raptor Runner.app/Contents/MacOS/Raptor Runner" "$@"
