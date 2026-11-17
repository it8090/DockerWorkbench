import { newConnection, type Connection, type LogEntry } from "./types";
export const bytes = (value: number) => {
  if (!Number.isFinite(value) || value === 0) return "0 B";
  const unit = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** unit).toFixed(unit ? 1 : 0)} ${["B", "KiB", "MiB", "GiB", "TiB"][unit]}`;
};
export const logKey = (line: LogEntry) =>
  `${line.connectionId}/${line.containerId}/${line.stream}/${line.time}/${line.message}`;
const timeKey = (time: string) =>
  time.replace(
    /(\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/,
    (_, base, fraction) => `${base}.${String(fraction || "").padEnd(9, "0")}Z`,
  );
export function appendLogs(
  previous: LogEntry[],
  incoming: LogEntry[],
  maxLines = 50_000,
  maxBytes = 32 * 1024 * 1024,
) {
  const seen = new Set(previous.map(logKey));
  const fresh = incoming
    .filter((line) => {
      const key = logKey(line);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (a, b) => timeKey(a.time).localeCompare(timeKey(b.time)) || a.seq - b.seq,
    );
  let a = 0,
    b = 0;
  const merged: LogEntry[] = [];
  while (a < previous.length || b < fresh.length) {
    if (
      b === fresh.length ||
      (a < previous.length &&
        timeKey(previous[a].time) <= timeKey(fresh[b].time))
    )
      merged.push(previous[a++]);
    else merged.push(fresh[b++]);
  }
  let total = 0,
    index = merged.length;
  for (; index > 0; index--) {
    total += merged[index - 1].message.length * 2 + 400;
    if (total > maxBytes || merged.length - index >= maxLines) break;
  }
  return merged.slice(index);
}
export function encodeInput(value: string) {
  const bytes = new TextEncoder().encode(value);
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}
export function decodeOutput(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export function parseConnectionFile(text: string): Connection[] {
  const parsed: unknown = JSON.parse(text);
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? (parsed as { connections?: unknown }).connections
      : undefined;
  if (!Array.isArray(list) || list.length > 200)
    throw new Error("Expected at most 200 connection objects");
  return list.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.name !== "string" ||
      !["ssh", "unix", "npipe", "tls"].includes(item.transport)
    )
      throw new Error("Invalid connection metadata");
    const value = newConnection();
    for (const key of [
      "name",
      "environment",
      "endpoint",
      "apiVersion",
    ] as const) {
      if (item[key] !== undefined) {
        if (typeof item[key] !== "string")
          throw new Error("Invalid connection field: " + key);
        value[key] = item[key];
      }
    }
    value.transport = item.transport;
    for (const key of ["timeout", "keepAlive"] as const) {
      if (item[key] !== undefined) {
        if (typeof item[key] !== "number" || !Number.isFinite(item[key]))
          throw new Error("Invalid numeric field");
        value[key] = item[key];
      }
    }
    for (const kind of ["ssh", "tls"] as const) {
      if (item[kind] !== undefined) {
        if (
          !item[kind] ||
          typeof item[kind] !== "object" ||
          Array.isArray(item[kind])
        )
          throw new Error("Invalid transport settings");
        for (const [key, entry] of Object.entries(item[kind])) {
          if (!["string", "number", "boolean"].includes(typeof entry))
            throw new Error("Invalid transport field");
          (value[kind] as unknown as Record<string, unknown>)[key] = entry;
        }
      }
    }
    value.readOnly = true;
    value.hasCredentials = false;
    return value;
  });
}
