import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useRef, useState } from "react";
import { desktop, rpc } from "./bridge";
import { Dialog } from "./dialogs";
import { useI18n } from "./i18n";
import { UpdateController, type UpdateState } from "./updater";
import { bytes } from "./utils";

export function Updates({ disabled }: { disabled: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState("");
  const [automatic, setAutomatic] = useState(true);
  const [preferenceReady, setPreferenceReady] = useState(false);
  const [preferenceError, setPreferenceError] = useState("");
  const [state, setState] = useState<UpdateState>({
    phase: "idle",
    received: 0,
  });
  const [controller] = useState(() => new UpdateController(setState));
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void getVersion().then((value) => active && setVersion(value));
    void rpc<Record<string, string>>("preferences.get")
      .then((preferences) => {
        if (active) {
          setAutomatic(preferences["updates.automatic"] !== "false");
          setPreferenceReady(true);
        }
      })
      .catch(() => active && setPreferenceError(t("updatePreferenceError")));
    return () => {
      active = false;
    };
  }, [t]);
  useEffect(() => {
    if (
      !desktop ||
      !preferenceReady ||
      !automatic ||
      autoStarted.current ||
      import.meta.env.DEV
    )
      return;
    const timer = setTimeout(() => {
      autoStarted.current = true;
      void controller.check();
    }, 5000);
    return () => clearTimeout(timer);
  }, [automatic, controller, preferenceReady]);
  if (!desktop) return null;
  const busy = ["checking", "downloading", "installing"].includes(state.phase);
  const locked = state.phase === "downloading" || state.phase === "installing";
  const saveAutomatic = async (value: boolean) => {
    try {
      await rpc("preferences.set", {
        key: "updates.automatic",
        value: String(value),
      });
      setAutomatic(value);
      setPreferenceError("");
    } catch {
      setPreferenceError(t("updatePreferenceError"));
    }
  };
  const phaseLabels = {
    idle: "updateReady",
    checking: "updateChecking",
    available: "updateAvailable",
    current: "updateCurrent",
    downloading: "updateDownloading",
    installing: "updateInstalling",
    installed: "updateInstalled",
    error: "updateFailed",
  } as const;
  return (
    <>
      <button
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={state.phase === "available" ? "update-available" : ""}
      >
        {state.phase === "available"
          ? t("updateAvailable")
          : t("softwareUpdates")}
      </button>
      {open && (
        <Dialog
          title={t("softwareUpdates")}
          subtitle={version ? t("updateVersion", { version }) : undefined}
          className="action-dialog update-dialog"
          onClose={() => {
            if (!locked) setOpen(false);
          }}
          footer={
            <>
              <button disabled={locked} onClick={() => setOpen(false)}>
                {t("close")}
              </button>
              {state.phase === "available" ? (
                <button
                  className="primary"
                  disabled={disabled || busy}
                  onClick={() => void controller.install()}
                >
                  {t("updateInstall")}
                </button>
              ) : state.phase === "installed" ? (
                <button
                  className="primary"
                  onClick={() => void controller.restart()}
                >
                  {t("updateRestart")}
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void controller.check()}
                >
                  {t("updateCheck")}
                </button>
              )}
            </>
          }
        >
          <div className="action-body update-body">
            <p role="status">
              <strong>
                {t(phaseLabels[state.phase])}
                {state.update ? ` · ${state.update.version}` : ""}
              </strong>
            </p>
            {state.update?.body && (
              <pre className="update-notes">{state.update.body}</pre>
            )}
            {locked && (
              <div>
                <progress
                  aria-label={t("updateDownloading")}
                  max={state.total || 1}
                  value={state.total ? state.received : undefined}
                />
                <p>
                  {bytes(state.received)}
                  {state.total ? ` / ${bytes(state.total)}` : ""}
                </p>
              </div>
            )}
            {state.error && (
              <p role="alert" className="update-error">
                {state.error}
              </p>
            )}
            {preferenceError && (
              <p role="alert" className="update-error">
                {preferenceError}
              </p>
            )}
            <label className="update-preference">
              <input
                type="checkbox"
                checked={automatic}
                disabled={!preferenceReady || locked}
                onChange={(event) => void saveAutomatic(event.target.checked)}
              />
              {t("updateAutomatic")}
            </label>
            <p className="helper-text">{t("updateHelp")}</p>
            <p className="helper-text">{t("updateRestartWarning")}</p>
          </div>
        </Dialog>
      )}
    </>
  );
}
