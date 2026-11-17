import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  desktop,
  errorValue,
  integratedTitlebar,
  rpc,
  saveText,
  setWindowTheme,
  subscribe,
} from "./bridge";
import { I18nContext, translator, type TranslationKey } from "./i18n";
import {
  BindingDialog,
  ConnectionDialog,
  Dialog,
  ErrorPanel,
  ImportDialog,
  OperationDialog,
} from "./dialogs";
import {
  ContainerTerminal,
  History,
  Inspect,
  Logs,
  ResourceStats,
} from "./Details";
import { Icon } from "./Icon";
import { WorkspaceDialog } from "./Workspaces";
import { Updates } from "./Updates";
import { bytes } from "./utils";
import type {
  AppError,
  Connection,
  Container,
  Language,
  Plan,
  Resource,
  Snapshot,
  Workspace,
} from "./types";

type View = {
  connectionId: string;
  project?: string;
  containerId?: string;
  category: "compose" | "containers" | "images" | "networks" | "volumes";
};
type Tab = "logs" | "inspect" | "stats" | "terminal" | "history";
const viewKey = (v: View) =>
  v.containerId
    ? `${v.connectionId}:container:${v.containerId}`
    : `${v.connectionId}:${v.category}:${v.project || ""}`;
export default function App() {
  const [language, setLanguage] = useState<Language>(
    navigator.language.startsWith("zh") ? "zh-CN" : "en",
  );
  const t = useMemo(() => translator(language), [language]);
  const [dark, setDark] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([
    { id: "default", name: "" },
  ]);
  const [activeWorkspace, setActiveWorkspace] = useState("default");
  const [workspaceDialog, setWorkspaceDialog] = useState(false);
  const workspaceConnections = connections.filter(
    (c) => c.workspaceId === activeWorkspace,
  );
  const workspaceName =
    workspaces.find((w) => w.id === activeWorkspace)?.name ||
    t("defaultWorkspace");
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});
  const [connecting, setConnecting] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<View>();
  const [tabs, setTabs] = useState<View[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<Tab>("logs");
  const [resourceRows, setResourceRows] = useState<Resource[]>([]);
  const [resourceInspect, setResourceInspect] = useState<Resource>();
  const [error, setError] = useState<AppError>();
  const [status, setStatus] = useState("ready");
  const [connectionDialog, setConnectionDialog] = useState<Connection | true>();
  const [importDialog, setImportDialog] = useState(false);
  const [bindingDialog, setBindingDialog] = useState(false);
  const [removeDialog, setRemoveDialog] = useState<Connection>();
  const [plan, setPlan] = useState<Plan>();
  const [operationBusy, setOperationBusy] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [command, setCommand] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [maximized, setMaximized] = useState(false);
  const [panelHeight, setPanelHeight] = useState(252);
  const [toast, setToast] = useState("");
  const [composeOutput, setComposeOutput] = useState<string>();
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const generation = useRef<Record<string, number>>({});
  const detailEvents = useRef<Record<string, () => void>>({});
  const pendingRefresh = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );
  const selectedRef = useRef<View | undefined>(selected);
  selectedRef.current = selected;
  const connection = workspaceConnections.find(
    (c) => c.id === selected?.connectionId,
  );
  const visibleTabs = tabs.filter((tab) =>
    workspaceConnections.some((c) => c.id === tab.connectionId),
  );
  const snapshot = selected ? snapshots[selected.connectionId] : undefined;
  const project = selected?.project;
  const container = snapshot?.containers.find(
    (c) => c.id === selected?.containerId,
  );
  const projectContainers = useMemo(
    () =>
      snapshot?.containers.filter((c) => !project || c.project === project) ||
      [],
    [snapshot, project],
  );
  const detailContainers = useMemo(
    () =>
      container ? [container] : selected?.containerId ? [] : projectContainers,
    [container, projectContainers, selected?.containerId],
  );
  const visibleContainers = useMemo(
    () =>
      projectContainers.filter(
        (c) =>
          filter === "all" ||
          (filter === "running"
            ? c.state === "running"
            : c.state !== "running"),
      ),
    [projectContainers, filter],
  );
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setToast(""), 3500);
  }, []);
  const loadConnections = useCallback(async () => {
    const cs = await rpc<Connection[]>("connections.list");
    setConnections(cs);
    return cs;
  }, []);
  const refresh = useCallback(async (id: string) => {
    const revision = (generation.current[id] || 0) + 1;
    generation.current[id] = revision;
    setConnecting((old) => new Set(old).add(id));
    setError(undefined);
    try {
      const data = await rpc<Snapshot>("resources.snapshot", {
        connectionId: id,
      });
      if (generation.current[id] === revision) {
        setSnapshots((old) => ({ ...old, [id]: data }));
        setStatus("ready");
      }
    } catch (e) {
      if (generation.current[id] === revision) {
        setError(errorValue(e));
        setStatus("connectionFailed");
      }
    } finally {
      if (generation.current[id] === revision)
        setConnecting((old) => {
          const next = new Set(old);
          next.delete(id);
          return next;
        });
    }
  }, []);
  const openView = (view: View) => {
    setSelected(view);
    setResourceInspect(undefined);
    setFilter("all");
    setExpanded((old) => new Set(old).add(view.connectionId));
    setTabs((old) =>
      old.some((v) => viewKey(v) === viewKey(view))
        ? old.map((v) => (viewKey(v) === viewKey(view) ? view : v))
        : [...old.slice(-11), view],
    );
  };
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  useEffect(() => {
    document.body.classList.toggle("dark", dark);
    void setWindowTheme(dark).catch((e) => setError(errorValue(e)));
  }, [dark]);
  useEffect(() => {
    if (!desktop) return;
    let mounted = true;
    void Promise.all([
      loadConnections(),
      rpc<Record<string, string>>("preferences.get"),
      rpc<Workspace[]>("workspaces.list"),
    ])
      .then(([cs, prefs, ws]) => {
        if (!mounted) return;
        if (prefs.language === "en" || prefs.language === "zh-CN")
          setLanguage(prefs.language);
        if (prefs.theme === "dark") setDark(true);
        if (prefs.layout) {
          try {
            const layout = JSON.parse(prefs.layout);
            if (typeof layout.panelHeight === "number")
              setPanelHeight(Math.max(110, Math.min(600, layout.panelHeight)));
          } catch {
            /* retain defaults */
          }
        }
        setWorkspaces(ws);
        const active = ws.some((w) => w.id === prefs.activeWorkspace)
          ? prefs.activeWorkspace
          : "default";
        setActiveWorkspace(active);
        const first = cs.find((c) => c.workspaceId === active);
        if (first) {
          setSelected({ connectionId: first.id, category: "containers" });
          setExpanded(new Set([first.id]));
        }
      })
      .catch((e) => mounted && setError(errorValue(e)));
    return () => {
      mounted = false;
      Object.values(detailEvents.current).forEach((stop) => stop());
      Object.values(pendingRefresh.current).forEach(clearTimeout);
    };
  }, [loadConnections]);
  useEffect(() => {
    if (!selected || !snapshot || detailEvents.current[selected.connectionId])
      return;
    const id = selected.connectionId;
    let closed = false;
    void subscribe("events.subscribe", { connectionId: id }, (event) => {
      if (closed) return;
      if (event.kind === "docker-event") {
        clearTimeout(pendingRefresh.current[id]);
        pendingRefresh.current[id] = setTimeout(() => void refresh(id), 600);
      }
    })
      .then((cancel) => {
        if (closed) cancel();
        else detailEvents.current[id] = cancel;
      })
      .catch((e) => setError(errorValue(e)));
    return () => {
      closed = true;
      detailEvents.current[id]?.();
      delete detailEvents.current[id];
    };
  }, [selected?.connectionId, !!snapshot, refresh]);
  useEffect(() => {
    if (
      !selected ||
      !snapshot ||
      !["images", "networks", "volumes"].includes(selected.category)
    ) {
      setResourceRows([]);
      return;
    }
    let valid = true;
    setResourceRows([]);
    void rpc<Resource[]>("resources.list", {
      connectionId: selected.connectionId,
      kind: selected.category,
    })
      .then((rows) => valid && setResourceRows(rows))
      .catch((e) => valid && setError(errorValue(e)));
    return () => {
      valid = false;
    };
  }, [selected?.connectionId, selected?.category, snapshot]);
  const changeLanguage = (value: Language) => {
    setLanguage(value);
    if (desktop)
      void rpc("preferences.set", { key: "language", value }).catch((e) =>
        setError(errorValue(e)),
      );
  };
  const toggleTheme = () => {
    setDark((v) => !v);
    if (desktop)
      void rpc("preferences.set", {
        key: "theme",
        value: dark ? "light" : "dark",
      }).catch((e) => setError(errorValue(e)));
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommand(true);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  const selectWorkspace = (id: string, cs = connections) => {
    setActiveWorkspace(id);
    const members = cs.filter((c) => c.workspaceId === id);
    const lastTab = tabs
      .filter((v) => members.some((c) => c.id === v.connectionId))
      .at(-1);
    setSelected(
      lastTab ||
        (members[0]
          ? { connectionId: members[0].id, category: "containers" }
          : undefined),
    );
    setResourceInspect(undefined);
    setQuery("");
    setCommandQuery("");
    setFilter("all");
    setDetail("logs");
    setMaximized(false);
    if (desktop)
      void rpc("preferences.set", { key: "activeWorkspace", value: id }).catch(
        (e) => setError(errorValue(e)),
      );
  };
  const workspacesChanged = async (id?: string) => {
    const [ws, cs] = await Promise.all([
      rpc<Workspace[]>("workspaces.list"),
      loadConnections(),
    ]);
    setWorkspaces(ws);
    if (
      id ||
      !cs.some(
        (c) =>
          c.id === selected?.connectionId && c.workspaceId === activeWorkspace,
      )
    )
      selectWorkspace(id || activeWorkspace, cs);
  };
  const connectionSaved = async (c: Connection) => {
    const cs = await loadConnections();
    selectWorkspace(c.workspaceId, cs);
    setSnapshots((old) => {
      const next = { ...old };
      delete next[c.id];
      return next;
    });
    openView({ connectionId: c.id, category: "containers" });
    void refresh(c.id);
    notify(t("connectionSaved"));
  };
  const beginOperation = async (action: string, ids?: string[]) => {
    if (!connection) return;
    if (connection.readOnly) {
      setError({ code: "read_only", message: t("readOnlyBlocked") });
      return;
    }
    setOperationBusy(true);
    try {
      const p = await rpc<Plan>("operations.plan", {
        connectionId: connection.id,
        action,
        containerIds: ids || detailContainers.map((c) => c.id),
      });
      setPlan(p);
    } catch (e) {
      setError(errorValue(e));
    } finally {
      setOperationBusy(false);
    }
  };
  const execute = async () => {
    if (!plan) return;
    setOperationBusy(true);
    const approved = plan;
    setPlan(undefined);
    let failed = false;
    let unknown = false;
    let output = "";
    let stop: (() => void) | undefined;
    try {
      if (approved.binding) setComposeOutput("");
      setDetail("history");
      stop = await subscribe(
        approved.binding ? "compose.execute" : "operations.execute",
        { token: approved.token },
        (event) => {
          if (event.kind === "compose-output") {
            output = (output + String(event.data)).slice(-4 * 1024 * 1024);
            setComposeOutput(output);
          }
          if (event.kind === "operation") {
            const result = event.data as import("./types").Operation;
            if (result.status !== "succeeded") failed = true;
            if (result.status === "unknown") unknown = true;
            setHistoryRevision((n) => n + 1);
          }
          if (event.kind === "end") {
            setOperationBusy(false);
            setHistoryRevision((n) => n + 1);
            void refresh(approved.connectionId);
            if (event.error) {
              setError(event.error);
              failed = true;
            }
            notify(
              t(
                unknown
                  ? "operationUnknown"
                  : failed
                    ? "operationFailed"
                    : "operationDone",
              ),
            );
            queueMicrotask(() => stop?.());
          }
        },
      );
      setHistoryRevision((n) => n + 1);
    } catch (e) {
      setError(errorValue(e));
      setOperationBusy(false);
    }
  };

  const composeAction = async (action: string) => {
    if (!connection || !project) return;
    if (!snapshot?.bindings.some((b) => b.project === project)) {
      setBindingDialog(true);
      notify(t("composeSourceRequired"));
      return;
    }
    setOperationBusy(true);
    try {
      setPlan(
        await rpc<Plan>("compose.plan", {
          connectionId: connection.id,
          project,
          action,
        }),
      );
    } catch (e) {
      setError(errorValue(e));
    } finally {
      setOperationBusy(false);
    }
  };
  const toggle = (key: string) =>
    setExpanded((old) => {
      const next = new Set(old);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const selectHost = (c: Connection) => {
    openView({ connectionId: c.id, category: "containers" });
    if (!snapshots[c.id]) void refresh(c.id);
  };
  const endpoint = (c: Connection) =>
    c.transport === "ssh"
      ? `${c.ssh.user}@${c.ssh.host}:${c.ssh.port}`
      : c.endpoint;
  const stateLabel = (value: string) =>
    t(
      ([
        "running",
        "paused",
        "restarting",
        "created",
        "exited",
        "dead",
      ].includes(value)
        ? value
        : "stopped") as TranslationKey,
    );
  const tableCategory =
    selected && ["images", "networks", "volumes"].includes(selected.category);
  const selectedTitle =
    container?.name ||
    (selected?.category === "compose"
      ? project || t("noProject")
      : selected
        ? t(
            selected.category === "containers"
              ? "allContainers"
              : selected.category,
          )
        : t("noSelection"));
  const matchingConnections = workspaceConnections.filter(
    (c) =>
      !query ||
      `${c.name} ${endpoint(c)}`.toLowerCase().includes(query.toLowerCase()) ||
      snapshots[c.id]?.containers.some((x) =>
        `${x.project} ${x.service} ${x.name}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
  );
  const commandResults = workspaceConnections
    .flatMap((c) =>
      (snapshots[c.id]?.containers || [])
        .filter((x) =>
          `${x.name} ${x.project} ${c.name}`
            .toLowerCase()
            .includes(commandQuery.toLowerCase()),
        )
        .map((container) => ({ connection: c, container })),
    )
    .slice(0, 50);
  const setListHeight = (height: number) => {
    const max = Math.max(
      110,
      (document.querySelector("main")?.clientHeight || 650) - 240,
    );
    setPanelHeight(Math.max(110, Math.min(height, max)));
  };
  return (
    <I18nContext.Provider value={{ language, t }}>
      <div
        id="app"
        className={`desktop-app${integratedTitlebar ? " integrated-titlebar" : ""}`}
      >
        <header
          className="appbar"
          data-tauri-drag-region={integratedTitlebar ? "deep" : undefined}
        >
          <div className="appbar-center">
            {t("workspace")} <span>/</span> {workspaceName}
          </div>
          <button className="command-button" onClick={() => setCommand(true)}>
            <Icon name="search" />
            <span>{t("globalSearch")}</span>
            <kbd>{navigator.platform.includes("Mac") ? "⌘" : "Ctrl"} K</kbd>
          </button>
          <select
            className="language-select"
            aria-label={t("language")}
            value={language}
            onChange={(e) => changeLanguage(e.target.value as Language)}
          >
            <option value="zh-CN">中文</option>
            <option value="en">English</option>
          </select>
          <button
            className="icon-button"
            onClick={toggleTheme}
            title={t("theme")}
            aria-label={t("theme")}
          >
            <Icon name="theme" />
          </button>
          <button className="primary" onClick={() => setConnectionDialog(true)}>
            <Icon name="plus" />
            {t("addConnection")}
          </button>
        </header>
        {!desktop && (
          <div className="prototype-notice">
            <strong>{t("desktopRequired")}</strong>
            <span>{t("desktopRequiredDetail")}</span>
          </div>
        )}
        <div className="workspace">
          <aside className="sidebar">
            <div className="sidebar-heading">
              <strong>{t("resources")}</strong>
              <div>
                <button
                  className="icon-button"
                  disabled={!connection || connecting.has(connection.id)}
                  title={t("refresh")}
                  onClick={() => connection && void refresh(connection.id)}
                >
                  <Icon name="refresh" />
                </button>
                <button
                  className="icon-button"
                  title={t("collapseAll")}
                  onClick={() => setExpanded(new Set())}
                >
                  <Icon name="collapse" />
                </button>
              </div>
            </div>
            <div className="workspace-picker">
              <label className="field">
                <span>{t("currentWorkspace")}</span>
                <select
                  aria-label={t("currentWorkspace")}
                  value={activeWorkspace}
                  onChange={(event) => selectWorkspace(event.target.value)}
                >
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name || t("defaultWorkspace")}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="icon-button"
                title={t("manageWorkspaces")}
                aria-label={t("manageWorkspaces")}
                onClick={() => setWorkspaceDialog(true)}
              >
                <Icon name="settings" />
              </button>
            </div>
            <label className="searchbox">
              <Icon name="search" />
              <input
                aria-label={t("search")}
                placeholder={t("search")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="tree-caption">
              <span>{t("connections")}</span>
              <span>{workspaceConnections.length}</span>
            </div>
            <nav className="resource-tree" aria-label={t("resources")}>
              {matchingConnections.map((c) => {
                const snap = snapshots[c.id];
                const projects = [
                  ...new Set(
                    snap?.containers.map((v) => v.project).filter(Boolean),
                  ),
                ].sort();
                const hostOpen = expanded.has(c.id) || !!query;
                return (
                  <div key={c.id}>
                    <div className="host-node-wrap">
                      <button
                        className={`tree-node host ${selected?.connectionId === c.id && !selected.project ? "selected" : ""}`}
                        title={endpoint(c)}
                        onClick={() => selectHost(c)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setConnectionDialog(c);
                        }}
                      >
                        <span
                          className="chevron"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(c.id);
                          }}
                        >
                          {hostOpen ? "⌄" : "›"}
                        </span>
                        <Icon name="host" />
                        <span className="host-label">
                          <strong>{c.name}</strong>
                          <small>{endpoint(c)}</small>
                        </span>
                        <span
                          className={`state-dot ${snap ? "" : "stopped"} ${connecting.has(c.id) ? "connecting" : ""}`}
                        />
                      </button>
                      <button
                        className="host-settings"
                        aria-label={`${t("editConnection")} ${c.name}`}
                        onClick={() => setConnectionDialog(c)}
                      >
                        <Icon name="settings" />
                      </button>
                    </div>
                    {hostOpen && snap && (
                      <>
                        {projects
                          .filter(
                            (p) =>
                              !query ||
                              `${c.name} ${endpoint(c)} ${p}`
                                .toLowerCase()
                                .includes(query.toLowerCase()) ||
                              snap.containers.some(
                                (x) =>
                                  x.project === p &&
                                  x.name
                                    .toLowerCase()
                                    .includes(query.toLowerCase()),
                              ),
                          )
                          .map((p) => {
                            const members = snap.containers.filter(
                              (x) => x.project === p,
                            );
                            const opened =
                              expanded.has(`${c.id}:${p}`) || !!query;
                            return (
                              <div key={p}>
                                <button
                                  className={`tree-node project ${selected?.connectionId === c.id && selected.project === p && !container ? "selected" : ""}`}
                                  onClick={() => {
                                    openView({
                                      connectionId: c.id,
                                      project: p,
                                      category: "compose",
                                    });
                                    setExpanded((old) =>
                                      new Set(old).add(`${c.id}:${p}`),
                                    );
                                  }}
                                >
                                  <span
                                    className="chevron"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggle(`${c.id}:${p}`);
                                    }}
                                  >
                                    {opened ? "⌄" : "›"}
                                  </span>
                                  <Icon name="stack" />
                                  <span className="node-name">{p}</span>
                                  <span className="node-count">
                                    {
                                      members.filter(
                                        (x) => x.state === "running",
                                      ).length
                                    }
                                    /{members.length}
                                  </span>
                                </button>
                                {opened &&
                                  members
                                    .filter(
                                      (x) =>
                                        !query ||
                                        `${p} ${x.name}`
                                          .toLowerCase()
                                          .includes(query.toLowerCase()),
                                    )
                                    .map((x) => (
                                      <button
                                        className={`tree-node container ${container?.id === x.id ? "selected" : ""}`}
                                        key={x.id}
                                        onClick={() =>
                                          openView({
                                            connectionId: c.id,
                                            project: p,
                                            category: "compose",
                                            containerId: x.id,
                                          })
                                        }
                                        title={`${x.service} / ${x.name}`}
                                      >
                                        <Icon name="container" />
                                        <span className="node-name">
                                          {x.name}
                                        </span>
                                        <span
                                          className={`state-dot ${x.state === "running" ? "" : "stopped"}`}
                                        />
                                      </button>
                                    ))}
                              </div>
                            );
                          })}
                        {(
                          [
                            "containers",
                            "images",
                            "networks",
                            "volumes",
                          ] as const
                        ).map((kind, i) => (
                          <button
                            className={`tree-node category ${selected?.connectionId === c.id && selected.category === kind ? "selected" : ""}`}
                            key={kind}
                            onClick={() => {
                              openView({ connectionId: c.id, category: kind });
                              if (kind !== "containers") setDetail("inspect");
                            }}
                          >
                            <Icon
                              name={["layers", "image", "network", "volume"][i]}
                            />
                            {t(kind === "containers" ? "allContainers" : kind)}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                );
              })}
            </nav>
            <div className="sidebar-bottom">
              <button
                onClick={() =>
                  setConnectionDialog(
                    connection || workspaceConnections[0] || true,
                  )
                }
              >
                <Icon name="settings" />
                {t("connectionManager")}
              </button>
              <button onClick={() => setImportDialog(true)}>
                <Icon name="import" />
                {t("importConnections")}
              </button>
              <button
                onClick={() =>
                  void rpc<Connection[]>("connections.export")
                    .then((values) =>
                      saveText(
                        "docker-connections.json",
                        JSON.stringify(
                          {
                            version: 1,
                            connections: values.filter(
                              (c) => c.workspaceId === activeWorkspace,
                            ),
                          },
                          null,
                          2,
                        ),
                      ),
                    )
                    .then(() => notify(t("exportNotice")))
                    .catch((e) => setError(errorValue(e)))
                }
              >
                <Icon name="download" />
                {t("exportConnections")}
              </button>
            </div>
          </aside>
          <main id="main" className={maximized ? "maximized" : ""}>
            <div className="workspace-tabs">
              {visibleTabs.length ? (
                visibleTabs.map((tab) => (
                  <div
                    className={`workspace-tab ${selected && viewKey(selected) === viewKey(tab) ? "active" : ""}`}
                    key={viewKey(tab)}
                  >
                    <button
                      onClick={() => {
                        setSelected(tab);
                        setResourceInspect(undefined);
                      }}
                    >
                      <Icon
                        name={tab.category === "compose" ? "stack" : "host"}
                      />
                      {snapshots[tab.connectionId]?.containers.find(
                        (c) => c.id === tab.containerId,
                      )?.name ||
                        tab.project ||
                        `${connections.find((c) => c.id === tab.connectionId)?.name || ""} · ${t(tab.category === "containers" ? "allContainers" : tab.category)}`}
                    </button>
                    <button
                      className="tab-close"
                      onClick={() => {
                        setTabs((old) =>
                          old.filter((v) => viewKey(v) !== viewKey(tab)),
                        );
                        if (selected && viewKey(selected) === viewKey(tab)) {
                          const others = visibleTabs.filter(
                            (v) => viewKey(v) !== viewKey(tab),
                          );
                          setSelected(others.at(-1));
                        }
                      }}
                      aria-label={t("close")}
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                ))
              ) : (
                <span className="empty-workspace-label">{t("workspace")}</span>
              )}
              <div className="workspace-fill" />
              <button
                className="plain-button"
                onClick={() => setDetail("history")}
              >
                <Icon name="history" />
                {t("history")}
              </button>
            </div>
            {error && (
              <ErrorPanel error={error} onClose={() => setError(undefined)} />
            )}
            {!workspaceConnections.length ? (
              <div className="welcome">
                <div className="welcome-mark">
                  <Icon name="host" />
                </div>
                <h1>{t("emptyConnections")}</h1>
                <p>{t("emptyConnectionsDetail")}</p>
                <div>
                  <button
                    className="primary"
                    onClick={() => setConnectionDialog(true)}
                  >
                    <Icon name="plus" />
                    {t("addConnection")}
                  </button>
                  <button onClick={() => setImportDialog(true)}>
                    <Icon name="import" />
                    {t("importConnections")}
                  </button>
                </div>
                {!desktop && <p className="muted">pnpm desktop:dev</p>}
              </div>
            ) : !connection ? (
              <div className="empty-state">{t("noSelection")}</div>
            ) : (
              <>
                <div className="resource-header">
                  <div className="breadcrumb">
                    <Icon name="host" />
                    <span>{connection.name}</span>
                    <span className="slash">/</span>
                    <span>{selectedTitle}</span>
                  </div>
                  <div className="resource-title-row">
                    <div className="resource-title">
                      <span className="large-icon">
                        <Icon name={project ? "stack" : "host"} />
                      </span>
                      <div>
                        <h1 title={selectedTitle}>{selectedTitle}</h1>
                        <p>{project ? t("compose") : endpoint(connection)}</p>
                      </div>
                      <span className="environment-badge">
                        {t(
                          ([
                            "production",
                            "staging",
                            "development",
                            "local",
                          ].includes(connection.environment)
                            ? connection.environment
                            : "development") as TranslationKey,
                        )}
                      </span>
                    </div>
                    <div className="object-actions">
                      {snapshot && !tableCategory && (
                        <>
                          <button
                            disabled={
                              operationBusy ||
                              connection.readOnly ||
                              !detailContainers.length
                            }
                            onClick={() => void beginOperation("start")}
                          >
                            <Icon name="play" />
                            {t(container ? "start" : "startAll")}
                          </button>
                          <button
                            disabled={
                              operationBusy ||
                              connection.readOnly ||
                              !detailContainers.length
                            }
                            onClick={() => void beginOperation("restart")}
                          >
                            <Icon name="refresh" />
                            {t("restart")}
                          </button>
                          <button
                            className="danger"
                            disabled={
                              operationBusy ||
                              connection.readOnly ||
                              !detailContainers.length
                            }
                            onClick={() => void beginOperation("stop")}
                          >
                            <Icon name="stop" />
                            {t("stop")}
                          </button>
                          {project && (
                            <details className="compose-menu">
                              <summary>Compose ▾</summary>
                              <div>
                                <button onClick={() => setBindingDialog(true)}>
                                  {t("bindCompose")}
                                </button>
                                {(
                                  ["pull", "up", "recreate", "down"] as const
                                ).map((action) => (
                                  <button
                                    key={action}
                                    disabled={
                                      connection.readOnly || operationBusy
                                    }
                                    className={
                                      action === "down" ? "danger" : ""
                                    }
                                    onClick={() => void composeAction(action)}
                                  >
                                    {t(action)}
                                  </button>
                                ))}
                              </div>
                            </details>
                          )}
                        </>
                      )}
                      <button
                        onClick={() => setConnectionDialog(connection)}
                        title={t("editConnection")}
                      >
                        <Icon name="settings" />
                      </button>
                      <button
                        disabled={connecting.has(connection.id)}
                        onClick={() => void refresh(connection.id)}
                      >
                        <Icon name="refresh" />
                        {connecting.has(connection.id)
                          ? t("connecting")
                          : t(snapshot ? "refresh" : "connect")}
                      </button>
                    </div>
                  </div>
                  <div className="resource-summary">
                    <span className={`pill ${snapshot ? "" : "stopped"}`}>
                      <i className="status-dot" />
                      {snapshot ? t("connected") : t("disconnected")}
                    </span>
                    <span className="summary-separator" />
                    <span>
                      {t("running")}{" "}
                      {
                        projectContainers.filter((c) => c.state === "running")
                          .length
                      }{" "}
                      / {projectContainers.length}
                    </span>
                    <span className="summary-separator" />
                    <span className="mono">
                      API {snapshot?.engine.apiVersion || "—"} ·{" "}
                      {t(connection.apiVersion ? "manualApi" : "autoApi")}
                    </span>
                    <span
                      className={`access-tag ${connection.readOnly ? "read-only" : ""}`}
                    >
                      <Icon name="lock" />
                      {t(connection.readOnly ? "readOnly" : "readWrite")}
                    </span>
                    {project && (
                      <button
                        className="source-binding"
                        onClick={() => setBindingDialog(true)}
                      >
                        {t(
                          snapshot?.bindings.some((b) => b.project === project)
                            ? "sourceBound"
                            : "sourceMissing",
                        )}
                      </button>
                    )}
                    <button
                      className="plain-button small"
                      onClick={() => {
                        void rpc("connections.disconnect", {
                          id: connection.id,
                        });
                        detailEvents.current[connection.id]?.();
                        delete detailEvents.current[connection.id];
                        setSnapshots((old) => {
                          const v = { ...old };
                          delete v[connection.id];
                          return v;
                        });
                      }}
                    >
                      {t("disconnect")}
                    </button>
                    <button
                      className="plain-button small danger"
                      onClick={() => setRemoveDialog(connection)}
                    >
                      {t("deleteConnection")}
                    </button>
                  </div>
                </div>
                <section
                  className="resource-panel"
                  style={{ height: panelHeight, maxHeight: "48%" }}
                >
                  <div className="panel-toolbar">
                    <div className="resource-filters">
                      {!tableCategory ? (
                        (["all", "running", "stopped"] as const).map(
                          (value) => (
                            <button
                              key={value}
                              className={`filter-chip ${filter === value ? "active" : ""}`}
                              onClick={() => setFilter(value)}
                            >
                              {t(value)}{" "}
                              <span>
                                {value === "all"
                                  ? projectContainers.length
                                  : projectContainers.filter((c) =>
                                      value === "running"
                                        ? c.state === "running"
                                        : c.state !== "running",
                                    ).length}
                              </span>
                            </button>
                          ),
                        )
                      ) : (
                        <span className="helper-text">
                          {resourceRows.length} {selectedTitle}
                        </span>
                      )}
                    </div>
                    <div className="toolbar-end">
                      <span className="helper-text">{container?.name}</span>
                      <button
                        className="icon-button"
                        title={t("viewProjectLogs")}
                        onClick={() =>
                          selected &&
                          openView({ ...selected, containerId: undefined })
                        }
                      >
                        <Icon name="layers" />
                      </button>
                    </div>
                  </div>
                  <div className="table-scroll">
                    {tableCategory ? (
                      <table>
                        <thead>
                          <tr>
                            <th>{t("name")}</th>
                            <th>{t("id")}</th>
                            <th>{t("driver")}</th>
                            <th>{t("size")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {resourceRows.map((r, i) => (
                            <tr
                              key={String(r.ID || r.Id || r.Name || i)}
                              onClick={() => {
                                setResourceInspect(r);
                                setDetail("inspect");
                              }}
                            >
                              <td className="mono">
                                {r.Name ||
                                  r.RepoTags?.join(", ") ||
                                  r.ID ||
                                  r.Id}
                              </td>
                              <td className="metric-cell">
                                {String(r.ID || r.Id || "").slice(0, 18)}
                              </td>
                              <td>{r.Driver || "—"}</td>
                              <td>{r.Size ? bytes(r.Size) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <table>
                        <thead>
                          <tr>
                            <th>{t("container")}</th>
                            <th>{t("state")}</th>
                            <th>{t("image")}</th>
                            <th>{t("ports")}</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {visibleContainers.map((c) => (
                            <tr
                              key={c.id}
                              className={
                                container?.id === c.id ? "selected" : ""
                              }
                              tabIndex={0}
                              aria-label={c.name}
                              onClick={() =>
                                openView({ ...selected!, containerId: c.id })
                              }
                              onKeyDown={(e) =>
                                e.key === "Enter" &&
                                openView({ ...selected!, containerId: c.id })
                              }
                            >
                              <td>
                                <div className="service-name">
                                  <Icon name="container" />
                                  {c.name}
                                </div>
                              </td>
                              <td>
                                <span
                                  className={`running-state ${c.state === "running" ? "" : "stopped"}`}
                                >
                                  <i className="status-dot" />
                                  {stateLabel(c.state)}
                                </span>
                              </td>
                              <td className="image-cell" title={c.image}>
                                {c.image}
                              </td>
                              <td className="metric-cell">
                                {c.ports.join(", ") || "—"}
                              </td>
                              <td>
                                <button
                                  className="row-action"
                                  disabled={
                                    connection.readOnly || operationBusy
                                  }
                                  title={t(
                                    c.state === "running" ? "restart" : "start",
                                  )}
                                  aria-label={`${t(c.state === "running" ? "restart" : "start")} ${c.name}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void beginOperation(
                                      c.state === "running"
                                        ? "restart"
                                        : "start",
                                      [c.id],
                                    );
                                  }}
                                >
                                  <Icon
                                    name={
                                      c.state === "running" ? "refresh" : "play"
                                    }
                                  />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {snapshot &&
                      !tableCategory &&
                      !visibleContainers.length && (
                        <div className="empty-state">
                          {t("emptyContainers")}
                        </div>
                      )}
                    {!snapshot && (
                      <div className="empty-state">
                        {t(
                          connecting.has(connection.id)
                            ? "connecting"
                            : "disconnected",
                        )}
                      </div>
                    )}
                  </div>
                </section>
                <div
                  className="split-handle"
                  role="separator"
                  tabIndex={0}
                  aria-label={t("layoutReset")}
                  aria-orientation="horizontal"
                  aria-valuenow={panelHeight}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                      e.preventDefault();
                      setListHeight(
                        panelHeight + (e.key === "ArrowUp" ? -20 : 20),
                      );
                    }
                  }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    const node = e.currentTarget,
                      start = e.clientY,
                      height = panelHeight;
                    node.setPointerCapture(e.pointerId);
                    let latest = height;
                    const move = (event: PointerEvent) => {
                      latest = height + event.clientY - start;
                      setListHeight(latest);
                    };
                    const done = () => {
                      node.removeEventListener("pointermove", move);
                      node.removeEventListener("pointerup", done);
                      node.removeEventListener("pointercancel", done);
                      void rpc("preferences.set", {
                        key: "layout",
                        value: JSON.stringify({
                          panelHeight: Math.max(110, Math.min(600, latest)),
                        }),
                      }).catch(() => {});
                    };
                    node.addEventListener("pointermove", move);
                    node.addEventListener("pointerup", done);
                    node.addEventListener("pointercancel", done);
                  }}
                >
                  <span />
                </div>
                <section className="detail-panel">
                  <div className="detail-header">
                    <div className="detail-tabs">
                      {(
                        [
                          "logs",
                          "inspect",
                          "stats",
                          "terminal",
                          "history",
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab}
                          className={detail === tab ? "active" : ""}
                          onClick={() => setDetail(tab)}
                        >
                          {t(tab)}
                        </button>
                      ))}
                    </div>
                    <span className="detail-target">
                      {container?.name || project || connection.name}
                    </span>
                    <button
                      className="icon-button"
                      onClick={() => setMaximized((v) => !v)}
                      title={t("details")}
                    >
                      <Icon name="maximize" />
                    </button>
                  </div>
                  <div className="detail-content">
                    {detail === "history" ? (
                      <History
                        revision={historyRevision}
                        connectionIds={workspaceConnections.map((c) => c.id)}
                      />
                    ) : !snapshot ? (
                      <div className="empty-state">{t("disconnected")}</div>
                    ) : detail === "logs" ? (
                      <Logs
                        connection={connection}
                        containers={detailContainers}
                        notify={notify}
                      />
                    ) : detail === "inspect" ? (
                      resourceInspect ? (
                        <pre className="code-view">
                          {JSON.stringify(resourceInspect, null, 2)}
                        </pre>
                      ) : (
                        <Inspect
                          connectionId={connection.id}
                          containerId={container?.id}
                          project={projectContainers}
                        />
                      )
                    ) : detail === "stats" ? (
                      <ResourceStats
                        connectionId={connection.id}
                        container={container}
                      />
                    ) : (
                      <ContainerTerminal
                        connection={connection}
                        container={container}
                      />
                    )}
                  </div>
                </section>
              </>
            )}
          </main>
        </div>
        <footer className="statusbar">
          <div>
            <i className="status-dot" />
            <span>{connection?.name || t("app")}</span>
            <span className="status-divider" />
            <span>
              {t("connectedHosts", {
                count: workspaceConnections.filter((c) => snapshots[c.id])
                  .length,
              })}
            </span>
          </div>
          <div>
            <Updates disabled={operationBusy || !!connectionDialog || workspaceDialog || bindingDialog || !!plan} />
            <span className="status-divider" />
            <span>{t(status as "ready" | "connectionFailed")}</span>
            <span className="status-divider" />
            <button onClick={() => setPanelHeight(252)}>
              {t("layoutReset")}
            </button>
          </div>
        </footer>
        {toast && (
          <div className="toast visible" role="status">
            {toast}
          </div>
        )}
        {connectionDialog && (
          <ConnectionDialog
            connection={
              connectionDialog === true ? undefined : connectionDialog
            }
            connections={connections}
            workspaces={workspaces}
            workspaceId={activeWorkspace}
            onClose={() => setConnectionDialog(undefined)}
            onSaved={connectionSaved}
          />
        )}
        {workspaceDialog && (
          <WorkspaceDialog
            workspaces={workspaces}
            connections={connections}
            activeId={activeWorkspace}
            onClose={() => setWorkspaceDialog(false)}
            onChanged={workspacesChanged}
          />
        )}
        {importDialog && (
          <ImportDialog
            workspaceId={activeWorkspace}
            onClose={() => setImportDialog(false)}
            onImported={(count) => {
              setImportDialog(false);
              void loadConnections();
              notify(t("imported", { count }));
            }}
          />
        )}
        {plan && (
          <OperationDialog
            plan={plan}
            onClose={() => setPlan(undefined)}
            onExecute={() => void execute()}
            busy={operationBusy}
          />
        )}
        {bindingDialog && connection && project && (
          <BindingDialog
            connectionId={connection.id}
            project={project}
            existing={snapshot?.bindings.find((b) => b.project === project)}
            onClose={() => setBindingDialog(false)}
            onSaved={() => {
              setBindingDialog(false);
              void refresh(connection.id);
              notify(t("bindingSaved"));
            }}
          />
        )}
        {removeDialog && (
          <Dialog
            title={t("removeConnectionTitle")}
            onClose={() => setRemoveDialog(undefined)}
            className="action-dialog"
            footer={
              <>
                <button onClick={() => setRemoveDialog(undefined)}>
                  {t("cancel")}
                </button>
                <button
                  className="danger primary"
                  onClick={() => {
                    const id = removeDialog.id;
                    void rpc("connections.delete", { id })
                      .then(() => {
                        setRemoveDialog(undefined);
                        setSelected(undefined);
                        setTabs((old) =>
                          old.filter((x) => x.connectionId !== id),
                        );
                        setSnapshots((old) => {
                          const next = { ...old };
                          delete next[id];
                          return next;
                        });
                        void loadConnections();
                      })
                      .catch((e) => setError(errorValue(e)));
                  }}
                >
                  {t("delete")}
                </button>
              </>
            }
          >
            <div className="action-body">
              <p>
                <strong>{removeDialog.name}</strong>
              </p>
              <p>{t("removeConnectionHint")}</p>
            </div>
          </Dialog>
        )}
        {command && (
          <Dialog
            title={t("globalSearch")}
            onClose={() => setCommand(false)}
            className="command-dialog"
          >
            <div className="command-search">
              <Icon name="search" />
              <input
                autoFocus
                aria-label={t("globalSearch")}
                placeholder={t("search")}
                value={commandQuery}
                onChange={(e) => setCommandQuery(e.target.value)}
              />
              <kbd>Esc</kbd>
            </div>
            <div className="command-results">
              {commandResults.map(({ connection: c, container: x }) => (
                <button
                  key={`${c.id}-${x.id}`}
                  onClick={() => {
                    openView({
                      connectionId: c.id,
                      project: x.project || undefined,
                      containerId: x.id,
                      category: x.project ? "compose" : "containers",
                    });
                    setCommand(false);
                  }}
                >
                  <Icon name="container" />
                  <span>{x.name}</span>
                  <span className="result-meta">
                    {c.name} / {x.project}
                  </span>
                </button>
              ))}
              {!commandResults.length &&
                workspaceConnections
                  .filter((c) =>
                    `${c.name} ${endpoint(c)}`
                      .toLowerCase()
                      .includes(commandQuery.toLowerCase()),
                  )
                  .map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        selectHost(c);
                        setCommand(false);
                      }}
                    >
                      <Icon name="host" />
                      {c.name}
                      <span className="result-meta">{endpoint(c)}</span>
                    </button>
                  ))}
            </div>
          </Dialog>
        )}
        {composeOutput !== undefined && (
          <Dialog
            title={t("composeOutput")}
            onClose={() => setComposeOutput(undefined)}
            className="compose-output-dialog"
          >
            <pre className="code-view">{composeOutput || t("loading")}</pre>
          </Dialog>
        )}
      </div>
    </I18nContext.Provider>
  );
}
