import * as React from "react";

type Game = NonNullable<Window["Game"]>;
type PreviewResult = ReturnType<Game["previewSaveImport"]>;
type Preview = Extract<PreviewResult, { ok: true }>["value"];

/** Browser-only local transfer. All save access goes through the public Game API. */
export function SaveSettings() {
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const [imported, setImported] = React.useState(false);
  const readGeneration = React.useRef(0);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const previewHeading = React.useRef<HTMLHeadingElement>(null);
  const status = window.Game?.getSaveBackupStatus();

  React.useEffect(
    () => () => {
      readGeneration.current += 1;
      window.Game?.cancelSaveImport();
    },
    [],
  );
  React.useEffect(() => {
    if (preview) previewHeading.current?.focus();
  }, [preview]);

  if (!status?.supported) return null;

  function cancel() {
    readGeneration.current += 1;
    window.Game?.cancelSaveImport();
    setPreview(null);
    setConfirmed(false);
    setBusy(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  function download() {
    setError("");
    setMessage("");
    const result = window.Game?.exportSaveBackup();
    if (!result?.ok) {
      setError(result?.error ?? "The game is still loading.");
      return;
    }
    let url: string | null = null;
    try {
      url = URL.createObjectURL(new Blob([result.value.text], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.value.filename;
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
      }
      setMessage("Backup download requested. Keep the JSON file somewhere safe.");
    } catch {
      setError("The browser could not download the backup. Try again.");
    } finally {
      if (url) {
        const downloadUrl = url;
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      }
    }
  }

  async function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    cancel();
    setError("");
    setMessage("");
    if (!file) return;
    const generation = ++readGeneration.current;
    if (file.size > (status?.maxFileBytes ?? 0)) {
      setError("Choose a Raptor Runner backup smaller than 64 KB.");
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      if (generation !== readGeneration.current) return;
      const result = window.Game?.previewSaveImport(text);
      if (result?.ok) setPreview(result.value);
      else setError(result?.error ?? "The game is still loading.");
    } catch {
      if (generation === readGeneration.current)
        setError("The file could not be read. Choose it again.");
    } finally {
      if (generation === readGeneration.current) setBusy(false);
    }
  }

  function replaceSave() {
    if (!preview || !confirmed || busy) return;
    setError("");
    setBusy(true);
    const result = window.Game?.confirmSaveImport(preview.token, confirmed);
    if (result?.ok) {
      setImported(true);
      setMessage("Backup imported. Reload to use the restored save.");
    } else {
      setError(result?.error ?? "The game is still loading.");
    }
    setPreview(null);
    setConfirmed(false);
    setBusy(false);
  }

  const canTransfer = status.available && status.canImport && !busy && !imported;
  return (
    <section className="save-settings" aria-label="Save backup" aria-busy={busy}>
      <p>{status.message}</p>
      <p>Files stay on your device. Importing does not upload anything.</p>
      {!status.canImport && !imported && !status.reloadRequired && (
        <p>Return to the home screen to export or import a save.</p>
      )}
      <div className="save-settings-actions">
        <button className="menu-item" type="button" disabled={!canTransfer} onClick={download}>
          Export save
        </button>
        <label className="save-settings-file">
          Preview a backup file
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            disabled={!canTransfer}
            onChange={chooseFile}
          />
        </label>
      </div>
      {busy && <p role="status">Reading backup…</p>}
      {preview && (
        <div className="save-settings-preview">
          <h3 ref={previewHeading} tabIndex={-1}>
            Review backup
          </h3>
          <p>Exported {new Date(preview.exportedAt).toLocaleString()}.</p>
          <table>
            <caption>Progress before and after import</caption>
            <thead>
              <tr>
                <th scope="col">Progress</th>
                <th scope="col">Current save</th>
                <th scope="col">Backup</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["bestMeters", "Best distance (m)"],
                  ["coins", "Wallet coins"],
                  ["runs", "Runs"],
                  ["achievements", "Achievements"],
                  ["cosmetics", "Owned cosmetics"],
                ] as const
              ).map(([key, label]) => (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  <td>{preview.current[key]}</td>
                  <td>{preview.incoming[key]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Import replaces all game progress and settings in this browser. Missing settings return
            to defaults. Export your current save first if you want to keep it. Close other game
            tabs before importing.
          </p>
          <label className="save-settings-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.currentTarget.checked)}
            />
            I understand this replaces my progress and settings.
          </label>
          <div className="save-settings-actions">
            <button className="menu-item" type="button" onClick={cancel}>
              Cancel import
            </button>
            <button
              className="menu-item"
              type="button"
              disabled={!confirmed || !canTransfer}
              onClick={replaceSave}
            >
              Replace save and reload
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {(imported || status.reloadRequired) && (
        <button className="menu-item" type="button" onClick={() => window.location.reload()}>
          Reload game
        </button>
      )}
    </section>
  );
}
