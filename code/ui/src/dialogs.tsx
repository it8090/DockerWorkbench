import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n, type TranslationKey } from "./i18n";
import { chooseFile, errorValue, openConfig, rpc, RpcError } from "./bridge";
import {
  newConnection,
  type AppError,
  type Binding,
  type Connection,
  type Engine,
  type Plan,
  type Secrets,
  type Workspace,
} from "./types";
import { Icon } from "./Icon";
import { parseConnectionFile } from "./utils";
import {
  connectionTestKey,
  needsConnectionTest,
  saveConnectionSettings,
} from "./connectionSettings";

export function Dialog({
  title,
  subtitle,
  onClose,
  children,
  footer,
  className = "",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useI18n();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={className}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          title={t("close")}
          aria-label={t("close")}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
      {footer && <div className="dialog-footer">{footer}</div>}
    </dialog>
  );
}
export function ErrorPanel({
  error,
  onClose,
}: {
  error: AppError;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const localized: Record<string, TranslationKey> = {
    desktop_required: "desktopRequired",
    host_key_unknown: "hostKeyUnknown",
    host_key_changed: "hostKeyChanged",
    read_only: "readOnlyBlocked",
    credentials_required: "credentialsRequired",
    vault_unavailable: "vaultUnavailable",
    compose_source_required: "composeSourceRequired",
    workspace_missing: "workspaceMissing",
    api_incompatible: "apiIncompatible",
    workspace_name_invalid: "workspaceNameInvalid",
    workspace_name_duplicate: "workspaceNameDuplicate",
    workspace_not_empty: "workspaceDeleteHint",
    workspace_default: "workspaceDeleteHint",
  };
  return (
    <div className="error-panel" role="alert">
      <div>
        <strong>
          {localized[error.code] ? t(localized[error.code]) : t("failed")}
        </strong>
        {onClose && (
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={t("closeError")}
          >
            <Icon name="close" />
          </button>
        )}
      </div>
      {error.code === "api_incompatible" && error.data?.requested && (
        <p>{t("apiIncompatibleRange", error.data)}</p>
      )}
      <details>
        <summary>{t("technicalDetails")}</summary>
        <pre>
          {error.code}
          {"\n"}
          {error.message}
          {error.data && "\n" + JSON.stringify(error.data, null, 2)}
        </pre>
      </details>
    </div>
  );
}
type ConnectionDialogProps = {
  connection?: Connection;
  connections: Connection[];
  workspaces: Workspace[];
  workspaceId: string;
  onClose: () => void;
  onSaved: (connection: Connection) => Promise<void>;
};
export function ConnectionDialog(props: ConnectionDialogProps) {
  const [selected, setSelected] = useState(props.connection);
  const [revision, setRevision] = useState(0);
  const [newWorkspaceId, setNewWorkspaceId] = useState(props.workspaceId);
  return (
    <ConnectionEditor
      {...props}
      key={`${selected?.id || "new"}:${revision}`}
      connection={selected}
      workspaceId={newWorkspaceId}
      onSelect={(connection, workspaceId) => {
        setSelected(connection);
        if (workspaceId) setNewWorkspaceId(workspaceId);
        setRevision((value) => value + 1);
      }}
      onSaved={async (connection) => {
        await props.onSaved(connection);
        setSelected(connection);
        setRevision((value) => value + 1);
      }}
    />
  );
}
function ConnectionEditor({
  connection,
  connections,
  workspaces,
  workspaceId,
  onSelect,
  onClose,
  onSaved,
}: ConnectionDialogProps & {
  onSelect: (connection?: Connection, workspaceId?: string) => void;
}) {
  const { t } = useI18n();
  const [initial] = useState<Connection>(() =>
    connection
      ? structuredClone(connection)
      : { ...newConnection(), workspaceId },
  );
  const [draft, setDraft] = useState<Connection>(initial);
  const [listWorkspace, setListWorkspace] = useState(
    connection?.workspaceId || workspaceId,
  );
  const [pendingNavigation, setPendingNavigation] = useState<
    (() => void) | null
  >(null);
  const [secrets, setSecrets] = useState<Secrets>({});
  const [remember, setRemember] = useState(false);
  const [manual, setManual] = useState(!!connection?.apiVersion);
  const [result, setResult] = useState<Engine>();
  const [proof, setProof] = useState("");
  const [error, setError] = useState<AppError>();
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [verified, setVerified] = useState(false);
  const fingerprint = connectionTestKey(draft, secrets);
  const params = { connection: draft, secrets, remember };
  const requiresTest = needsConnectionTest(params, connection, proof);
  useEffect(() => {
    setResult(undefined);
    setProof("");
    setError(undefined);
    setVerified(false);
  }, [fingerprint]);
  const update = <K extends keyof Connection>(key: K, value: Connection[K]) =>
    setDraft((old) => ({ ...old, [key]: value }));
  const ssh = (key: string, value: string | number | boolean) =>
    setDraft((old) => ({ ...old, ssh: { ...old.ssh, [key]: value } }));
  const secret = (key: keyof Secrets, value: string) =>
    setSecrets((old) => ({ ...old, [key]: value }));
  const test = async () => {
    if (busy || !formRef.current?.reportValidity()) return;
    setBusy(true);
    setError(undefined);
    try {
      const value = await rpc<Engine>("connections.test", {
        connection: draft,
        secrets,
        remember,
      });
      setResult(value);
      setProof(fingerprint);
    } catch (e) {
      setError(errorValue(e));
      setResult(undefined);
      setProof("");
    } finally {
      setBusy(false);
    }
  };
  const save = async (closeAfterSave: boolean) => {
    if (busy) return;
    if (!dirty && connection) {
      if (closeAfterSave) onClose();
      return;
    }
    if (!formRef.current?.reportValidity()) return;
    setBusy(true);
    setError(undefined);
    try {
      const saved = await saveConnectionSettings(params, connection, proof, {
        test: (value) => rpc<Engine>("connections.test", value),
        save: (value) => rpc<Connection>("connections.save", value),
      });
      await onSaved(saved.connection);
      if (closeAfterSave) onClose();
    } catch (e) {
      setError(errorValue(e));
    } finally {
      setBusy(false);
    }
  };
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(initial) ||
    Object.values(secrets).some(Boolean) ||
    remember ||
    manual !== !!initial.apiVersion;
  const navigate = (action: () => void) => {
    if (busy) return;
    if (dirty) setPendingNavigation(() => action);
    else action();
  };
  const pathField = (
    label: TranslationKey,
    value: string,
    set: (v: string) => void,
    required = false,
  ) => (
    <label className="field">
      <span>{t(label)}</span>
      <div className="path-input">
        <input
          value={value}
          onChange={(e) => set(e.target.value)}
          required={required}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => void chooseFile().then((path) => path && set(path))}
          aria-label={t("browse")}
          title={t("browse")}
        >
          <Icon name="image" />
        </button>
      </div>
    </label>
  );
  return (
    <>
      <Dialog
        title={t("connectionManager")}
        subtitle={t("connectionManagerHelp")}
        onClose={() => navigate(onClose)}
        className="connection-dialog connection-manager"
        footer={
          <>
            <span className="helper-text">
              {busy
                ? t("savingConnection")
                : requiresTest
                  ? t("testOnSave")
                  : dirty
                    ? t("readyToSave")
                    : t("noUnsavedChanges")}
            </span>
            <button disabled={busy} onClick={() => navigate(onClose)}>
              {t("close")}
            </button>
            <button onClick={() => void save(false)} disabled={busy || !dirty}>
              {t("apply")}
            </button>
            <button
              className="primary"
              onClick={() => void save(true)}
              disabled={busy}
            >
              {t("saveConnection")}
            </button>
          </>
        }
      >
        <div className="connection-layout">
          <aside className="connection-list">
            <label className="field">
              <span>{t("workspace")}</span>
              <select
                value={listWorkspace}
                onChange={(event) => setListWorkspace(event.target.value)}
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name || t("defaultWorkspace")}
                  </option>
                ))}
              </select>
            </label>
            <h3>
              {t("savedConnections")} ·{" "}
              {
                connections.filter((c) => c.workspaceId === listWorkspace)
                  .length
              }
            </h3>
            <nav aria-label={t("savedConnections")}>
              {connections
                .filter((c) => c.workspaceId === listWorkspace)
                .map((c) => (
                  <button
                    key={c.id}
                    disabled={busy}
                    className={c.id === connection?.id ? "active" : ""}
                    aria-current={c.id === connection?.id ? "true" : undefined}
                    onClick={() =>
                      c.id !== connection?.id && navigate(() => onSelect(c))
                    }
                    title={c.name}
                  >
                    <Icon name="host" />
                    <span className="connection-list-label">
                      <strong>{c.name}</strong>
                      <small>
                        {c.transport === "ssh"
                          ? `${c.ssh.user}@${c.ssh.host}`
                          : c.endpoint}
                      </small>
                    </span>
                  </button>
                ))}
            </nav>
            <button
              disabled={busy}
              className={!connection ? "active" : ""}
              onClick={() => navigate(() => onSelect(undefined, listWorkspace))}
            >
              <Icon name="plus" />
              {t("newConnection")}
            </button>
          </aside>
          <form
            ref={formRef}
            className="connection-form"
            onSubmit={(e) => {
              e.preventDefault();
              void test();
            }}
          >
            <fieldset disabled={busy}>
              <h3 className="connection-editor-title">
                {connection ? t("editConnection") : t("newConnection")}
              </h3>
              <p className="form-hint">{t("connectionHelp")}</p>
              <div className="inline-fields">
                <label className="field">
                  <span>{t("connectionName")}</span>
                  <input
                    value={draft.name}
                    onChange={(e) => update("name", e.target.value)}
                    required
                    autoFocus
                  />
                </label>
                <label className="field">
                  <span>{t("environment")}</span>
                  <select
                    value={draft.environment}
                    onChange={(e) => update("environment", e.target.value)}
                  >
                    {(
                      ["production", "staging", "development", "local"] as const
                    ).map((x) => (
                      <option key={x} value={x}>
                        {t(x)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="field">
                <span>{t("workspace")}</span>
                <select
                  value={draft.workspaceId}
                  onChange={(event) =>
                    update("workspaceId", event.target.value)
                  }
                >
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name || t("defaultWorkspace")}
                    </option>
                  ))}
                </select>
              </label>
              <div className="connection-tabs">
                {(["ssh", "unix", "npipe", "tls"] as const).map((type) => (
                  <button
                    type="button"
                    className={draft.transport === type ? "active" : ""}
                    key={type}
                    onClick={() =>
                      setDraft((old) => ({
                        ...old,
                        transport: type,
                        endpoint:
                          type === "unix"
                            ? "unix:///var/run/docker.sock"
                            : type === "npipe"
                              ? "npipe:////./pipe/docker_engine"
                              : type === "tls"
                                ? "https://"
                                : "",
                      }))
                    }
                  >
                    {type === "ssh"
                      ? t("ssh")
                      : type === "unix"
                        ? t("socket")
                        : type === "npipe"
                          ? "Windows Pipe"
                          : t("tls")}
                  </button>
                ))}
              </div>
              {draft.transport === "ssh" ? (
                <>
                  <div className="form-grid">
                    <label className="field">
                      <span>{t("host")}</span>
                      <input
                        value={draft.ssh.host}
                        onChange={(e) => ssh("host", e.target.value)}
                        required
                      />
                    </label>
                    <label className="field">
                      <span>{t("port")}</span>
                      <input
                        type="number"
                        min="1"
                        max="65535"
                        value={draft.ssh.port}
                        onChange={(e) => ssh("port", Number(e.target.value))}
                        required
                      />
                    </label>
                  </div>
                  <div className="inline-fields">
                    <label className="field">
                      <span>{t("username")}</span>
                      <input
                        value={draft.ssh.user}
                        onChange={(e) => ssh("user", e.target.value)}
                        required
                      />
                    </label>
                    <label className="field">
                      <span>{t("authentication")}</span>
                      <select
                        value={draft.ssh.auth}
                        onChange={(e) => ssh("auth", e.target.value)}
                      >
                        <option value="key">{t("privateKey")}</option>
                        <option value="password">{t("password")}</option>
                        <option value="agent">{t("agent")}</option>
                      </select>
                    </label>
                  </div>
                  {draft.ssh.auth === "key" && (
                    <>
                      {pathField(
                        "privateKeyPath",
                        draft.ssh.keyPath,
                        (v) => ssh("keyPath", v),
                        true,
                      )}
                      <label className="field">
                        <span>{t("passphrase")}</span>
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={secrets.passphrase || ""}
                          onChange={(e) => secret("passphrase", e.target.value)}
                        />
                      </label>
                    </>
                  )}
                  {draft.ssh.auth === "password" && (
                    <label className="field">
                      <span>{t("password")}</span>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={secrets.password || ""}
                        onChange={(e) => secret("password", e.target.value)}
                        placeholder={
                          draft.hasCredentials ? t("savedCredentials") : ""
                        }
                      />
                    </label>
                  )}
                  <label className="checkline">
                    <input
                      type="checkbox"
                      checked={draft.ssh.parseConfig}
                      onChange={(e) => ssh("parseConfig", e.target.checked)}
                    />
                    {t("parseConfig")}
                  </label>
                </>
              ) : (
                <label className="field">
                  <span>{t("endpoint")}</span>
                  <input
                    value={draft.endpoint}
                    onChange={(e) => update("endpoint", e.target.value)}
                    required
                  />
                </label>
              )}
              {draft.transport === "tls" && (
                <>
                  {pathField("caPath", draft.tls.caPath, (v) =>
                    update("tls", { ...draft.tls, caPath: v }),
                  )}
                  {pathField("certPath", draft.tls.certPath, (v) =>
                    update("tls", { ...draft.tls, certPath: v }),
                  )}
                  {pathField("clientKeyPath", draft.tls.keyPath, (v) =>
                    update("tls", { ...draft.tls, keyPath: v }),
                  )}
                </>
              )}
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                {t("remember")}
              </label>
              <p className="form-hint">
                {draft.hasCredentials
                  ? t("savedCredentials")
                  : t("sessionCredentials")}
              </p>
              <details>
                <summary>{t("advanced")}</summary>
                <div className="inline-fields">
                  <label className="field">
                    <span>{t("timeout")}</span>
                    <input
                      type="number"
                      min="1"
                      max="120"
                      value={draft.timeout}
                      onChange={(e) =>
                        update("timeout", Number(e.target.value))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t("keepAlive")}</span>
                    <input
                      type="number"
                      min="5"
                      max="600"
                      value={draft.keepAlive}
                      onChange={(e) =>
                        update("keepAlive", Number(e.target.value))
                      }
                    />
                  </label>
                </div>
                {draft.transport === "ssh" && (
                  <>
                    <label className="field">
                      <span>{t("socketPath")}</span>
                      <input
                        value={draft.ssh.socketPath}
                        onChange={(e) => ssh("socketPath", e.target.value)}
                      />
                    </label>
                    <div className="inline-fields">
                      <label className="field">
                        <span>{t("alias")}</span>
                        <input
                          value={draft.ssh.alias || ""}
                          onChange={(e) => ssh("alias", e.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>{t("jumpHost")}</span>
                        <input
                          value={draft.ssh.jumpHost || ""}
                          onChange={(e) => ssh("jumpHost", e.target.value)}
                        />
                      </label>
                    </div>
                    <label className="field">
                      <span>{t("proxy")}</span>
                      <select
                        value={draft.ssh.proxyType || "none"}
                        onChange={(e) => ssh("proxyType", e.target.value)}
                      >
                        <option value="none">{t("noProxy")}</option>
                        <option value="socks5">SOCKS5</option>
                        <option value="http">HTTP CONNECT</option>
                      </select>
                    </label>
                    {draft.ssh.proxyType && draft.ssh.proxyType !== "none" && (
                      <>
                        <label className="field">
                          <span>{t("proxyAddress")}</span>
                          <input
                            value={draft.ssh.proxyAddress || ""}
                            onChange={(e) =>
                              ssh("proxyAddress", e.target.value)
                            }
                          />
                        </label>
                        <div className="inline-fields">
                          <label className="field">
                            <span>{t("proxyUser")}</span>
                            <input
                              value={draft.ssh.proxyUser || ""}
                              onChange={(e) => ssh("proxyUser", e.target.value)}
                            />
                          </label>
                          <label className="field">
                            <span>{t("proxyPassword")}</span>
                            <input
                              type="password"
                              autoComplete="new-password"
                              value={secrets.proxyPassword || ""}
                              onChange={(e) =>
                                secret("proxyPassword", e.target.value)
                              }
                            />
                          </label>
                        </div>
                      </>
                    )}
                  </>
                )}
              </details>
              <details open>
                <summary>{t("apiMode")}</summary>
                <div className="inline-fields">
                  <select
                    aria-label={t("apiMode")}
                    value={manual ? "manual" : "auto"}
                    onChange={(e) => {
                      setManual(e.target.value === "manual");
                      update(
                        "apiVersion",
                        e.target.value === "auto" ? "" : "1.43",
                      );
                    }}
                  >
                    <option value="auto">{t("autoApi")}</option>
                    <option value="manual">{t("manualApi")}</option>
                  </select>
                  <input
                    aria-label={t("manualApi")}
                    value={draft.apiVersion}
                    disabled={!manual}
                    required={manual}
                    pattern={"1\\.\\d+"}
                    placeholder="1.43"
                    onChange={(e) => update("apiVersion", e.target.value)}
                  />
                </div>
                <p className="form-hint">{t("apiHint")}</p>
              </details>
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={draft.readOnly}
                  onChange={(e) => update("readOnly", e.target.checked)}
                />
                {t("readOnly")}
              </label>
              <p className="form-hint">
                {t(draft.readOnly ? "readOnlyHint" : "writeAccessWarning")}
              </p>
              <button type="submit" disabled={busy}>
                <Icon name="refresh" />
                {busy ? t("testing") : t("testConnection")}
              </button>
              {result && (
                <div className="connection-result">
                  <strong>{t("testPassed")}</strong>
                  <p>
                    Docker {result.version} · {result.os}/{result.arch}
                  </p>
                  <p>
                    {t("apiRange", {
                      min: result.minApi || "—",
                      max: result.serverApi,
                      selected: result.apiVersion,
                    })}
                  </p>
                </div>
              )}
              {error?.code === "host_key_unknown" ? (
                <div className="trust-panel">
                  <strong>{t("hostKeyUnknown")}</strong>
                  <p>{t("hostKeyVerify")}</p>
                  <code>
                    {error.data?.address}
                    <br />
                    {error.data?.fingerprint}
                  </code>
                  <label className="checkline">
                    <input
                      type="checkbox"
                      checked={verified}
                      onChange={(e) => setVerified(e.target.checked)}
                    />
                    {t("verifiedFingerprint")}
                  </label>
                  <button
                    type="button"
                    disabled={!verified || busy}
                    onClick={() => {
                      void rpc("host.trust", { token: error.data?.token })
                        .then(test)
                        .catch((e) => setError(errorValue(e)));
                    }}
                  >
                    {t("trustHost")}
                  </button>
                </div>
              ) : (
                error && <ErrorPanel error={error} />
              )}
            </fieldset>
          </form>
        </div>
      </Dialog>
      {pendingNavigation && (
        <Dialog
          title={t("discardChanges")}
          onClose={() => setPendingNavigation(null)}
          className="action-dialog"
          footer={
            <>
              <button onClick={() => setPendingNavigation(null)}>
                {t("keepEditing")}
              </button>
              <button
                className="danger"
                onClick={() => {
                  const action = pendingNavigation;
                  setPendingNavigation(null);
                  action();
                }}
              >
                {t("discard")}
              </button>
            </>
          }
        >
          <div className="action-body">{t("discardChangesHint")}</div>
        </Dialog>
      )}
    </>
  );
}
export function OperationDialog({
  plan,
  onClose,
  onExecute,
  busy,
}: {
  plan: Plan;
  onClose: () => void;
  onExecute: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const action = (
    ["start", "stop", "restart", "down", "pull", "up", "recreate"].includes(
      plan.action,
    )
      ? plan.action
      : "confirm"
  ) as TranslationKey;
  const warning =
    plan.action === "stop"
      ? "operationStopWarning"
      : plan.action === "restart"
        ? "operationRestartWarning"
        : plan.action === "down"
          ? "operationDownWarning"
          : plan.action === "start"
            ? "operationStartWarning"
            : "operationWarning";
  return (
    <Dialog
      title={t("confirmTargets")}
      subtitle={t("operationScope", {
        count: plan.targets.length,
        host: plan.host,
      })}
      onClose={onClose}
      className="action-dialog"
      footer={
        <>
          <button onClick={onClose} disabled={busy}>
            {t("cancel")}
          </button>
          <button
            className="danger primary"
            onClick={onExecute}
            disabled={busy}
          >
            {busy ? t("loading") : t("execute", { action: t(action) })}
          </button>
        </>
      }
    >
      <div className="action-body">
        <div className="impact-host">
          <strong>{plan.host}</strong>
          <div className="helper-text">{plan.connectionId}</div>
        </div>
        <p className="danger-note">{t(warning)}</p>
        {plan.binding && (
          <div className="form-hint">
            {plan.binding.workingDirectory}
            <br />
            {plan.binding.files.join(", ")}
          </div>
        )}
        <div className="impact-list">
          {plan.targets.map((c) => (
            <div key={c.id}>
              <span>{c.name}</span>
              <span>{t(c.state === "running" ? "running" : "stopped")}</span>
            </div>
          ))}
        </div>
        <p className="form-hint">{t("readiness")}</p>
      </div>
    </Dialog>
  );
}
export function ImportDialog({
  workspaceId,
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (count: number) => void;
  workspaceId: string;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<Connection[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const discover = async () => {
    setBusy(true);
    try {
      const values = await rpc<Connection[]>("connections.discover");
      setItems(values);
      setSelected(new Set(values.map((_, i) => i)));
    } catch (e) {
      setError(errorValue(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void discover();
  }, []);
  const readFile = async () => {
    try {
      const text = await openConfig();
      if (!text) return;
      const list = parseConnectionFile(text);
      setItems(list);
      setSelected(new Set(list.map((_, i) => i)));
    } catch (e) {
      setError(errorValue(e));
    }
  };
  return (
    <Dialog
      title={t("importPreview")}
      subtitle={t("duplicateSkipped")}
      onClose={onClose}
      className="import-dialog"
      footer={
        <>
          <button onClick={() => void readFile()}>{t("importFile")}</button>
          <button onClick={onClose}>{t("cancel")}</button>
          <button
            className="primary"
            disabled={busy || !selected.size}
            onClick={() => {
              setBusy(true);
              void rpc<Connection[]>("connections.import", {
                connections: items.filter((_, i) => selected.has(i)),
                workspaceId,
              })
                .then((result) => onImported(result.length))
                .catch((e) => setError(errorValue(e)))
                .finally(() => setBusy(false));
            }}
          >
            {t("importSelected")} ({selected.size})
          </button>
        </>
      }
    >
      <div className="action-body">
        <button disabled={busy} onClick={() => void discover()}>
          <Icon name="refresh" />
          {busy ? t("discovering") : t("discovery")}
        </button>
        {error && <ErrorPanel error={error} />}
        <div className="import-list">
          {items.map((item, i) => (
            <label key={i}>
              <input
                type="checkbox"
                checked={selected.has(i)}
                onChange={(e) =>
                  setSelected((old) => {
                    const next = new Set(old);
                    e.target.checked ? next.add(i) : next.delete(i);
                    return next;
                  })
                }
              />
              <div>
                <strong>{item.name}</strong>
                <small>
                  {item.transport === "ssh"
                    ? `${item.ssh.user}@${item.ssh.host}:${item.ssh.port}`
                    : item.endpoint}
                </small>
              </div>
              <span>{item.transport}</span>
            </label>
          ))}
          {!busy && !items.length && (
            <div className="empty-state">{t("noDiscovery")}</div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
export function BindingDialog({
  connectionId,
  project,
  existing,
  onClose,
  onSaved,
}: {
  connectionId: string;
  project: string;
  existing?: Binding;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [directory, setDirectory] = useState(existing?.workingDirectory || "");
  const [files, setFiles] = useState(
    existing?.files.join("\n") || "compose.yaml",
  );
  const [env, setEnv] = useState(existing?.envFiles.join("\n") || "");
  const [profiles, setProfiles] = useState(existing?.profiles.join("\n") || "");
  const [error, setError] = useState<AppError>();
  const lines = (v: string) =>
    v
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  return (
    <Dialog
      title={t("bindCompose")}
      subtitle={t("bindingHint")}
      onClose={onClose}
      className="action-dialog"
      footer={
        <>
          <button onClick={onClose}>{t("cancel")}</button>
          <button
            className="primary"
            disabled={!directory || !files}
            onClick={() => {
              void rpc("compose.bind", {
                connectionId,
                project,
                workingDirectory: directory,
                files: lines(files),
                envFiles: lines(env),
                profiles: lines(profiles),
              })
                .then(onSaved)
                .catch((e) => setError(errorValue(e)));
            }}
          >
            {t("save")}
          </button>
        </>
      }
    >
      <div className="action-body">
        <p className="mono">{project}</p>
        <label className="field">
          <span>{t("workingDirectory")}</span>
          <input
            value={directory}
            onChange={(e) => setDirectory(e.target.value)}
            placeholder="/opt/services/report"
          />
        </label>
        {(
          [
            ["composeFiles", files, setFiles],
            ["envFiles", env, setEnv],
            ["profiles", profiles, setProfiles],
          ] as const
        ).map(([key, value, set]) => (
          <label className="field" key={key}>
            <span>{t(key)}</span>
            <textarea
              rows={3}
              value={value}
              onChange={(e) => set(e.target.value)}
            />
          </label>
        ))}
        {error && <ErrorPanel error={error} />}
      </div>
    </Dialog>
  );
}
