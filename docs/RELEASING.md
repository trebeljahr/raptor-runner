# Release operations

Build once, test the artifacts, then publish that exact workflow run. All release
workflows are manual GitHub Actions dispatches on main. Tag pushes do not build,
sign, publish to itch, or submit to a mobile store.

## Supported release targets

| Platform | Outputs | Distribution |
| --- | --- | --- |
| macOS arm64 and x64 | Notarized DMG, ZIP, app depot | Website downloads, itch, Steam |
| Windows x64 | Signed NSIS installer, portable EXE, app depot | Website downloads, itch, Steam |
| Linux x64 | AppImage and unpacked app depot with signed build provenance | Website downloads, itch, Steam |
| Android | Signed AAB, APK, R8 mapping | Google Play; APK retained for device tests |
| iOS arm64 | Signed App Store IPA | TestFlight, then App Store Connect |
| macOS universal (sandboxed) | Signed installer pkg | Mac App Store; local build, see [MAC_APP_STORE.md](MAC_APP_STORE.md) |

Windows/Linux ARM builds are not enabled: the bundled steamworks.js native
module supports x64 on those systems. Mac ARM and Intel both have native builds.
Microsoft Store is deferred. The Mac App Store build runs locally with
`pnpm build:mas`; see [MAC_APP_STORE.md](MAC_APP_STORE.md).

App Store screenshots: `pnpm build && node scripts/store-screenshots.mjs`
writes iPhone 6.9-inch, iPad 13-inch, Mac and iPhone Duo sets to
store-screenshots/.

Linux has no Gatekeeper-style universal signing authority. The workflow signs
GitHub provenance for its files. This proves repository/workflow/commit origin;
it does not make the Linux loader enforce a signature.

## Prepare a version

1. Update package.json to an unused stable X.Y.Z version. v1.1.2 already exists;
   it cannot label new code. Never move an existing release tag.
2. Run `npm run mobile:version` to synchronize the Xcode marketing version.
   Android reads package.json directly.
3. Commit and integrate into main. Push only when the website is ready:
   deploy.yml deploys GitHub Pages on every main push.
4. For mobile, inspect Play Console and App Store Connect. Choose a positive
   build number greater than existing uploads, including interrupted runs.
   Rebuilding after an upload needs another number; uploading an existing
   artifact again does not rebuild it.

A public store listing, pricing, privacy declarations, age ratings, screenshots,
and device QA remain separate from binary signing.

## Build buttons

In GitHub → Actions:

- **Build desktop binaries** (build-desktop.yml): platform all/windows/macos/linux,
  mode signed or smoke. Signed mode requires main and all credentials for each
  selected platform. Smoke mode intentionally produces unsigned artifacts.
- **Build mobile apps** (build-mobile.yml): platform all/android/ios, mode signed
  or smoke. Signed mode requires a unique build_number. Smoke mode builds an
  Android debug APK or compiles iOS without signing; it produces no store IPA.
- **Deploy to GitHub Pages** (deploy.yml): existing website deploy button.

Command equivalents:

~~~sh
gh workflow run build-desktop.yml --ref main -f platform=all -f mode=signed
gh workflow run build-mobile.yml --ref main -f platform=all -f mode=signed -f build_number=BUILD_NUMBER
gh workflow run build-mobile.yml --ref main -f platform=all -f mode=smoke
~~~

Never infer signing success from a green packaging command. Mac verification
checks the team, signature, Gatekeeper result, and stapled ticket in both DMGs
and ZIPs. Windows checks the unpacked EXE, installer, and portable EXE, their
publisher, and timestamps. Android checks both formats against the upload key.
iOS checks profile type, bundle/team, expiry, matching private key, exported
signature, version/build, and embedded privacy manifest.

Signed artifacts are named release-PLATFORM-ARCH; smoke artifacts cannot be
published by these workflows. Each signed artifact contains a manifest with
version, source commit, run ID, hashes, and signing method. Actions keeps the
artifacts for 30 days. Use a draft download release for durable desktop storage.
Retain mobile store artifacts and symbols in your normal private release archive.

## Publish buttons

**Publish tested desktop build** (publish-desktop.yml) takes a successful signed
desktop run ID containing all four targets. Choose one destination:

- **downloads-draft**: requires an existing vX.Y.Z tag at the exact build commit.
  Creates a draft GitHub Release with desktop downloads and SHA256SUMS.txt.
  It refuses a tag at another commit and never overwrites an existing release.
  Review the draft and publish it in GitHub when ready.
- **itch**: uploads both Mac architectures, Windows installer/portable, and Linux.
  Channels are osx-arm64, osx-x64, osx-dmg-arm64, osx-dmg-x64, windows,
  windows-setup, and linux. Archive old osx/osx-dmg uploads in the itch dashboard
  after verifying the new channels; the workflow does not delete them.
- **steam**: uploads three explicitly configured depots and sets the build live
  on a beta branch. Empty steam_branch uses the STEAM_TEST_BRANCH repository
  variable (internal); steam_branch=none uploads only. Steam testers opt in
  under Properties → Betas. Promotion to default and the first public launch
  remain Steamworks actions.

~~~sh
gh workflow run publish-desktop.yml --ref main -f run_id=DESKTOP_RUN_ID -f destination=downloads-draft
gh workflow run publish-desktop.yml --ref main -f run_id=DESKTOP_RUN_ID -f destination=itch
gh workflow run publish-desktop.yml --ref main -f run_id=DESKTOP_RUN_ID -f destination=steam
~~~

**Upload tested mobile build** (publish-mobile.yml) takes a successful signed
mobile run ID and destination play or testflight.

- Play defaults to an internal draft. Choose completed for internal/alpha/beta
  testers when the app is eligible. Production uploads must remain drafts;
  review and roll out in Play Console. Internal uploads use Play's automatic
  processing; other tracks keep changes out of review until submitted in Play
  Console. Initial app setup and the first upload may require Play Console.
- TestFlight uploads the verified IPA. App Store review and public release
  remain in App Store Connect; uploading does not promise approval or availability.

~~~sh
gh workflow run publish-mobile.yml --ref main -f run_id=MOBILE_RUN_ID -f destination=play -f play_track=internal -f play_status=draft
gh workflow run publish-mobile.yml --ref main -f run_id=MOBILE_RUN_ID -f destination=testflight
~~~

The publisher checks repository, workflow path, successful main dispatch,
source commit, signed provenance, and every file hash before uploading. It
does not rebuild or accept arbitrary locally supplied binaries.

## Website downloads

Use the existing website as a landing page; host versioned desktop binaries in
GitHub Releases and link to them. A draft is private until published. No separate
file server, payment system, or custom updater is needed for the first release.
The repository is public, so published downloads are publicly downloadable.
If desktop copies will be paid-only, keep downloads on itch/Steam instead.

The game's website and privacy/support URLs must work before store submission.
Check the new domain and the old-host redirect before pushing a domain change.
Do not link visitors to an unpublished release. Downloads can link to
https://github.com/trebeljahr/raptor-runner/releases after the first release exists.

## Steam setup

Set three distinct existing depot IDs: STEAM_DEPOT_WINDOWS, STEAM_DEPOT_LINUX,
STEAM_DEPOT_MACOS. Add them to the app's packages and assign Windows/Linux/macOS
filters in Steamworks. Configure these launch executables:

| OS | Executable |
| --- | --- |
| Windows | Raptor Runner.exe |
| Linux | raptor-runner |
| macOS | raptor-runner.sh |

The Mac depot contains signed arm64 and x64 apps in separate directories. Its
launcher selects the native architecture. Verify launch, overlay, achievements,
controller input, save paths, and updates through a Steam beta installation.
Steam supplies SteamAppId=5035590, which enables the existing integration.
Direct downloads do not enable Steam just because the client is running.

The Steam overlay costs frame rate: it needs Chromium's in-process GPU, which
puts all GPU work on the browser main thread. The overlay is on for Windows and
Linux and off for macOS, where it does not attach reliably. Players can
override this with the launch option `--steam-overlay` or `--no-steam-overlay`.

Steam requires an account with Edit App Metadata and Publish App Changes To
Steam permissions. Valve recommends a dedicated builder account with only these
permissions. One builder account can serve several games through Steamworks
permission groups; a separate account per game is optional. An existing admin
account also works, but its reusable CI session belongs to that broader account.

Authenticate once with Valve's SteamCMD on Linux x86_64, then save its base64
~/Steam/config/config.vdf as STEAM_CONFIG_VDF. A session from macOS SteamCMD
failed on the hosted Linux runner with Invalid Password; a session from a Linux
server worked. Use a throwaway HOME so the login stays separate and is easy to
delete afterwards:

```bash
HOME=~/steam-ci ./steamcmd.sh +login ACCOUNT +quit
ssh HOST 'base64 -w0 ~/steam-ci/Steam/config/config.vdf' | gh secret set STEAM_CONFIG_VDF --env release-steam
```

Then delete ~/steam-ci on that server. STEAM_USERNAME names the account. A
browser login does not replace this SteamCMD authentication. The config contains
refresh credentials: never commit it or upload it as a build artifact. Renew the
session if Steam Guard asks for authentication again. The upload script does not
require a password.

## Credential setup

See [code signing](CODE_SIGNING.md), [Android](ANDROID_RELEASE.md), and
[iOS](IOS_RELEASE.md). Configure release-downloads-draft, release-itch,
release-steam, release-play, and release-testflight GitHub environments with
main-only deployment rules and any desired reviewers before publishing.
The workflow checks main independently; an environment name alone does not
create approval protection.

Build credentials belong to repository secrets; publisher credentials may be
scoped to their release environment. Do not add an environment to the Windows
build job without updating its exact Azure OIDC subject.

## Local checks

~~~sh
pnpm install --frozen-lockfile
npm run release:check
npm run build
npm run build:desktop
npm run electron:compile
npm run cap:sync
actionlint
shellcheck -x scripts/release/*.sh
~~~

Use the pinned pnpm 10.33.2, Node 24, JDK 21, Android SDK 36, and current
store-supported Xcode. Local tests use disposable keys or no signing.
Only hosted signed runs plus installed-device testing establish release readiness.
