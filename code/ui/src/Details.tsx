import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useI18n } from "./i18n";
import { errorValue, rpc, saveText, subscribe } from "./bridge";
import { appendLogs, bytes, decodeOutput, encodeInput } from "./utils";
import type {
  AppError,
  Connection,
  Container,
  LogEntry,
  Operation,
  Stats,
  StreamEvent,
} from "./types";
import { ErrorPanel } from "./dialogs";
import { Icon } from "./Icon";

export function Logs({
  connection,
  containers,
  notify,
}: {
  connection: Connection;
  containers: Container[];
  notify: (message: string) => void;
}) {
  const { t, language } = useI18n();
  const [lines, setLines] = useState<LogEntry[]>([]);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(true);
  const [since, setSince] = useState("");
  const [appliedSince, setAppliedSince] = useState("");
  const [streamState, setStreamState] = useState("waitingLogs");
  const [error, setError] = useState<AppError>();
  const parent = useRef<HTMLDivElement>(null);
  const ids = containers
    .map((c) => c.id)
    .sort()
    .join(",");
  useEffect(() => {
    setLines([]);
    setError(undefined);
    setStreamState("waitingLogs");
    if (!ids) return;
    let closed = false;
    let cancel: (() => void) | undefined;
    let batch: LogEntry[] = [];
    const timer = setInterval(() => {
      if (batch.length) {
        const incoming = batch;
        batch = [];
        if (!closed) setLines((old) => appendLogs(old, incoming));
      }
    }, 80);
    void subscribe(
      "logs.subscribe",
      {
        connectionId: connection.id,
        containerIds: ids.split(","),
        since: appliedSince ? new Date(appliedSince).toISOString() : "",
        tail: 300,
      },
      (event) => {
        if (closed) return;
        if (event.kind === "log") {
          batch.push(event.data as LogEntry);
          setStreamState("connected");
        }
        if (event.kind === "reconnecting") setStreamState("reconnecting");
        if (event.kind === "gap") setStreamState("streamGap");
        if (event.error) setError(event.error);
        if (event.kind === "end") setStreamState("streamDisconnected");
      },
    )
      .then((fn) => {
        cancel = fn;
        if (closed) fn();
      })
      .catch((e) => !closed && setError(errorValue(e)));
    return () => {
      closed = true;
      clearInterval(timer);
      cancel?.();
    };
  }, [connection.id, ids, appliedSince]);
  const filtered = useMemo(
    () =>
      lines.filter(
        (l) =>
          (level === "all" || l.level === level) &&
          (!query ||
            `${l.source} ${l.message}`
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase())),
      ),
    [lines, query, level],
  );
  const virtual = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 25,
    overscan: 16,
  });
  useEffect(() => {
    if (follow && filtered.length)
      virtual.scrollToIndex(filtered.length - 1, { align: "end" });
  }, [filtered.length, follow, virtual]);
  const text = () =>
    filtered
      .map((l) => `${l.time} [${l.source}] [${l.stream}] ${l.message}`)
      .join("\n");
  return (
    <>
      <div className="console-toolbar">
        <label className="log-search">
          <Icon name="search" />
          <input
            aria-label={t("logsSearch")}
            placeholder={t("logsSearch")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label={t("allLevels")}
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        >
          <option value="all">{t("allLevels")}</option>
          {["ERROR", "WARN", "INFO", "DEBUG", "TRACE", "UNKNOWN"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <details className="log-time-filter">
          <summary>{t("since")}</summary>
          <div>
            <input
              type="datetime-local"
              aria-label={t("since")}
              value={since}
              onChange={(e) => setSince(e.target.value)}
            />
            <button onClick={() => setAppliedSince(since)}>
              {t("refresh")}
            </button>
          </div>
        </details>
        <span className="log-counter">
          {t("logCount", { count: filtered.length })}
        </span>
        <span className="spacer" />
        <button
          className={follow ? "on" : ""}
          title={t(follow ? "pauseFollow" : "resumeFollow")}
          onClick={() => setFollow((v) => !v)}
        >
          <Icon name={follow ? "pause" : "play"} />
          <span className="label-text">
            {t(follow ? "pauseFollow" : "resumeFollow")}
          </span>
        </button>
        <button
          className={wrap ? "on" : ""}
          title={t("wrap")}
          aria-label={t("wrap")}
          onClick={() => setWrap((v) => !v)}
        >
          <Icon name="wrap" />
        </button>
        <button
          title={t("copy")}
          aria-label={t("copy")}
          onClick={() =>
            void navigator.clipboard
              .writeText(text())
              .then(() => notify(t("logsCopied")))
              .catch(() => notify(t("copyFailed")))
          }
        >
          <Icon name="copy" />
        </button>
        <button
          title={t("export")}
          aria-label={t("export")}
          onClick={() =>
            void saveText("docker-logs.log", text()).catch((e) =>
              setError(errorValue(e)),
            )
          }
        >
          <Icon name="download" />
        </button>
        <button
          title={t("clear")}
          aria-label={t("clear")}
          onClick={() => {
            setLines([]);
            notify(t("clearLogsHint"));
          }}
        >
          <Icon name="clear" />
        </button>
      </div>
      {error && (
        <div className="stream-warning">
          <span>{error.message}</span>
          <button
            onClick={() => setError(undefined)}
            aria-label={t("closeError")}
          >
            ×
          </button>
        </div>
      )}
      <div
        className={`log-output virtual-logs ${wrap ? "wrap" : ""}`}
        ref={parent}
      >
        {filtered.length ? (
          <div
            style={{
              height: virtual.getTotalSize(),
              width: "100%",
              position: "relative",
            }}
          >
            {virtual.getVirtualItems().map((item) => {
              const line = filtered[item.index];
              return (
                <div
                  className="live-log-line"
                  data-index={item.index}
                  ref={virtual.measureElement}
                  key={`${line.containerId}-${line.seq}-${item.index}`}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <span className="log-time" title={line.time}>
                    {new Date(line.time).toLocaleTimeString(language, {
                      hour12: false,
                    })}
                  </span>
                  <span className="log-source" title={line.source}>
                    {line.source}
                  </span>
                  <span className={`log-level ${line.level.toLowerCase()}`}>
                    {line.level}
                  </span>
                  <span className="log-message">{line.message}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            {t(lines.length ? "noLogs" : "waitingLogs")}
          </div>
        )}
      </div>
      <div className="console-foot">
        <span>
          <i className="live-dot" />
          {t(
            streamState as
              | "connected"
              | "waitingLogs"
              | "reconnecting"
              | "streamGap"
              | "streamDisconnected",
          )}
        </span>
        <span>{t("logBuffer")}</span>
      </div>
    </>
  );
}
export function Inspect({
  connectionId,
  containerId,
  project,
}: {
  connectionId: string;
  containerId?: string;
  project: Container[];
}) {
  const { t } = useI18n();
  const [data, setData] = useState<unknown>();
  const [error, setError] = useState<AppError>();
  useEffect(() => {
    let valid = true;
    setError(undefined);
    if (!containerId) {
      setData(project);
      return;
    }
    setData(undefined);
    void rpc("containers.inspect", { connectionId, containerId })
      .then((v) => valid && setData(v))
      .catch((e) => valid && setError(errorValue(e)));
    return () => {
      valid = false;
    };
  }, [connectionId, containerId, project]);
  return error ? (
    <ErrorPanel error={error} />
  ) : (
    <pre className="code-view">
      {data === undefined ? t("loading") : JSON.stringify(data, null, 2)}
    </pre>
  );
}
export function ResourceStats({
  connectionId,
  container,
}: {
  connectionId: string;
  container?: Container;
}) {
  const { t } = useI18n();
  const [samples, setSamples] = useState<Stats[]>([]);
  const [error, setError] = useState<AppError>();
  useEffect(() => {
    setSamples([]);
    setError(undefined);
    if (!container || container.state !== "running") return;
    let closed = false;
    let cancel: (() => void) | undefined;
    void subscribe(
      "stats.subscribe",
      { connectionId, containerId: container.id },
      (event) => {
        if (closed) return;
        if (event.kind === "stats")
          setSamples((old) => [...old.slice(-59), event.data as Stats]);
        if (event.error) setError(event.error);
      },
    )
      .then((fn) => {
        cancel = fn;
        if (closed) fn();
      })
      .catch((e) => !closed && setError(errorValue(e)));
    return () => {
      closed = true;
      cancel?.();
    };
  }, [connectionId, container?.id, container?.state]);
  if (!container)
    return <div className="empty-state">{t("selectContainer")}</div>;
  const latest = samples.at(-1);
  return (
    <>
      {error && <ErrorPanel error={error} />}
      <div className="stats-grid">
        {[
          {
            label: t("cpu"),
            value: latest ? latest.cpu.toFixed(2) + "%" : "—",
            series: samples.map((s) => s.cpu),
          },
          {
            label: t("memory"),
            value: latest ? bytes(latest.memory) : "—",
            series: samples.map((s) => s.memory),
          },
          {
            label: "RX / TX",
            value: latest ? `${bytes(latest.rx)} / ${bytes(latest.tx)}` : "—",
            series: samples.map((s) => s.rx),
          },
        ].map((stat) => {
          const max = Math.max(1, ...stat.series);
          return (
            <div className="stat-block" key={stat.label}>
              <p>{stat.label}</p>
              <strong>{stat.value}</strong>
              <div className="sparkline">
                {stat.series.map((v, i) => (
                  <i
                    key={i}
                    style={{ height: Math.max(3, (v / max) * 100) + "%" }}
                  />
                ))}
              </div>
              <small>
                {latest
                  ? new Date(latest.time).toLocaleTimeString()
                  : t("loading")}
              </small>
            </div>
          );
        })}
      </div>
    </>
  );
}
export function ContainerTerminal({
  connection,
  container,
}: {
  connection: Connection;
  container?: Container;
}) {
  const { t } = useI18n();
  const mount = useRef<HTMLDivElement>(null);
  const [shell, setShell] = useState("/bin/sh");
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<AppError>();
  const active = useRef<string | undefined>(undefined);
  const cancelRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    setOpened(false);
    active.current = undefined;
    cancelRef.current?.();
    return () => cancelRef.current?.();
  }, [connection.id, container?.id]);
  useEffect(() => {
    if (!opened || !mount.current || !container) return;
    const terminal = new Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: { background: "#17202e", foreground: "#d5e2f3" },
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(mount.current);
    fit.fit();
    let closed = false;
    let cancel: (() => void) | undefined;
    const observer = new ResizeObserver(() => {
      fit.fit();
      if (active.current)
        void rpc("exec.resize", {
          streamId: active.current,
          cols: terminal.cols,
          rows: terminal.rows,
        }).catch(() => {});
    });
    observer.observe(mount.current);
    void subscribe(
      "exec.open",
      {
        connectionId: connection.id,
        containerId: container.id,
        shell,
        cols: terminal.cols,
        rows: terminal.rows,
      },
      (event) => {
        if (closed) return;
        active.current = event.streamId;
        if (event.kind === "terminal")
          terminal.write(decodeOutput(event.data as string));
        if (event.kind === "end")
          terminal.write("\r\n[" + t("sessionClosed") + "]\r\n");
        if (event.error) setError(event.error);
      },
    )
      .then((fn) => {
        cancel = fn;
        cancelRef.current = fn;
        if (closed) fn();
        terminal.focus();
      })
      .catch((e) => {
        if (!closed) setError(errorValue(e));
      });
    const input = terminal.onData((data) => {
      if (active.current)
        void rpc("exec.input", {
          streamId: active.current,
          data: encodeInput(data),
        }).catch((e) => setError(errorValue(e)));
    });
    return () => {
      closed = true;
      observer.disconnect();
      input.dispose();
      cancel?.();
      terminal.dispose();
      active.current = undefined;
    };
  }, [opened, connection.id, container?.id, shell]);
  if (!container || container.state !== "running")
    return <div className="empty-state">{t("terminalSelect")}</div>;
  if (connection.readOnly)
    return <div className="empty-state">{t("terminalReadOnly")}</div>;
  return (
    <>
      <div className="terminal-note">{t("terminalHint")}</div>
      <div className="terminal-toolbar">
        <select
          value={shell}
          disabled={opened}
          onChange={(e) => setShell(e.target.value)}
          aria-label={t("shell")}
        >
          <option>/bin/sh</option>
          <option>/bin/bash</option>
        </select>
        <button
          onClick={() => {
            setError(undefined);
            setOpened((v) => !v);
          }}
        >
          {t(opened ? "closeTerminal" : "openTerminal")}
        </button>
      </div>
      {error && <ErrorPanel error={error} />}
      <div className="terminal-mount" ref={mount} />
    </>
  );
}
export function History({
  revision,
  connectionIds,
}: {
  revision: number;
  connectionIds: string[];
}) {
  const { t, language } = useI18n();
  const [operations, setOperations] = useState<Operation[]>([]);
  const [error, setError] = useState<AppError>();
  useEffect(() => {
    void rpc<Operation[]>("operations.list")
      .then(setOperations)
      .catch((e) => setError(errorValue(e)));
  }, [revision]);
  if (error) return <ErrorPanel error={error} />;
  const visible = operations.filter((op) =>
    connectionIds.includes(op.connectionId),
  );
  if (!visible.length)
    return <div className="empty-state">{t("noOperations")}</div>;
  return (
    <div className="history-list">
      {visible.map((op) => (
        <div className="history-row" key={op.id}>
          <Icon name={op.status === "succeeded" ? "check" : "history"} />
          <time>{new Date(op.startedAt).toLocaleString(language)}</time>
          <div className="history-label">
            <strong>
              {[
                "start",
                "stop",
                "restart",
                "pull",
                "up",
                "recreate",
                "down",
              ].includes(op.action.replace("compose.", ""))
                ? t(
                    op.action.replace("compose.", "") as
                      | "start"
                      | "stop"
                      | "restart"
                      | "pull"
                      | "up"
                      | "recreate"
                      | "down",
                  )
                : op.action}{" "}
              · {op.target}
            </strong>
            <div className="helper-text">{op.connectionId}</div>
            {op.error && (
              <details>
                <summary>{t("technicalDetails")}</summary>
                <pre>{op.error}</pre>
              </details>
            )}
          </div>
          <span className={`result-tag ${op.status}`}>
            {t(
              ([
                "running",
                "pending",
                "succeeded",
                "failed",
                "unknown",
              ].includes(op.status)
                ? op.status
                : "unknown") as
                "running" | "pending" | "succeeded" | "failed" | "unknown",
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
