# Steam Cloud save mirror

The Steam desktop build mirrors durable localStorage keys into `save.json` under Electron’s `app.getPath("userData")`. Steam Auto-Cloud must be configured for that file separately; this code does not change Steamworks settings or call a cloud service.

At startup, a strictly newer supported snapshot is imported before game state loads. Existing progress without a sync timestamp wins over a remote snapshot. An unreadable, malformed, oversized, or unsupported file disables mirroring for that session so it cannot be overwritten by an older client.

Writes use the existing trusted native IPC gate, accept a bounded version-1 JSON envelope, and replace the file through a temporary file and rename. Durable writes trigger a two-second debounce; pagehide and beforeunload request a final flush. Shutdown IPC is best-effort, so localStorage remains the authoritative local save. A later launch retries from local progress.

Unit tests cover parsing, schema compatibility, import decisions, durable key allowlisting, round trips, bridge initialization, and unsupported/unreadable-file protection. Live synchronization between Steam installations requires a separate platform check.
