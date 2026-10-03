# iOS releases

[Release operations](RELEASING.md) contains the GitHub build/upload commands.

Bundle: com.ricoslabs.raptorrunner. Team: 4BHY8H2J25.
The existing App Store Connect app ID is 6815029628.

## Required GitHub secrets

| Secret | Purpose |
| --- | --- |
| APPLE_CERTIFICATE_BASE64 | Apple Distribution .p12 with its private key |
| APPLE_CERTIFICATE_PASSWORD | .p12 password |
| APPLE_PROVISIONING_PROFILE_BASE64 | App Store profile for this exact bundle and team |
| APPLE_API_KEY_BASE64 | App Store Connect .p8, base64; upload only |
| APPLE_API_KEY_ID | API key ID; upload only |
| APPLE_API_ISSUER_ID | Issuer UUID; upload only |

The team's distribution certificate and API key can serve multiple apps.
The provisioning profile is app-specific; Track Your Time's profile cannot
sign Raptor Runner. The profile must include the certificate whose private
key is in the .p12.

The workflow validates bundle/team, expiration, App Store profile type, and
certificate match before compiling. It creates a temporary signing keychain
only on a disposable GitHub-hosted runner and deletes it afterward.
The local Xcode project retains automatic signing for device development;
CI archive/export uses explicit manual Apple Distribution signing.
CI selects Xcode 26.3 explicitly; macos-15 otherwise defaults to Xcode 16.4.

## Versioning and privacy

npm run mobile:version copies package.json version into Xcode.
Signed builds require an explicit RELEASE_BUILD_NUMBER above existing uploads.
The export step preserves those values.

App/PrivacyInfo.xcprivacy is included in the target's Resources phase.
It declares Preferences/UserDefaults (CA92.1) and Filesystem timestamps
(C617.1). Native telemetry is disabled by the runtime's platform/host checks.
Revisit the manifest and App Store privacy declarations if data use changes.

## Build and upload

Use Build mobile apps with platform=ios or all and mode=signed.
The workflow archives, exports, verifies the IPA, and saves it as a signed
release artifact. Missing credentials are a failure.

Use Upload tested mobile build with destination=testflight and the successful
build run ID. The uploaded IPA must match its signed source manifest.
A TestFlight upload is not an App Store submission. Processing, beta review,
tester groups, public review, and release remain App Store Connect operations.

For an unsigned compile check, use mode=smoke. It produces no store IPA.

## Local archive

With an installed App Store profile and distribution identity, set
APPLE_PROVISIONING_PROFILE_NAME, IOS_EXPORT_OPTIONS (a rendered export plist),
and RELEASE_BUILD_NUMBER, then run npm run build:ios:release.
The plist needs method=app-store-connect, signingStyle=manual,
signingCertificate=Apple Distribution, and this bundle's profile name.
The CI profile helper renders this without interpolating unescaped XML.

Before public submission, install through TestFlight on real iPhone/iPad
hardware. Check audio, touch controls, background/resume, rotation, safe areas,
offline startup, saved progress, and crash reports. Local compilation does
not establish that those flows work on devices.
