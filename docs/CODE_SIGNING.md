# Desktop code signing

[Release operations](RELEASING.md) describes the build and publish buttons.
Signed release jobs fail when credentials are absent; PR and explicit smoke
builds are unsigned and cannot pass the publisher's provenance checks.

## macOS direct distribution

Required GitHub secrets:

| Secret | Value |
| --- | --- |
| MAC_CSC_LINK | Base64 Developer ID Application certificate and private key in a .p12 |
| MAC_CSC_KEY_PASSWORD | Password for that .p12 |
| APPLE_API_KEY_BASE64 | Base64 App Store Connect .p8 API key |
| APPLE_API_KEY_ID | API key ID |
| APPLE_API_ISSUER_ID | Issuer UUID |

Team: 4BHY8H2J25. Pinned identity: Ricos Labs LLC (4BHY8H2J25).
Developer ID signs direct-download apps. Apple Distribution is a different
certificate for iOS/Mac App Store and cannot replace Developer ID here.

The workflow decodes the API key outside the workspace, imports the signing
identity through electron-builder, enables hardened runtime, notarizes the app,
and verifies each deliverable. Temporary key material is removed afterward.
The secret names for Apple API access match the mobile workflow and Track Your Time.

Verification uses codesign, spctl, and stapler against the app in each DMG,
each ZIP, and the unpacked Steam payload. The DMG container itself need not
carry an extra signature: its contained app must pass all checks.

A local Mac build can use an already installed Developer ID identity and
APPLE_KEYCHAIN_PROFILE, or the electron-builder Apple API environment variables:

~~~sh
APPLE_KEYCHAIN_PROFILE="Raptor Runner" npm run release:desktop
~~~

Do not automate keychain dialogs or repeatedly request an export. Use an
existing CI .p12 where available, or perform a deliberate manual export.
No test needs access to the user's real signing keychain.

## Windows

The hosted job signs with Azure Artifact Signing through GitHub OIDC:

| Setting | Value |
| --- | --- |
| Repository variable AZURE_CLIENT_ID | 39354eba-200a-4d0e-a853-3c420bf534cd |
| Tenant | ce0c906e-8a84-4877-afd9-cdf103ddaacb |
| Subscription | 4aaef5a5-286b-46a0-b9e4-84622e8fdc4f |
| Account / certificate profile | ricoslabs-signing / ricoslabs-public |
| Endpoint | https://weu.codesigning.azure.net/ |
| Publisher | Ricos Labs LLC |

The identity has the profile-scoped signing role. The release workflow runs
only as a main-branch dispatch and uses the existing exact subject:
repo:trebeljahr/raptor-runner:ref:refs/heads/main. No wildcard tag or PR trust
is needed. A legacy windows-signing branch federation was used for initial
verification; it is not accepted by the new release planner.

scripts/verify-windows-signing.ps1 requires the app, NSIS installer, and
portable EXE to have valid Authenticode, the expected publisher, and timestamps.
Its evidence file includes SHA-256 hashes, certificate subjects, and run/commit.
A signature does not guarantee that SmartScreen reputation warnings disappear.

## Linux and provenance

The Linux loader does not enforce one universal desktop signature scheme.
The release workflow uses actions/attest to sign repository/workflow/commit
provenance for AppImages, depot archives, manifests, and other outputs.
All desktop and mobile release artifacts receive the same provenance layer.

To verify a download:

~~~sh
gh attestation verify Raptor-Runner-VERSION-linux-x64.AppImage --repo trebeljahr/raptor-runner
~~~

The publisher additionally restricts verification to the expected workflow,
main branch, exact source commit, and GitHub-hosted runners. File checksums
alone detect corruption; signed provenance also authenticates their source.

## Missing credentials

Missing or partial signing sets are errors, not permission to publish unsigned
files. Run mode=smoke for packaging checks without production identities.
Current account readiness is recorded in the project's AI notes vault.
