# Mac App Store releases

The Mac App Store build is the Electron desktop app, packaged for the
sandbox. It ships on the same App Store Connect record as iOS (app
6815029628, bundle com.ricoslabs.raptorrunner), so both platforms share one
listing. The Developer ID build for the website, itch and Steam keeps its
own bundle id (com.trebeljahr.raptor-runner) and is unaffected.

## What differs from the Developer ID build

| | Developer ID (`electron:build`) | Mac App Store (`build:mas`) |
| --- | --- | --- |
| Config | package.json `build` | electron-builder.mas.cjs (extends it) |
| Bundle id | com.trebeljahr.raptor-runner | com.ricoslabs.raptorrunner |
| Architectures | arm64 and x64, separate | one universal app |
| Signing | Developer ID, hardened runtime, notarized | Apple Distribution + installer identity, sandbox |
| Icon | build/icon.icns | build/AppIcon.icon, compiled to Assets.car |
| Steam | steamworks.js bundled | not bundled; main.ts skips it when `process.mas` |
| Output | DMG + ZIP | release/mas/*.pkg |

The sandbox entitlements ask for nothing beyond the sandbox and the app
group: the game loads only bundled files and keeps its save in the
container. Add an entitlement only with a feature that needs it.

The icon is an Icon Composer bundle. electron-builder compiles it with
actool, which needs Xcode 26 or later. Edit it in Icon Composer or replace
build/AppIcon.icon/Assets/raptor.png (1024x1024, no alpha).

## One-time setup

1. Certificates for team 4BHY8H2J25 in the login keychain: Apple
   Distribution (already present) and Mac Installer Distribution (shown in
   the keychain as "3rd Party Mac Developer Installer").
2. A Mac App Store distribution provisioning profile for
   com.ricoslabs.raptorrunner. Keep it outside the repository, for example
   ~/keys/raptor-runner-mac-app-store.provisionprofile.
3. An App Store Connect API key with the App Manager role:
   ~/.appstoreconnect/private_keys/AuthKey_KEYID.p8, plus the key and issuer IDs.

## Build and upload

Packaging check, no signing:

~~~sh
MAS_UNSIGNED=1 pnpm build:mas
~~~

Signed build, verify, validate and upload:

~~~sh
RELEASE_BUILD_NUMBER=2 \
MAS_PROVISIONING_PROFILE=~/keys/raptor-runner-mac-app-store.provisionprofile \
APPLE_API_KEY_ID=KEYID APPLE_API_ISSUER_ID=ISSUER \
pnpm build:mas --upload
~~~

The marketing version comes from package.json. RELEASE_BUILD_NUMBER must be
higher than every earlier macOS upload of that version. scripts/release/verify-mas.sh
checks the bundle id, versions, encryption key, ElectronTeamID, category,
the 1024 px icon in Assets.car, the universal binary, the missing Steam
SDK, the signature, the sandbox, the embedded profile and the installer
signature before anything is uploaded.

## Before submission

Install the processed build through TestFlight on an Apple Silicon and an
Intel Mac. Check startup, fullscreen, keyboard and gamepad input, audio,
saves across relaunch, and the menu links. The unsigned packaging check
does not run the sandbox, so it proves none of these.
