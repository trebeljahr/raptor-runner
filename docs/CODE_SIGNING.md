# Desktop code signing

How to get signed, distributable macOS / Windows / Linux builds out of an
Electron app. Written against this repo, but the structure is meant to be
copied into other projects — see [Porting this to a new app](#porting-this-to-a-new-app)
at the end.

## The thing to understand first

**Both signing paths fail silently.** This is the single fact that makes
code signing harder than it looks.

electron-builder skips notarization without an error when no credentials
are in the environment — `getNotarizeOptions()` in `macPackager.js` returns
`undefined`, the build carries on, and it exits 0. Signing with the *wrong
type* of certificate fails the same quiet way. An unsigned Windows `.exe`
builds and runs perfectly on the machine that built it.

In every case the broken artifact is indistinguishable from a good one
until someone else downloads it. So the rule this repo follows:

> A build is not finished until a verification step has said so.

That is what `scripts/verify-signing.sh` is for, and why
`npm run release:desktop` refuses to hand you artifacts it could not check.

## What each platform actually requires

| Platform | Mechanism | Required? | Cost |
| --- | --- | --- | --- |
| macOS | Developer ID signature + Apple notarization + stapled ticket | Yes — Gatekeeper hard-blocks otherwise | $99/yr Apple Developer Program |
| Windows | Authenticode signature + RFC 3161 timestamp | No, but unsigned triggers a SmartScreen block-through | ~$10/mo (Azure) to ~$600/yr (EV cert) |
| Linux | none | No | — |

There is **no notarization on Windows**. No upload-and-scan step exists;
the analogous concept is a timestamped Authenticode signature, plus
SmartScreen reputation, which accrues from download volume and cannot be
bought directly.

---

## macOS

### One-time, per Apple developer account

**1. Get a Developer ID Application certificate.**

Not "Apple Distribution" — that one is App Store and TestFlight only. For
a non-Mac-App-Store target, electron-builder only ever considers
`Developer ID Application` certificates (`getCertificateTypes()` in
`macPackager.js`), and Gatekeeper only accepts that chain for direct
downloads.

Xcode → Settings → Accounts → your team → Manage Certificates → **+** →
Developer ID Application. Needs the Account Holder role.

Confirm:

```bash
security find-identity -v -p codesigning
# 1) ... "Developer ID Application: Your Org (TEAMID)"
```

**2. Create an app-specific password** at appleid.apple.com → Sign-In and
Security → App-Specific Passwords.

**3. Store notarization credentials in the Keychain.**

```bash
xcrun notarytool store-credentials "Your Profile Name" \
  --apple-id "you@example.com" \
  --team-id "YOURTEAMID"
```

It prompts for the app-specific password from step 2 and validates
against Apple before saving.

Of electron-builder's three credential modes, prefer this one locally: the
secret lives in the macOS Keychain rather than in a shell variable, a
`.env` file, or your shell history. The other two modes exist for CI, where
there is no Keychain to read — see [CI](#ci) below.

### Per project

```jsonc
// package.json → "build"
"mac": {
  "identity": "Your Org (TEAMID)",  // NO "Developer ID Application:" prefix
  "hardenedRuntime": true,
  "notarize": true
}
```

Three things worth knowing about that block:

- **The `identity` string must not include the certificate-type prefix.**
  electron-builder errors with `Please remove prefix "Developer ID
  Application:" from the specified name`. It picks the type itself — and
  because a non-MAS target narrows the list to Developer ID Application
  only, the bare name is a *stronger* guarantee than a hardcoded prefix.
- **Pinning `identity` makes an uncredentialed build fail** instead of
  quietly selecting whatever certificate happens to be in the Keychain.
  That is the point. For a deliberately unsigned local build, override
  with `-c.mac.identity=null`.
- **You almost certainly do not need a custom entitlements file.**
  electron-builder's default template already grants `allow-jit`,
  `allow-unsigned-executable-memory`, and `disable-library-validation`.
  That last one is what lets bundled native modules load under hardened
  runtime — for this repo, `steamworks.js` and its `libsteam_api.dylib`.

### Build and verify

```bash
npm run release:desktop
```

Preflight, build, verify. Notarization adds several minutes per
architecture — the artifact is uploaded to Apple, scanned, and the
returned ticket stapled back onto the bundle.

To check by hand:

```bash
spctl -a -vvv -t exec "release/mac/Raptor Runner.app"
# want: accepted / source=Notarized Developer ID

xcrun stapler validate "release/mac/Raptor Runner.app"
# want: The validate action worked!
```

Stapling matters separately from notarization: without a stapled ticket
the app has to reach Apple on first launch, so an offline first run is
refused.

**Do not check the `.dmg` itself for a signature.** electron-builder
leaves disk images unsigned deliberately — `dmg.sign` defaults to `false`,
because "signing is not required and will lead to unwanted errors in
combination with notarization requirements". So

```bash
spctl -a -t open --context context:primary-signature release/*.dmg
# rejected / source=no usable signature   ← expected, not a defect
```

reports a failure for a perfectly good release, which is a trap worth
knowing about before it sends you chasing a non-bug. What decides whether
a user can launch the app is the bundle they drag *out* of the image, and
that bundle carries its own stapled ticket. `verify-signing.sh` therefore
mounts each image and checks the app inside.

---

## Windows

### GitHub OIDC signing

The Windows job uses a dedicated secretless identity and the shared Azure
Artifact Signing profile:

- Account/resource group: `ricoslabs-signing`
- Profile: `ricoslabs-public` (Public Trust)
- Endpoint: `https://weu.codesigning.azure.net/`
- Expected publisher: `Ricos Labs LLC`
- Tenant: `ce0c906e-8a84-4877-afd9-cdf103ddaacb`
- Subscription: `4aaef5a5-286b-46a0-b9e4-84622e8fdc4f`
- Repository variable `AZURE_CLIENT_ID`: `39354eba-200a-4d0e-a853-3c420bf534cd`

The identity has only **Artifact Signing Certificate Profile Signer** on
that profile. Its exact federated subjects are
`repo:trebeljahr/raptor-runner:ref:refs/heads/main` and
`repo:trebeljahr/raptor-runner:ref:refs/heads/windows-signing`, with issuer
`https://token.actions.githubusercontent.com` and audience
`api://AzureADTokenExchange`. No client secret or certificate is copied
from another app.

Dispatch **Build desktop binaries** on `main` or `windows-signing` with
`windows_only=true`. The verification branch avoids the separate GitHub
Pages deployment triggered by a push to `main`. Remove its federated
credential after verification and branch cleanup.
`azure/login` exchanges GitHub OIDC for an Azure CLI session.
electron-builder 26.15.3 passes signing to the TrustedSigning PowerShell
module, which can use that session. CI injects `azureSignOptions`; local
builds and PR smoke builds remain unsigned.

`scripts/verify-windows-signing.ps1` requires the packaged application,
NSIS installer, and portable executable. Each must have a valid
Authenticode signature, publisher `Ricos Labs LLC`, and a timestamp.
CI uploads the SHA-256 hashes, certificate subjects and thumbprints,
commit and run ID as `windows-signing-evidence` only after verification.

Manual dispatch never publishes to itch.io. Tags and other branches fail
closed for Windows: adding release trust requires a separate review before
using the tag publishing path. This prevents a release from silently
falling back to unsigned Windows binaries.

Run signing and verification on hosted Windows runners. Local macOS
validation cannot prove Windows Authenticode trust.

---

## Linux

AppImages ship unsigned. Nothing in the Linux desktop stack verifies them
at launch, and neither itch.io nor Steam asks for a signature. Detached
GPG signatures are possible but buy nothing here.

---

## CI

`.github/workflows/build-desktop.yml` builds all three platforms on tag
pushes and manual dispatches. Windows signing requires a trusted-branch
dispatch; tag publishing remains blocked until release trust is configured.

PRs get unsigned smoke builds. Trusted Windows dispatches require OIDC
login and successful signature verification; missing settings fail the job.

### Repository secrets

| Secret | Platform | What it is |
| --- | --- | --- |
| `MAC_CSC_LINK` | macOS | Base64 of the Developer ID `.p12` export |
| `MAC_CSC_KEY_PASSWORD` | macOS | Password set when exporting that `.p12` |
| `APPLE_API_KEY_P8` | macOS | Contents of the App Store Connect `.p8` key |
| `APPLE_API_KEY_ID` | macOS | Key ID from App Store Connect |
| `APPLE_API_ISSUER` | macOS | Issuer UUID from App Store Connect |

### Repository variables

Non-secret, set under Settings → Variables:
`AZURE_CLIENT_ID`. The shared profile and expected publisher are pinned
in the workflow. Windows needs no repository secrets.

### Exporting the .p12

```bash
# Keychain Access → find "Developer ID Application: ..." → right-click →
# Export → .p12, set a password. Then:
base64 -i Certificates.p12 | pbcopy
```

Paste as `MAC_CSC_LINK`; the export password becomes
`MAC_CSC_KEY_PASSWORD`.

### Why an API key in CI instead of the app-specific password

App Store Connect API keys are revocable individually and are not tied to
a personal Apple ID or its 2FA. A leaked app-specific password is a
credential on *your account*; a leaked API key is one key you delete.
electron-builder supports both — `APPLE_API_KEY` (a **path** to the `.p8`,
not its contents), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.

The workflow writes the `.p8` to `$RUNNER_TEMP`, outside the workspace, so
no artifact glob can sweep it up.

---

## Porting this to a new app

Copy these three scripts unchanged — none of them hardcode this project:

- `scripts/preflight-signing.sh` — fails in a second if credentials are
  missing, rather than fifteen minutes in
- `scripts/verify-signing.sh` — the actual gate
- `scripts/release-desktop.sh` — chains preflight → build → verify

Then, per app:

1. `package.json` scripts: `release:desktop`, `preflight:signing`,
   `verify:signing`.
2. `build.mac.identity` — same certificate, so the same bare
   `Org (TEAMID)` string. One Developer ID certificate covers every app
   you ship.
3. `APPLE_KEYCHAIN_PROFILE` — `release-desktop.sh` defaults to this
   repo's profile name; either override the env var or run
   `notarytool store-credentials` again under a new name. One profile can
   serve every app on the same Apple ID.
4. Copy `.github/workflows/build-desktop.yml` and re-point the artifact
   names. Secrets are per-repository, so they have to be added again —
   the values are identical across your apps.
5. Windows: share the signing account/profile, but create a dedicated
   per-repository OIDC identity and grant only profile-scoped signing.
   Match the publisher to the profile certificate subject.

The one genuinely per-app step is the Apple bundle identifier
(`build.appId`). Everything else in this document is account-level and
set up once.

---

## Troubleshooting

**`Please remove prefix "Developer ID Application:" from the specified name`**
— `build.mac.identity` includes the certificate type. Use the bare
`Org (TEAMID)`.

**Build succeeds, `spctl` says `rejected / source=no usable signature`**
— for a `.app`, nothing signed it: either no matching certificate was
found or `identity` is `null`. Run `npm run preflight:signing`. For a
`.dmg` this is the expected result and not a problem — see the note in
[Build and verify](#build-and-verify).

**`spctl` says `rejected` but names your Apple Distribution certificate**
— wrong certificate type. Get a Developer ID Application certificate.

**Notarization was skipped and nothing said why** — no credentials were
visible to the build. `getNotarizeOptions()` returns `undefined` and the
step is skipped silently. This is exactly what preflight catches.

**`xcrun stapler validate` fails on a freshly notarized app** — Apple
accepted the submission but the ticket was not stapled. Usually a
notarization that returned `Invalid`; check with
`xcrun notarytool log <submission-id> --keychain-profile "<profile>"`.

**Gatekeeper rejects only on another machine** — the build machine has the
signing certificate in its Keychain, which makes local checks pass more
easily. Always trust `spctl`, and test on a machine that never held the
certificate.
