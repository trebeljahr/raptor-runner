# Steam Cloud save mirror

The Steam desktop build mirrors durable localStorage keys into `save.json` under Electron’s `app.getPath("userData")`. Steam Auto-Cloud must be configured for that file separately; this code does not change Steamworks settings or call a cloud service.

At startup, a strictly newer supported snapshot is imported before game state loads. Existing progress without a sync timestamp wins over a remote snapshot. An unreadable, malformed, oversized, or unsupported file disables mirroring for that session so it cannot be overwritten by an older client.

Writes use the existing trusted native IPC gate, accept a bounded version-1 JSON envelope, and replace the file through a temporary file and rename. Durable writes trigger a two-second debounce; pagehide and beforeunload request a final flush. Shutdown IPC is best-effort, so localStorage remains the authoritative local save. A later launch retries from local progress.

Unit tests cover parsing, schema compatibility, import decisions, durable key allowlisting, round trips, bridge initialization, and unsupported/unreadable-file protection. Live synchronization between Steam installations requires a separate platform check.

## Steamworks settings (app 5035590)

Steamworks → App 5035590 → Steamworks Settings → Application → Steam Cloud. The values below must match `cloudSavePath()` in `electron/main.ts`; `app.setName("Raptor Runner")` fixes the folder name on every OS.

| Field | Value |
| --- | --- |
| Byte quota per user | `10485760` (10 MiB; the code refuses a `save.json` above 256 KiB) |
| Number of files allowed per user | `10` |
| Enable cloud support for developers only | Off |
| Enable Steam Cloud sync on system suspend and resume | Off. The game reads `save.json` once at startup, so it cannot take a file that changes mid-session. |
| Shared cloud App ID | `0` (none) |
| Auto-Cloud root | `WinAppDataRoaming`, subdirectory `Raptor Runner`, pattern `save.json`, All OSes, not recursive |
| Root override, macOS | `WinAppDataRoaming` → `MacAppSupport` (`~/Library/Application Support/Raptor Runner`) |
| Root override, Linux + SteamOS | `WinAppDataRoaming` → `LinuxXdgConfigHome` (`$XDG_CONFIG_HOME/Raptor Runner`, normally `~/.config/Raptor Runner`) |

The pattern is the exact file name, so Chromium's own files in the same folder (caches, Local Storage, `prefs.json`) and the `save.json.tmp` write file never sync.

`userData` is per OS user, not per Steam account. Two Steam accounts on one OS user share one `save.json`.

The store page's Supported Features → Steam Cloud tick box is a separate setting on the store page.
