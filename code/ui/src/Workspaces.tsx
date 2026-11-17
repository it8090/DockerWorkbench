import { useState } from "react";
import { rpc, errorValue } from "./bridge";
import { Dialog, ErrorPanel } from "./dialogs";
import { Icon } from "./Icon";
import { useI18n } from "./i18n";
import type { AppError, Connection, Workspace } from "./types";

export function WorkspaceDialog({
  workspaces,
  connections,
  activeId,
  onChanged,
  onClose,
}: {
  workspaces: Workspace[];
  connections: Connection[];
  activeId: string;
  onChanged: (selectedId?: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState(activeId);
  const [name, setName] = useState(
    workspaces.find((w) => w.id === activeId)?.name || t("defaultWorkspace"),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const members = connections.filter((c) => c.workspaceId === selectedId);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(errorValue(e));
    } finally {
      setBusy(false);
    }
  };
  const select = (w?: Workspace) => {
    setSelectedId(w?.id || "");
    setName(w ? w.name || t("defaultWorkspace") : "");
    setError(undefined);
    setConfirmDelete(false);
  };
  return (
    <Dialog
      title={t("manageWorkspaces")}
      subtitle={t("workspaceHelp")}
      className="workspace-dialog"
      onClose={() => !busy && onClose()}
      footer={
        <button disabled={busy} onClick={onClose}>
          {t("close")}
        </button>
      }
    >
      <div className="connection-layout">
        <aside className="connection-list">
          {workspaces.map((w) => (
            <button
              key={w.id}
              disabled={busy}
              className={w.id === selectedId ? "active" : ""}
              onClick={() => select(w)}
            >
              <Icon name="layers" />
              <span className="node-name">
                {w.name || t("defaultWorkspace")}
              </span>
              <span className="count">
                {connections.filter((c) => c.workspaceId === w.id).length}
              </span>
            </button>
          ))}
          <button
            disabled={busy}
            className={!selectedId ? "active" : ""}
            onClick={() => select()}
          >
            <Icon name="plus" />
            {t("newWorkspace")}
          </button>
        </aside>
        <div className="workspace-editor">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const saved = await rpc<Workspace>("workspaces.save", {
                  id: selectedId,
                  name,
                });
                await onChanged(selectedId ? undefined : saved.id);
                select(saved);
              });
            }}
          >
            <label className="field">
              <span>{t("workspaceName")}</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={60}
                disabled={busy}
              />
            </label>
            <div className="workspace-actions">
              <button
                type="submit"
                className="primary"
                disabled={busy || !name.trim()}
              >
                {t(selectedId ? "save" : "newWorkspace")}
              </button>
              {selectedId && selectedId !== "default" && (
                <button
                  type="button"
                  className="danger"
                  disabled={busy || members.length > 0}
                  onClick={() => setConfirmDelete(true)}
                >
                  {t("delete")}
                </button>
              )}
            </div>
            {selectedId && (
              <p className="form-hint">{t("workspaceDeleteHint")}</p>
            )}
          </form>
          {error && <ErrorPanel error={error} />}
          {selectedId && (
            <>
              <h3>
                {t("workspaceConnections")} · {members.length}
              </h3>
              <div className="workspace-members">
                {members.map((c) => (
                  <div className="workspace-member" key={c.id}>
                    <Icon name="host" />
                    <div>
                      <strong>{c.name}</strong>
                      <small>
                        {c.transport === "ssh"
                          ? `${c.ssh.user}@${c.ssh.host}`
                          : c.endpoint}
                      </small>
                    </div>
                    <select
                      aria-label={`${t("moveToWorkspace")} · ${c.name}`}
                      disabled={busy}
                      value={c.workspaceId}
                      onChange={(event) => {
                        const workspaceId = event.target.value;
                        void run(async () => {
                          await rpc("connections.move", {
                            id: c.id,
                            workspaceId,
                          });
                          await onChanged();
                        });
                      }}
                    >
                      {workspaces.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name || t("defaultWorkspace")}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                {!members.length && (
                  <div className="empty-state">{t("emptyWorkspace")}</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {confirmDelete && (
        <Dialog
          title={t("delete")}
          onClose={() => !busy && setConfirmDelete(false)}
          className="action-dialog"
          footer={
            <>
              <button disabled={busy} onClick={() => setConfirmDelete(false)}>
                {t("cancel")}
              </button>
              <button
                disabled={busy}
                className="danger primary"
                onClick={() =>
                  void run(async () => {
                    await rpc("workspaces.delete", { id: selectedId });
                    await onChanged(
                      selectedId === activeId ? "default" : undefined,
                    );
                    select(workspaces.find((w) => w.id === "default"));
                  })
                }
              >
                {t("delete")}
              </button>
            </>
          }
        >
          <div className="action-body">
            <strong>{name}</strong>
            <p>{t("workspaceDeleteHint")}</p>
            {error && <ErrorPanel error={error} />}
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}
