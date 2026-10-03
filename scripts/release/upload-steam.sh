#!/usr/bin/env bash
set -euo pipefail
: "${STEAM_USERNAME:?Missing Steam build account}"
: "${STEAM_CONFIG_VDF:?Missing authorized SteamCMD session}"
steam_dir="$RUNNER_TEMP/raptor-steamcmd"
umask 077
mkdir -p "$steam_dir/config"
trap 'rm -rf "$steam_dir"' EXIT
curl --fail --location --retry 3 https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz -o "$steam_dir/steamcmd.tar.gz"
tar -xzf "$steam_dir/steamcmd.tar.gz" -C "$steam_dir"
printf '%s' "$STEAM_CONFIG_VDF" | base64 --decode > "$steam_dir/config/config.vdf"
# Session config contains refresh credentials. Keep all Steam logs out of artifacts.
"$steam_dir/steamcmd.sh" +login "$STEAM_USERNAME" +run_app_build "$PWD/artifacts/steam-build.vdf" +quit > "$steam_dir/upload.log" 2>&1
if ! grep -E 'Successfully finished AppID 5035590 build \(BuildID [0-9]+\)' "$steam_dir/upload.log"; then
  echo 'Steam upload failed. Renew the build-account SteamCMD session and check depot access. No build success was reported.' >&2
  exit 1
fi
