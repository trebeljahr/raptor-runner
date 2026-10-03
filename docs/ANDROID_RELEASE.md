# Android releases

[Release operations](RELEASING.md) contains the GitHub build/upload commands.

Package: com.ricoslabs.raptorrunner. Android reads versionName from package.json.
Every release requires RELEASE_BUILD_NUMBER, a positive integer above all
previous Play uploads. Debug builds remain available without release secrets.

## Required GitHub secrets

- ANDROID_KEYSTORE_BASE64: base64 of the existing app upload keystore.
- ANDROID_KEYSTORE_PASSWORD: store password.
- ANDROID_KEY_ALIAS: upload key alias.
- ANDROID_KEY_PASSWORD: private-key password.
- PLAY_SERVICE_ACCOUNT_JSON: service account authorized for this app in Play
  Console. Needed for upload, not for building.

Use Raptor Runner's existing registered upload key. Do not copy another app's
key or generate a replacement until Play Console's certificate fingerprint
has been checked. Play App Signing may hold a different app-signing key.
The upload key signs our AAB; Google signs delivered Play APKs.

A direct APK uses the upload key in this workflow. It may not update a Play
installation signed with Google's app-signing key. Keep the distribution
channels separate unless their signing identity has been deliberately aligned.

## Local build

Store secrets outside Git. Either export ANDROID_KEYSTORE_PATH plus the three
password/alias variables, or use ignored android/keystore.properties based on
android/keystore.properties.example. Relative storeFile is relative to android/app.

~~~sh
RELEASE_BUILD_NUMBER=BUILD_NUMBER npm run build:android:release
~~~

The command syncs only Android, builds AAB and APK, then verifies signatures.
CI checks both signatures against the configured upload key's fingerprint.
Without signing configuration or a release build number, Gradle fails rather
than silently creating an unsigned release. apksigner uses the newest installed
stable Android build-tools version; CI installs 36.0.0.

## Play Console setup and upload

Register the app, enable Play App Signing, verify the existing upload
certificate, and grant the publisher service account app-level release access.
Complete listing, screenshots, content rating, target audience, data-safety,
privacy URL, and any account-specific testing requirements.

Run Build mobile apps, mode=signed, then Upload tested mobile build for that
run ID. Start with an internal draft. Use completed for testers after console
setup permits it. The first app upload may need the console UI.
Production stays draft until you review and roll it out in Play Console.

The workflow preserves the exact signed AAB, APK, R8 mapping, hashes, and
signed provenance. Back up the upload keystore independently of this repo.
Losing an upload key requires Google's reset process; it is not a normal version bump.
