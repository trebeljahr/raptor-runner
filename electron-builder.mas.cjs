/*
 * Mac App Store package. Reuses the desktop config from package.json and
 * changes what the store build needs: the bundle id of the App Store Connect
 * record (shared with iOS, so both platforms sit on one listing), the
 * sandbox, an Icon Composer icon compiled into Assets.car, and no Steam SDK.
 *
 * Keys that end up in Info.plist go under `mac`: app-builder-lib builds
 * the plist from `mac` and ignores `mas.extendInfo`.
 *
 * Run through scripts/release/build-mas.sh, which checks the result.
 */
const base = require("./package.json").build;

const unsigned = process.env.MAS_UNSIGNED === "1";
const entitlements = "build/entitlements.mas.plist";
const entitlementsInherit = "build/entitlements.mas.inherit.plist";

module.exports = {
  ...base,
  appId: "com.ricoslabs.raptorrunner",
  copyright: "Copyright © 2026 Ricos Labs LLC",
  // The renderer is bundled by Vite and the main process needs only
  // Electron and Node built-ins once Steam is gone, so no node_modules ship.
  files: [
    ...base.files.filter((pattern) => !pattern.startsWith("node_modules/")),
    "!node_modules{,/**/*}",
  ],
  asarUnpack: [],
  mac: {
    ...base.mac,
    target: [{ target: "mas", arch: ["universal"] }],
    icon: "build/AppIcon.icon",
    category: "public.app-category.arcade-games",
    // Electron 41 supports macOS 12 and later.
    minimumSystemVersion: "12.0",
    hardenedRuntime: false,
    notarize: false,
    extendInfo: {
      // Chromium's TLS and the OS crypto only: exempt from export paperwork.
      ITSAppUsesNonExemptEncryption: false,
      // Electron names its sandboxed IPC channels after the app group.
      ElectronTeamID: "4BHY8H2J25",
    },
    artifactName: "Raptor-Runner-${version}-mas-${arch}.${ext}",
  },
  mas: {
    type: "distribution",
    hardenedRuntime: false,
    // An unsigned run only checks packaging: osx-sign cannot derive a team
    // from an ad-hoc identity, and productbuild needs the installer identity.
    ...(unsigned ? { identity: null } : {}),
    entitlements,
    entitlementsInherit,
    provisioningProfile: process.env.MAS_PROVISIONING_PROFILE || null,
    artifactName: "Raptor-Runner-${version}-mas-${arch}.${ext}",
  },
};
