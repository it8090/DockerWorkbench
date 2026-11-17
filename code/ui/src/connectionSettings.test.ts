import { describe, expect, it, vi } from "vitest";
import { newConnection, type Connection, type Engine } from "./types";
import {
  connectionTestKey,
  needsConnectionTest,
  saveConnectionSettings,
} from "./connectionSettings";

const initial: Connection = {
  ...newConnection(),
  id: "saved",
  name: "Development",
  transport: "unix",
  endpoint: "unix:///tmp/workbench-test.sock",
};
const engine: Engine = {
  version: "24.0.7",
  apiVersion: "1.43",
  serverApi: "1.43",
  minApi: "1.24",
  os: "linux",
  arch: "arm64",
};
const params = (connection: Connection) => ({
  connection,
  secrets: {},
  remember: false,
});

describe("connection settings persistence", () => {
  it("saves metadata and read-only changes without a network test", async () => {
    const edited = {
      ...initial,
      name: "Renamed",
      workspaceId: "another",
      environment: "production",
      readOnly: false,
    };
    const api = {
      test: vi.fn().mockRejectedValue(new Error("offline")),
      save: vi.fn().mockResolvedValue(edited),
    };
    const saved = await saveConnectionSettings(
      params(edited),
      initial,
      "",
      api,
    );
    expect(saved.connection).toEqual(edited);
    expect(api.test).not.toHaveBeenCalled();
    expect(api.save).toHaveBeenCalledWith(params(edited));
  });

  it.each([
    { endpoint: "unix:///tmp/other.sock" },
    { apiVersion: "1.52" },
    { timeout: 20 },
    { keepAlive: 60 },
    { ssh: { ...initial.ssh, host: "other.example" } },
    { tls: { ...initial.tls, caPath: "/other.pem" } },
  ])("retests changes affecting connectivity: %j", (change) => {
    expect(
      needsConnectionTest(params({ ...initial, ...change }), initial),
    ).toBe(true);
  });

  it("automatically tests new connections before persisting", async () => {
    const order: string[] = [];
    const api = {
      test: vi.fn(async () => {
        order.push("test");
        return engine;
      }),
      save: vi.fn(async () => {
        order.push("save");
        return initial;
      }),
    };
    await saveConnectionSettings(
      params({ ...initial, id: "" }),
      undefined,
      "",
      api,
    );
    expect(order).toEqual(["test", "save"]);
  });

  it("does not save when the automatic test rejects the new API version", async () => {
    const api = {
      test: vi.fn().mockRejectedValue(new Error("api_incompatible")),
      save: vi.fn(),
    };
    await expect(
      saveConnectionSettings(
        params({ ...initial, apiVersion: "1.52" }),
        initial,
        "",
        api,
      ),
    ).rejects.toThrow("api_incompatible");
    expect(api.save).not.toHaveBeenCalled();
  });

  it("retains a successful test across metadata edits but invalidates changed credentials", () => {
    const changed = { ...initial, endpoint: "unix:///tmp/new.sock" };
    const proof = connectionTestKey(changed);
    expect(
      needsConnectionTest(
        params({ ...changed, readOnly: false, name: "Renamed" }),
        initial,
        proof,
      ),
    ).toBe(false);
    expect(
      needsConnectionTest(
        { ...params(changed), secrets: { password: "changed" } },
        initial,
        proof,
      ),
    ).toBe(true);
    expect(connectionTestKey(changed, { password: "" })).toBe(proof);
  });
});
