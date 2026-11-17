import { describe, it, expect } from "vitest";
import {
  appendLogs,
  bytes,
  encodeInput,
  decodeOutput,
  parseConnectionFile,
} from "./utils";
import type { LogEntry } from "./types";
const line = (seq: number, message = "line"): LogEntry => ({
  connectionId: "host",
  containerId: "container",
  source: "api",
  time: `2026-10-27T01:00:${String(seq).padStart(2, "0")}.000Z`,
  stream: "stdout",
  level: "INFO",
  message,
  seq,
});
describe("live log buffering", () => {
  it("merges out-of-order sources, deduplicates backfill, and retains the latest lines", () => {
    expect(
      appendLogs([line(2), line(4)], [line(3), line(2), line(1)]).map(
        (l) => l.seq,
      ),
    ).toEqual([1, 2, 3, 4]);
    expect(
      appendLogs([line(1), line(2)], [line(3)], 2).map((l) => l.seq),
    ).toEqual([2, 3]);
  });
  it("orders RFC3339 timestamps with mixed fractional precision", () => {
    const a = { ...line(1), time: "2026-10-27T01:00:01Z" };
    const b = { ...line(2), time: "2026-10-27T01:00:01.1Z" };
    const c = { ...line(3), time: "2026-10-27T01:00:01.09Z" };
    expect(appendLogs([a], [b, c]).map((l) => l.seq)).toEqual([1, 3, 2]);
  });
  it("bounds bytes independently of the number of lines", () => {
    const result = appendLogs(
      [],
      [line(1, "a".repeat(1000)), line(2, "short")],
      50000,
      500,
    );
    expect(result.map((l) => l.seq)).toEqual([2]);
  });
  it("preserves non-ASCII terminal input and output", () => {
    expect(
      new TextDecoder().decode(decodeOutput(encodeInput("中文\n😀"))),
    ).toBe("中文\n😀");
  });
  it("formats memory without inventing values", () => {
    expect(bytes(1024)).toBe("1.0 KiB");
    expect(bytes(0)).toBe("0 B");
  });
});

describe("connection imports", () => {
  it("normalizes missing transport objects and always imports read-only", () => {
    const [c] = parseConnectionFile(
      JSON.stringify({
        connections: [
          {
            name: "local",
            transport: "unix",
            endpoint: "unix:///tmp/test.sock",
            readOnly: false,
            hasCredentials: true,
          },
        ],
      }),
    );
    expect(c.ssh.port).toBe(22);
    expect(c.readOnly).toBe(true);
    expect(c.hasCredentials).toBe(false);
    expect(c.id).toBe("");
  });
  it("rejects malformed metadata before rendering a preview", () => {
    expect(() => parseConnectionFile("[null]")).toThrow();
    expect(() =>
      parseConnectionFile('[{"name":{},"transport":"ssh"}]'),
    ).toThrow();
    expect(() =>
      parseConnectionFile(
        '{"connections":[{"name":"x","transport":"ssh","ssh":null}]}',
      ),
    ).toThrow();
  });
});
