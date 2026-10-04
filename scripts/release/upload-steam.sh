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
steam_status=0
"$steam_dir/steamcmd.sh" +login "$STEAM_USERNAME" +run_app_build "$PWD/artifacts/steam-build.vdf" +quit < /dev/null > "$steam_dir/upload.log" 2>&1 || steam_status=$?
success='Successfully finished AppID 5035590 build \(BuildID [0-9]+\)'
if (( steam_status != 0 )) || ! grep -Eq "$success" "$steam_dir/upload.log"; then
  printf 'Steam upload failed (SteamCMD exit code %s). No successful upload was confirmed.\n' "$steam_status" >&2
  # Emit only fixed diagnoses; raw log lines can contain authentication data.
  if grep -Eqi 'Invalid Password|No cached credentials' "$steam_dir/upload.log"; then
    echo 'Steam rejected the saved login. Export the session with its matching Steam Guard machine record.' >&2
  elif grep -Eqi 'License expired|Expired' "$steam_dir/upload.log"; then
    echo 'The Steam session expired. Renew SteamCMD authentication and update the CI session secret.' >&2
  elif grep -Eqi 'RateLimitExceeded|Rate limit|Too many login' "$steam_dir/upload.log"; then
    echo 'Steam is limiting login attempts. Wait before trying again.' >&2
  elif grep -Eqi 'Access Denied|InvalidPermission|Permission Denied|Insufficient privilege' "$steam_dir/upload.log"; then
    echo 'Steam denied access. Check app permissions and depot ownership.' >&2
  elif grep -Eqi 'Steam Guard|two-factor|authenticator' "$steam_dir/upload.log"; then
    echo 'Steam requires authentication approval. Renew the SteamCMD session.' >&2
  fi
  exit 1
fi
grep -Eo "$success" "$steam_dir/upload.log"
